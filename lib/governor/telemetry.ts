/**
 * One structured line per call (spec §8). Deliberately not a table: nothing queries it on
 * the hot path, and a table would invite someone to eventually put message content in it.
 *
 * The rule that no transcript can leak through here is structural: this function's only
 * input is a CallUsage, and CallUsage has no field that can hold message text (enforced by
 * lib/guardrails.test.ts, not by convention).
 */

import { createHmac } from 'node:crypto'
import type { CallUsage } from './types'

/** HMAC-SHA256(sessionId, salt), truncated to 8 hex chars: groups a conversation, identifies no one. */
export function hashSession(sessionId: string, salt: string): string {
  return createHmac('sha256', salt).update(sessionId).digest('hex').slice(0, 8)
}

export interface TelemetryContext {
  now: Date
  salt: string
  spentUsdLifetime: number
  simulated: boolean
}

export type TelemetrySink = (line: string) => void

export function emitTelemetry(usage: CallUsage, ctx: TelemetryContext, sink: TelemetrySink = console.log): void {
  const row = {
    ts: ctx.now.toISOString(),
    model: usage.model,
    tier: usage.tier,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens ?? 0,
    costUsd: usage.costUsd,
    costSource: usage.costSource,
    latencyMs: usage.latencyMs,
    error: usage.error ?? null,
    sessionHash: usage.sessionId !== undefined ? hashSession(usage.sessionId, ctx.salt) : null,
    spentUsdLifetime: ctx.spentUsdLifetime,
    simulated: ctx.simulated,
  }
  sink(JSON.stringify(row))
}
