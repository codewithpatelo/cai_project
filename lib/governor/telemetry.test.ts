import { describe, it, expect } from 'vitest'
import { emitTelemetry, hashSession } from './telemetry'
import type { CallUsage } from './types'

const baseUsage: CallUsage = {
  model: 'vendor/primary-model',
  inputTokens: 7150,
  outputTokens: 243,
  cachedInputTokens: 5800,
  costUsd: 0.00278,
  costSource: 'provider',
  latencyMs: 1340,
  tier: 'PRIMARY',
}

describe('hashSession', () => {
  it('is deterministic for the same id and salt', () => {
    expect(hashSession('abc', 'salt')).toBe(hashSession('abc', 'salt'))
  })

  it('is 8 hex characters — enough to group, useless to identify', () => {
    expect(hashSession('abc', 'salt')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('differs for a different session id', () => {
    expect(hashSession('abc', 'salt')).not.toBe(hashSession('xyz', 'salt'))
  })

  it('never contains the raw session id as a substring (not reversible by inspection)', () => {
    const raw = 'user-session-123456'
    expect(hashSession(raw, 'salt')).not.toContain(raw)
  })
})

describe('emitTelemetry', () => {
  it('emits one single-line JSON row with the documented shape', () => {
    const lines: string[] = []
    emitTelemetry(
      baseUsage,
      { now: new Date('2026-09-16T12:00:00.000Z'), salt: 'salt', spentUsdLifetime: 0.412, simulated: false },
      (line) => lines.push(line)
    )
    expect(lines).toHaveLength(1)
    const row = JSON.parse(lines[0] as string) as Record<string, unknown>
    expect(row).toMatchObject({
      ts: '2026-09-16T12:00:00.000Z',
      model: 'vendor/primary-model',
      tier: 'PRIMARY',
      inputTokens: 7150,
      outputTokens: 243,
      cachedInputTokens: 5800,
      reasoningTokens: 0,
      costUsd: 0.00278,
      costSource: 'provider',
      latencyMs: 1340,
      error: null,
      spentUsdLifetime: 0.412,
      simulated: false,
    })
  })

  it('hashes sessionId into sessionHash and never includes the raw id', () => {
    const lines: string[] = []
    emitTelemetry(
      { ...baseUsage, sessionId: 'raw-session-id' },
      { now: new Date(), salt: 'salt', spentUsdLifetime: 0, simulated: false },
      (line) => lines.push(line)
    )
    const line = lines[0] as string
    expect(line).not.toContain('raw-session-id')
    const row = JSON.parse(line) as { sessionHash: string }
    expect(row.sessionHash).toBe(hashSession('raw-session-id', 'salt'))
  })

  it('sessionHash is null when no sessionId was supplied', () => {
    const lines: string[] = []
    emitTelemetry(baseUsage, { now: new Date(), salt: 'salt', spentUsdLifetime: 0, simulated: false }, (line) =>
      lines.push(line)
    )
    const row = JSON.parse(lines[0] as string) as { sessionHash: unknown }
    expect(row.sessionHash).toBeNull()
  })

  it('marks simulated telemetry rows', () => {
    const lines: string[] = []
    emitTelemetry(baseUsage, { now: new Date(), salt: 'salt', spentUsdLifetime: 4.1, simulated: true }, (line) =>
      lines.push(line)
    )
    const row = JSON.parse(lines[0] as string) as { simulated: boolean }
    expect(row.simulated).toBe(true)
  })
})
