/**
 * Shared test fixtures. Not a `*.test.ts` file itself, so vitest never collects it as a
 * suite; it exists purely to keep every governor test on the same injected clock and the
 * same baseline config instead of re-deriving one per file.
 */

import type { Clock, GovernorConfig } from './types'

export class FakeClock {
  private current: Date

  constructor(initial: Date) {
    this.current = initial
  }

  now: Clock = () => this.current

  set(next: Date): void {
    this.current = next
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}

/**
 * A representative 7-day/$5 budget shaped like the reference deployment's numbers, but
 * with no field naming any product — proof this config is just data. Individual tests
 * override only the fields the row under test cares about.
 */
export function testConfig(clock: FakeClock, overrides: Partial<GovernorConfig> = {}): GovernorConfig {
  return {
    namespace: 'test',
    totalBudgetUsd: 5.0,
    reserveUsd: 1.2,
    reserveWindow: {
      startIso: '2026-09-23T17:00:00Z',
      endIso: '2026-09-24T01:00:00Z',
    },
    keyExpiresAtIso: '2026-09-24T01:00:00Z',
    tiers: {
      PRIMARY: { id: 'vendor/primary-model', inputPerMTok: 1, outputPerMTok: 2, cachedInputPerMTok: 0.5 },
      ECONOMY: { id: 'vendor/economy-model', inputPerMTok: 0.2, outputPerMTok: 0.4 },
    },
    thresholds: {
      economyAtLifetimeFraction: 0.6,
      staticAtLifetimeFraction: 0.76,
      economyAtDailyFraction: 0.8,
    },
    context: {
      maxOutputTokens: 500,
      primaryHistory: { maxTurns: 6, maxTokens: 1500 },
      economyHistory: { maxTurns: 4, maxTokens: 900 },
    },
    rateLimits: {
      perIp: { windowSec: 60, max: 8 },
      perSession: { windowSec: 60, max: 6 },
      perIpDaily: { windowSec: 86400, max: 80 },
      perSessionLifetime: { max: 40 },
    },
    now: clock.now,
    telemetrySalt: 'test-salt-not-a-real-secret',
    ...overrides,
  }
}
