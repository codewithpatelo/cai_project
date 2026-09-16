import { describe, it, expect } from 'vitest'
import {
  parseChunk,
  normalizeUsage,
  estimateCostUsd,
  ssePayloads,
  ESTIMATE_PESSIMISM,
} from './openrouter'
import type { ModelTier } from '../governor/types'

/**
 * Cost accounting is the part of this adapter that silently costs money when it
 * is wrong, so it is tested against recorded chunk shapes rather than a live call.
 * CLAUDE.md lists inventing OpenRouter field names as a known failure mode here.
 */

const PRICING: ModelTier = { id: 'test/model', inputPerMTok: 0.75, outputPerMTok: 3.75, cachedInputPerMTok: 0.075 }

/** The shape of a final streaming chunk carrying usage accounting. */
const FINAL_CHUNK = {
  id: 'gen-123',
  model: 'google/gemini-3.8-flash',
  choices: [{ delta: {} }],
  usage: {
    prompt_tokens: 6000,
    completion_tokens: 200,
    cost: 0.00525,
    prompt_tokens_details: { cached_tokens: 4700 },
  },
}

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
}

describe('TC2.1 — usage parsed from the final chunk', () => {
  it('prefers the provider-reported cost', () => {
    const usage = normalizeUsage({
      raw: FINAL_CHUNK.usage,
      model: FINAL_CHUNK.model,
      pricing: PRICING,
      tier: 'PRIMARY',
      latencyMs: 1340,
      fallbackInputTokens: 0,
      fallbackOutputTokens: 0,
    })
    expect(usage.costSource).toBe('provider')
    expect(usage.costUsd).toBe(0.00525)
    expect(usage.inputTokens).toBe(6000)
    expect(usage.outputTokens).toBe(200)
    expect(usage.cachedInputTokens).toBe(4700)
    expect(usage.tier).toBe('PRIMARY')
  })

  it('falls back to an estimate when the usage block is missing', () => {
    const usage = normalizeUsage({
      raw: undefined,
      model: 'test/model',
      pricing: PRICING,
      tier: 'PRIMARY',
      latencyMs: 10,
      fallbackInputTokens: 6000,
      fallbackOutputTokens: 200,
    })
    expect(usage.costSource).toBe('estimated')
    expect(usage.costUsd).toBeCloseTo(estimateCostUsd(PRICING, 6000, 200, 0), 10)
  })

  it('treats a reported cost of zero as not reported', () => {
    // A real call is never free. Trusting a 0 would stop the ledger moving while
    // the bot kept spending -- the exact failure the governor exists to prevent.
    const usage = normalizeUsage({
      raw: { prompt_tokens: 100, completion_tokens: 10, cost: 0 },
      model: 'test/model',
      pricing: PRICING,
      tier: 'PRIMARY',
      latencyMs: 1,
      fallbackInputTokens: 0,
      fallbackOutputTokens: 0,
    })
    expect(usage.costSource).toBe('estimated')
    expect(usage.costUsd).toBeGreaterThan(0)
  })

  it('carries reasoning tokens through when the provider reports them', () => {
    const usage = normalizeUsage({
      raw: { prompt_tokens: 10, completion_tokens: 5, cost: 1, completion_tokens_details: { reasoning_tokens: 3 } },
      model: 'm',
      pricing: PRICING,
      tier: 'ECONOMY',
      latencyMs: 1,
      fallbackInputTokens: 0,
      fallbackOutputTokens: 0,
    })
    expect(usage.reasoningTokens).toBe(3)
  })

  it('has no field that could hold user message text', () => {
    const usage = normalizeUsage({
      raw: FINAL_CHUNK.usage,
      model: 'm',
      pricing: PRICING,
      tier: 'PRIMARY',
      latencyMs: 1,
      fallbackInputTokens: 0,
      fallbackOutputTokens: 0,
    })
    for (const key of Object.keys(usage)) {
      expect(key).not.toMatch(/message|content|text|prompt$|transcript/i)
    }
  })
})

describe('estimates are pessimistic on purpose', () => {
  it('applies the 1.25 multiplier from governor-spec §2', () => {
    const raw =
      (1000 * PRICING.inputPerMTok) / 1e6 + (100 * PRICING.outputPerMTok) / 1e6
    expect(estimateCostUsd(PRICING, 1000, 100, 0)).toBeCloseTo(raw * ESTIMATE_PESSIMISM, 12)
  })

  it('prices cached input at the cache rate, not the input rate', () => {
    const allCached = estimateCostUsd(PRICING, 1000, 0, 1000)
    const noneCached = estimateCostUsd(PRICING, 1000, 0, 0)
    expect(allCached).toBeLessThan(noneCached)
  })

  it('never returns a negative cost when cached exceeds prompt tokens', () => {
    expect(estimateCostUsd(PRICING, 100, 0, 500)).toBeGreaterThanOrEqual(0)
  })
})

describe('SSE chunk parsing', () => {
  it('ignores keep-alives and the [DONE] sentinel', () => {
    expect(parseChunk('')).toBeNull()
    expect(parseChunk('[DONE]')).toBeNull()
    expect(parseChunk('not json')).toBeNull()
  })

  it('reassembles a payload split across read boundaries', async () => {
    // The bug this prevents: parsing per network chunk instead of per SSE event
    // works fine until a long answer happens to split mid-JSON.
    const json = JSON.stringify({ choices: [{ delta: { content: 'hello' } }] })
    const half = Math.floor(json.length / 2)
    const payloads: string[] = []
    for await (const p of ssePayloads(stream([`data: ${json.slice(0, half)}`, `${json.slice(half)}\n\n`]))) {
      payloads.push(p)
    }
    expect(payloads).toHaveLength(1)
    expect(parseChunk(payloads[0] ?? '')?.choices?.[0]?.delta?.content).toBe('hello')
  })

  it('handles CRLF line endings', async () => {
    const payloads: string[] = []
    for await (const p of ssePayloads(stream(['data: {"a":1}\r\n\r\n']))) payloads.push(p)
    expect(payloads).toEqual(['{"a":1}'])
  })

  it('yields a trailing payload with no terminating newline', async () => {
    const payloads: string[] = []
    for await (const p of ssePayloads(stream(['data: [DONE]']))) payloads.push(p)
    expect(payloads).toEqual(['[DONE]'])
  })
})
