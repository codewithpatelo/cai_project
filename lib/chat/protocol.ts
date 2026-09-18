/**
 * The /api/chat wire protocol: request validation and SSE framing.
 *
 * Lives here rather than in the route file for two reasons. Next.js only permits
 * a fixed set of exports from a route module, and -- the reason that would apply
 * anyway -- route handlers are thin orchestration by design
 * (docs/architecture.md §6). Validation is logic, and logic is testable.
 */

const MAX_MESSAGE_CHARS = 2000
const MAX_HISTORY_TURNS = 12
const MAX_BODY_BYTES = 32 * 1024

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface ChatRequest {
  sessionId: string
  message: string
  history: { role: 'user' | 'assistant'; content: string; sig?: string }[]
}

type Validation =
  | { ok: true; value: ChatRequest }
  | { ok: false; status: 400 | 413; code: 'bad_request' | 'payload_too_large'; message: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function validate(rawBody: string): Validation {
  // Byte length, not character count: a 32KB cap on a UTF-16 length lets a
  // multibyte payload through at roughly three times the intended size.
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'payload_too_large',
      message: 'That conversation is too long to send. Start a new one and ask again.',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return { ok: false, status: 400, code: 'bad_request', message: 'That request could not be read.' }
  }

  if (!isRecord(parsed)) {
    return { ok: false, status: 400, code: 'bad_request', message: 'That request could not be read.' }
  }

  const { sessionId, message, history } = parsed

  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 100) {
    return { ok: false, status: 400, code: 'bad_request', message: 'That request could not be read.' }
  }

  if (typeof message !== 'string' || message.trim().length === 0) {
    return { ok: false, status: 400, code: 'bad_request', message: 'Type a question and I will answer it.' }
  }

  if (message.length > MAX_MESSAGE_CHARS) {
    return {
      ok: false,
      status: 400,
      code: 'bad_request',
      message: `That message is too long. Keep it under ${MAX_MESSAGE_CHARS} characters and I will answer it.`,
    }
  }

  const turns: ChatRequest['history'] = []
  if (history !== undefined) {
    if (!Array.isArray(history)) {
      return { ok: false, status: 400, code: 'bad_request', message: 'That request could not be read.' }
    }
    // Over-long history is trimmed rather than rejected: the user did nothing
    // wrong, and the server re-trims regardless of what the client sent.
    for (const turn of history.slice(-MAX_HISTORY_TURNS)) {
      if (!isRecord(turn)) continue
      const { role, content } = turn
      if ((role === 'user' || role === 'assistant') && typeof content === 'string') {
        // The signature proves this server produced an assistant turn. It is
        // carried, not trusted: verification happens in history-integrity.ts.
        const sig = turn.sig
        turns.push({ role, content, ...(typeof sig === 'string' ? { sig } : {}) })
      }
    }
  }

  return { ok: true, value: { sessionId, message, history: turns } }
}

// ---------------------------------------------------------------------------
// SSE framing
// ---------------------------------------------------------------------------

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Does this answer end in a handoff?
 *
 * Phase 2 matched the contact URL, on the reasoning that the knowledge base
 * guarantees it -- and Phase 5 was supposed to refine it once the form existed.
 * It never did, and the consequence was the form appearing under almost every
 * answer: the prompt instructs the bot to give the contact page in every handoff,
 * and the handoff list covers most topics, so the URL is in nearly every reply.
 * A visitor got a lead form as punctuation rather than as an offer, which makes
 * every exchange feel like the end of the conversation.
 *
 * The signal is the offer itself, not the URL. The bot says it will take the
 * visitor's details and pass them on; that sentence is what the form belongs
 * under. A reply that merely points at the contact page is still an answer, and
 * the conversation continues.
 */
export function shouldEscalate(answer: string): boolean {
  return /\bpass (?:your|the)\b[^.!?]{0,40}\b(?:details|request|information|info)\b/i.test(answer)
    || /\b(?:name|details)[^.!?]{0,40}\bwork email\b/i.test(answer)
    || /\btake your details\b/i.test(answer)
}
