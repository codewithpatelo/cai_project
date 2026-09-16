/**
 * POST /api/chat -- the SSE endpoint. Thin orchestration only.
 *
 * Contract in docs/architecture.md §4. The rule that shapes everything here:
 * `event: error` is NEVER sent for a budget, rate-limit or upstream failure.
 * Those degrade and stream normally. `error` is reserved for malformed input,
 * and even then the client shows a human sentence rather than a status code.
 *
 * Phase 2: no governor yet. A crude per-instance request cap stands in so a
 * runaway dev loop cannot drain the key; Phase 4 deletes it and calls
 * governor.authorize() instead.
 */

import { assemble } from '@/lib/prompt/assemble'
import { COMPILED_KB } from '@/lib/kb/kb.generated'
import { streamCompletion } from '@/lib/llm/openrouter'
import { primaryTier } from '@/lib/llm/models'
import { validate, sseFrame, shouldEscalate } from '@/lib/chat/protocol'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_OUTPUT_TOKENS = 250

// ---------------------------------------------------------------------------
// Phase-2 stand-in spend guard
// ---------------------------------------------------------------------------

/**
 * A per-instance request counter. This is NOT the governor and is not a ceiling:
 * serverless instances do not share memory, so it under-counts by the concurrency
 * factor. It exists only so a runaway loop during development cannot empty the dev
 * key, and Phase 4 deletes it. The real ceiling is a shared store, by design
 * (docs/architecture.md §2).
 */
let requestsThisInstance = 0

function overDevCap(): boolean {
  const cap = Number(process.env.MAX_REQUESTS ?? '')
  if (!Number.isFinite(cap) || cap <= 0) return false
  requestsThisInstance += 1
  return requestsThisInstance > cap
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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

  const { message, history } = validated.value
  const tier = primaryTier()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseFrame(event, data)))
      }

      try {
        if (overDevCap()) {
          // Degrades, never errors -- the same shape Phase 4 uses for a real budget stop.
          send('meta', { tier: 'STATIC', model: null, simulated: false })
          send('token', {
            t: 'I have reached this deployment’s request limit. You can reach the Cadre team at https://www.cadreai.com/contact.',
          })
          send('done', { escalate: true, latencyMs: 0, tier: 'STATIC' })
          return
        }

        send('meta', { tier: 'PRIMARY', model: tier.id, simulated: false })

        const startedAt = Date.now()
        const messages = assemble({ compiledKb: COMPILED_KB, history, message })

        const generator = streamCompletion({
          model: tier.id,
          messages,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          tier: 'PRIMARY',
          pricing: tier,
        })

        let answer = ''
        let completed = false

        for (;;) {
          const next = await generator.next()
          if (next.done) {
            // The generator's RETURN value is the outcome. A provider failure
            // lands here, and must reach the user as a static answer rather than
            // as an error event.
            if (!next.value.ok && !completed) {
              send('token', {
                t: 'I could not reach the assistant just now. You can contact the Cadre team directly at https://www.cadreai.com/contact.',
              })
              send('done', { escalate: true, latencyMs: Date.now() - startedAt, tier: 'STATIC' })
            }
            break
          }

          const event = next.value
          if (event.type === 'token') {
            answer += event.text
            send('token', { t: event.text })
          } else {
            completed = true
            send('done', {
              escalate: shouldEscalate(answer),
              latencyMs: event.result.usage.latencyMs,
              tier: 'PRIMARY',
            })
          }
        }
      } catch {
        // Nothing reaches the user as a stack trace. Ever.
        send('token', {
          t: 'Something went wrong on my side. You can reach the Cadre team at https://www.cadreai.com/contact.',
        })
        send('done', { escalate: true, latencyMs: 0, tier: 'STATIC' })
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
      // Vercel and some proxies buffer streamed responses without this.
      'X-Accel-Buffering': 'no',
    },
  })
}
