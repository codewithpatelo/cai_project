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
import { activeProvider } from '@/lib/llm/provider'
import { createGovernor, SupabaseLedgerStore } from '@/lib/governor'
import type { Decision, Tier } from '@/lib/governor/types'
import { governorConfigFromEnv, supabaseConfigFromEnv } from '@/lib/chat/governor-config'
import { asEvalBudget, isEvalRequest } from '@/lib/chat/eval-budget'
import type { GovernorConfig } from '@/lib/governor/types'
import { validate, sseFrame, shouldEscalate } from '@/lib/chat/protocol'
import { staticAnswer, chunkAnswer } from '@/lib/chat/static-responder'
import { filterUrls } from '@/lib/chat/url-filter'
import { verifyHistory, signAnswer } from '@/lib/chat/history-integrity'

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
function makeGovernor(cfg: GovernorConfig) {
  const supabase = supabaseConfigFromEnv()
  if (supabase === null) return null
  return createGovernor(cfg, new SupabaseLedgerStore(supabase))
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

  // Evaluation traffic spends the eval ledger, not the visitor's. Without this an
  // eval run degrades the live bot for real visitors -- which is exactly what it
  // did on 2026-09-18 (ADR-030).
  const cfg = isEvalRequest(request.headers.get('x-eval-token'))
    ? asEvalBudget(governorConfigFromEnv())
    : governorConfigFromEnv()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseFrame(event, data)))
      }

      /**
       * The floor. Costs nothing, cannot fail, always has an answer.
       *
       * Sent as fast as it can go. Sleeping between chunks to imitate typing was
       * tried and removed: it made the product slower on purpose to compensate
       * for a missing animation. Smoothness is the UI's job, not the transport's.
       */
      const serveStatic = (retryAfterSec?: number) => {
        const startedAt = Date.now()
        const answer = filterUrls(staticAnswer(message)).text
        for (const piece of chunkAnswer(answer)) send('token', { t: piece })
        send('done', {
          escalate: true,
          latencyMs: Date.now() - startedAt,
          tier: 'STATIC' as Tier,
          ...(cfg.telemetrySalt === '' ? {} : { sig: signAnswer(answer, cfg.telemetrySalt) }),
        })
        void retryAfterSec
      }

      try {
        const governor = makeGovernor(cfg)

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

        // Drop any assistant turn this server cannot prove it wrote, BEFORE
        // trimming or assembly. A forged turn carries the authority of the bot
        // itself, which is what makes it worth forging.
        const checked = verifyHistory(history, cfg.telemetrySalt)
        if (checked.rejected > 0) {
          console.warn(
            JSON.stringify({
              event: 'history_turns_rejected',
              count: checked.rejected,
              at: new Date().toISOString(),
            }),
          )
        }

        const trimmed = governor.trimHistory(checked.kept, decision.historyBudget)
        const messages = assemble({ compiledKb: COMPILED_KB, history: trimmed.kept, message })

        const generator = streamCompletion({
          model: decision.model,
          messages,
          maxOutputTokens: decision.maxOutputTokens,
          tier: decision.tier,
          pricing: decision.tier === 'ECONOMY' ? cfg.tiers.ECONOMY : cfg.tiers.PRIMARY,
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
              // The user gets a real answer, not an error -- but the operator gets
              // a log line. Degrading silently on every request is indistinguishable
              // from a bot that simply has nothing to say, and it cost a day.
              // Carries a failure kind, an HTTP status, the provider and the model
              // id. No key, no user text: `detail` is built from a status code.
              console.error(
                JSON.stringify({
                  event: 'upstream_failure',
                  kind: next.value.error.kind,
                  status: next.value.error.status ?? null,
                  detail: next.value.error.detail,
                  provider: activeProvider().id,
                  model: decision.model,
                  at: new Date().toISOString(),
                }),
              )
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
              // Signs the text the client will actually hold, so a replayed turn
              // has to match byte for byte.
              ...(cfg.telemetrySalt === ''
                ? {}
                : { sig: signAnswer(filtered.text, cfg.telemetrySalt) }),
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
