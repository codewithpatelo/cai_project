/**
 * POST /api/chat -- the SSE endpoint. Thin orchestration only.
 *
 * Contract in docs/architecture.md §4. The rule that shapes everything here:
 * `event: error` is NEVER sent for a budget, rate-limit or upstream failure.
 * Those degrade to STATIC and stream normally. `error` is reserved for malformed
 * input, and even then the client shows a human sentence.
 *
 * Order of operations: authorize -> (model | static) -> filter -> record.
 * record() runs after the stream completes, because the real cost only arrives
 * in the provider's final chunk.
 */

import { assemble } from '@/lib/prompt/assemble'
import { COMPILED_KB } from '@/lib/kb/kb.generated'
import { streamCompletion } from '@/lib/llm/client'
import { createGovernor, SupabaseLedgerStore } from '@/lib/governor'
import type { Decision, Tier } from '@/lib/governor/types'
import { governorConfigFromEnv, supabaseConfigFromEnv } from '@/lib/chat/governor-config'
import { validate, sseFrame, shouldEscalate } from '@/lib/chat/protocol'
import { staticAnswer, chunkAnswer } from '@/lib/chat/static-responder'
import { filterUrls } from '@/lib/chat/url-filter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The client's IP, for rate limiting. Only ever used to build an HMAC; the
 * address itself is never stored or logged (docs/architecture.md §5).
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'unknown'
}

/**
 * The governor, or null when no ledger store is configured.
 *
 * Null means fail closed: without a shared store there is no honest way to
 * account for spend, so the bot serves STATIC rather than calling a model it
 * cannot pay for. An in-process counter would under-count by the concurrency
 * factor, which is why there isn't one.
 */
function makeGovernor() {
  const supabase = supabaseConfigFromEnv()
  if (supabase === null) return null
  return createGovernor(governorConfigFromEnv(), new SupabaseLedgerStore(supabase))
}

export async function POST(request: Request): Promise<Response> {
  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return Response.json({ code: 'bad_request', message: 'That request could not be read.' }, { status: 400 })
  }

  const validated = validate(rawBody)
  if (!validated.ok) {
    return Response.json({ code: validated.code, message: validated.message }, { status: validated.status })
  }

  const { sessionId, message, history } = validated.value
  const ip = clientIp(request)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseFrame(event, data)))
      }

      /** The floor. Costs nothing, cannot fail, always has an answer. */
      const serveStatic = (retryAfterSec?: number) => {
        const answer = filterUrls(staticAnswer(message)).text
        for (const piece of chunkAnswer(answer)) send('token', { t: piece })
        send('done', { escalate: true, latencyMs: 0, tier: 'STATIC' as Tier })
        void retryAfterSec
      }

      try {
        const governor = makeGovernor()

        let decision: Decision | null = null
        if (governor !== null) {
          decision = await governor.authorize({ ip, sessionId })
        }

        // No store configured, or the governor refused: STATIC, and the user is
        // never told the reason is budget. "We're economising on tokens" is not a
        // useful thing to say to a prospective client.
        if (governor === null || decision === null || !decision.allowed || decision.model === null) {
          send('meta', {
            tier: 'STATIC' as Tier,
            model: null,
            simulated: decision?.budgetSnapshot.simulated ?? false,
            ...(decision?.retryAfterSec === undefined ? {} : { retryAfterSec: decision.retryAfterSec }),
          })
          serveStatic(decision?.retryAfterSec)
          return
        }

        send('meta', {
          tier: decision.tier,
          model: decision.model,
          simulated: decision.budgetSnapshot.simulated,
        })

        const trimmed = governor.trimHistory(history, decision.historyBudget)
        const messages = assemble({ compiledKb: COMPILED_KB, history: trimmed.kept, message })

        const generator = streamCompletion({
          model: decision.model,
          messages,
          maxOutputTokens: decision.maxOutputTokens,
          tier: decision.tier,
          pricing: decision.tier === 'ECONOMY'
            ? governorConfigFromEnv().tiers.ECONOMY
            : governorConfigFromEnv().tiers.PRIMARY,
        })

        // The filter runs on the accumulated answer, not per token: a URL can
        // arrive split across chunks, and a per-token filter would never see it
        // whole. Tokens are therefore held back until a whitespace boundary.
        let answer = ''
        let emitted = 0
        let completed = false

        const flushUpTo = (limit: number) => {
          if (limit <= emitted) return
          const safe = filterUrls(answer.slice(0, limit)).text
          const already = filterUrls(answer.slice(0, emitted)).text
          if (safe.length > already.length) send('token', { t: safe.slice(already.length) })
          emitted = limit
        }

        for (;;) {
          const next = await generator.next()

          if (next.done) {
            if (!next.value.ok && !completed) {
              // Provider 429, 5xx, timeout: the user gets a real answer, not an error.
              serveStatic()
            }
            break
          }

          const event = next.value
          if (event.type === 'token') {
            answer += event.text
            const lastBreak = answer.lastIndexOf(' ')
            if (lastBreak > emitted) flushUpTo(lastBreak)
          } else {
            completed = true
            flushUpTo(answer.length)

            const filtered = filterUrls(answer)
            send('done', {
              escalate: shouldEscalate(filtered.text),
              latencyMs: event.result.usage.latencyMs,
              tier: decision.tier,
            })

            // Recorded after the stream completes, because the real cost only
            // arrives in the final chunk. Awaited: a spend we fail to write is a
            // spend the next request thinks we still have.
            await governor.record({ ...event.result.usage, sessionId })
          }
        }
      } catch {
        // Nothing reaches the user as a stack trace. Ever.
        serveStatic()
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
