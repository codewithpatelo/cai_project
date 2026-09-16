/**
 * The only file in the codebase that knows which LLM provider exists.
 *
 * Swapping providers should touch this file and nothing else -- that is the test
 * of the layering in docs/architecture.md §6, and adding DeepSeek as a fallback
 * was that test being run for real (ADR-023). It returns a token stream plus a
 * normalised CallUsage; callers never see a provider-shaped object.
 *
 * Both supported providers speak the same OpenAI-compatible chat-completions
 * dialect, so only the endpoint, the headers and cost reporting differ; those
 * live in provider.ts.
 *
 * Cost accounting, per docs/governor-spec.md §2: OpenRouter includes usage
 * accounting on every chat completion with no extra parameter -- the legacy
 * `usage: { include: true }` and `stream_options.include_usage` are deprecated
 * and have no effect. On a streaming response the usage block arrives in the
 * FINAL chunk, so the stream must be read to completion before recording.
 * Sources: https://openrouter.ai/docs/cookbook/administration/usage-accounting
 *          https://openrouter.ai/docs/api_reference/limits  (both 2026-09-16)
 */

import type { CallUsage, Tier, ModelTier } from '../governor/types'
import { activeProvider } from './provider'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamRequest {
  model: string
  messages: ChatMessage[]
  maxOutputTokens: number
  tier: Tier
  /** Pricing for the tier being called, used only if the provider reports no cost. */
  pricing: ModelTier
  signal?: AbortSignal
}

/**
 * What a completed call produced. `usage` is always present: when the provider
 * reports nothing we estimate rather than record zero, because a call recorded
 * as free is a call that spends money we think we still have.
 */
export interface StreamResult {
  text: string
  usage: CallUsage
}

export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; result: StreamResult }

/** A provider failure, as a value rather than a thrown string. */
export interface LlmError {
  kind: 'http' | 'network' | 'timeout' | 'malformed' | 'no_key'
  status?: number
  /** Safe to log. Never contains the key, and never contains user message text. */
  detail: string
}

export type StreamOutcome =
  | { ok: true }
  | { ok: false; error: LlmError }

// ---------------------------------------------------------------------------
// Chunk parsing
// ---------------------------------------------------------------------------

/**
 * The fields we read off a chunk. Deliberately narrow: CLAUDE.md lists inventing
 * OpenRouter field names as a known failure, so anything not verified against the
 * cited docs is not read here.
 */
interface RawUsage {
  prompt_tokens?: number
  completion_tokens?: number
  /** OpenRouter reports real cost here. DeepSeek does not send this field at all. */
  cost?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
  /** DeepSeek's spelling of the cache-hit count. */
  prompt_cache_hit_tokens?: number
}

interface RawChunk {
  model?: string
  choices?: { delta?: { content?: string | null } }[]
  usage?: RawUsage
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Parse one `data:` payload. Returns null for keep-alives and unparseable lines. */
export function parseChunk(payload: string): RawChunk | null {
  const trimmed = payload.trim()
  if (trimmed === '' || trimmed === '[DONE]') return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isRecord(parsed) ? (parsed as RawChunk) : null
  } catch {
    return null
  }
}

/** The pessimistic-estimate multiplier from governor-spec §2. */
export const ESTIMATE_PESSIMISM = 1.25

/**
 * Cost from the §2 formula, deliberately over-stated by 25%.
 *
 * An over-estimate makes the bot degrade slightly early. An under-estimate makes
 * it run out of money, which on a key that cannot be topped up has no recovery.
 * The asymmetry is the whole reason the multiplier exists.
 */
export function estimateCostUsd(
  pricing: ModelTier,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
): number {
  const uncachedInput = Math.max(0, inputTokens - cachedInputTokens)
  const cachedRate = pricing.cachedInputPerMTok ?? pricing.inputPerMTok
  const raw =
    (uncachedInput * pricing.inputPerMTok) / 1e6 +
    (cachedInputTokens * cachedRate) / 1e6 +
    (outputTokens * pricing.outputPerMTok) / 1e6
  return raw * ESTIMATE_PESSIMISM
}

/**
 * Turn the final chunk's usage block into a CallUsage.
 *
 * Exported so it can be tested against a recorded fixture rather than a live call.
 */
export function normalizeUsage(args: {
  raw: RawUsage | undefined
  model: string
  pricing: ModelTier
  tier: Tier
  latencyMs: number
  /** Used only when the provider reports no token counts at all. */
  fallbackOutputTokens: number
  fallbackInputTokens: number
}): CallUsage {
  const { raw, model, pricing, tier, latencyMs } = args

  const inputTokens = raw?.prompt_tokens ?? args.fallbackInputTokens
  const outputTokens = raw?.completion_tokens ?? args.fallbackOutputTokens
  const cachedInputTokens = raw?.prompt_tokens_details?.cached_tokens ?? raw?.prompt_cache_hit_tokens ?? 0
  const reasoningTokens = raw?.completion_tokens_details?.reasoning_tokens

  // A reported cost of exactly 0 is treated as "not reported". A real call is
  // never free, so trusting a 0 would silently stop the ledger from moving.
  const reported = typeof raw?.cost === 'number' && raw.cost > 0 ? raw.cost : null

  return {
    model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    costUsd: reported ?? estimateCostUsd(pricing, inputTokens, outputTokens, cachedInputTokens),
    costSource: reported === null ? 'estimated' : 'provider',
    latencyMs,
    tier,
  }
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/** Rough token count; see the note in lib/kb/compile.ts on why this is not a tokenizer. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Split an SSE byte stream into complete `data:` payloads.
 *
 * A chunk boundary can fall anywhere, including mid-JSON, so partial lines are
 * held until the terminating blank line arrives. Parsing per-chunk instead of
 * per-event is the bug that makes streaming look fine until a long answer
 * happens to split across a read.
 */
export async function* ssePayloads(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (line.startsWith('data:')) yield line.slice(5).trim()
      }
    }
    const tail = buffer.trim()
    if (tail.startsWith('data:')) yield tail.slice(5).trim()
  } finally {
    reader.releaseLock()
  }
}

/**
 * Read the key at call time, server-side only. It is never passed in or logged.
 *
 * One variable name across providers: the deployment sets LLM_PROVIDER to say
 * which service the key belongs to. Two names would let a DeepSeek key sit in
 * the OpenRouter variable and fail confusingly at request time.
 */
function apiKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY
  return key && key.length > 0 ? key : null
}

/**
 * Stream a completion, yielding tokens as they arrive and a final `done` event
 * carrying normalised usage.
 *
 * Errors are yielded to the caller as an outcome rather than thrown, so the route
 * can degrade to STATIC instead of surfacing anything to the user.
 */
export async function* streamCompletion(
  req: StreamRequest,
): AsyncGenerator<StreamEvent, StreamOutcome> {
  const key = apiKey()
  if (key === null) {
    return { ok: false, error: { kind: 'no_key', detail: 'OPENROUTER_API_KEY is not set' } }
  }

  const provider = activeProvider()
  const startedAt = Date.now()
  let response: Response

  try {
    response = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...provider.extraHeaders,
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
        max_tokens: req.maxOutputTokens,
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    })
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError'
    return {
      ok: false,
      error: {
        kind: aborted ? 'timeout' : 'network',
        detail: aborted ? 'request aborted' : 'fetch failed',
      },
    }
  }

  if (!response.ok || response.body === null) {
    // The body may carry the provider's error text. It is not forwarded to the
    // user and not logged verbatim -- only the status, which cannot leak a key.
    return {
      ok: false,
      error: { kind: 'http', status: response.status, detail: `provider returned ${response.status}` },
    }
  }

  let text = ''
  let model = req.model
  let finalUsage: RawUsage | undefined

  try {
    for await (const payload of ssePayloads(response.body)) {
      const chunk = parseChunk(payload)
      if (chunk === null) continue

      if (typeof chunk.model === 'string') model = chunk.model
      // Usage arrives in the final chunk; keep the last one seen.
      if (chunk.usage) finalUsage = chunk.usage

      const delta = chunk.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        text += delta
        yield { type: 'token', text: delta }
      }
    }
  } catch {
    return { ok: false, error: { kind: 'network', detail: 'stream interrupted' } }
  }

  const promptText = req.messages.map((m) => m.content).join('\n')
  const usage = normalizeUsage({
    raw: finalUsage,
    model,
    pricing: req.pricing,
    tier: req.tier,
    latencyMs: Date.now() - startedAt,
    fallbackInputTokens: estimateTokens(promptText),
    fallbackOutputTokens: estimateTokens(text),
  })

  yield { type: 'done', result: { text, usage } }
  return { ok: true }
}
