import { describe, it, expect } from 'vitest'
import { simulationFromEnv, assertValidConfig } from './config'
import { FakeClock, testConfig } from './test-helpers'

describe('simulationFromEnv — spec §9', () => {
  it('is undefined when GOVERNOR_SIM_ENABLED is unset (production default: cannot be faked by a stray env var)', () => {
    expect(simulationFromEnv({})).toBeUndefined()
  })

  it('is undefined when GOVERNOR_SIM_ENABLED is not exactly "true"', () => {
    expect(simulationFromEnv({ GOVERNOR_SIM_ENABLED: 'yes', GOVERNOR_SIM_SPENT_USD: '4.10' })).toBeUndefined()
  })

  it('parses GOVERNOR_SIM_SPENT_USD when enabled (AC3.7)', () => {
    const sim = simulationFromEnv({ GOVERNOR_SIM_ENABLED: 'true', GOVERNOR_SIM_SPENT_USD: '4.10' })
    expect(sim).toEqual({ forceSpentUsd: 4.1 })
  })

  it('parses GOVERNOR_SIM_TIER when enabled', () => {
    const sim = simulationFromEnv({ GOVERNOR_SIM_ENABLED: 'true', GOVERNOR_SIM_TIER: 'ECONOMY' })
    expect(sim).toEqual({ forceTier: 'ECONOMY' })
  })

  it('ignores a malformed tier value', () => {
    const sim = simulationFromEnv({ GOVERNOR_SIM_ENABLED: 'true', GOVERNOR_SIM_TIER: 'NOT_A_TIER' })
    expect(sim).toBeUndefined()
  })
})

describe('assertValidConfig', () => {
  const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))

  it('accepts the reference config', () => {
    expect(() => assertValidConfig(testConfig(clock))).not.toThrow()
  })

  it('rejects a reserve larger than the total budget', () => {
    expect(() => assertValidConfig(testConfig(clock, { reserveUsd: 10 }))).toThrow()
  })

  it('rejects thresholds that are not economy < static', () => {
    expect(() =>
      assertValidConfig(
        testConfig(clock, { thresholds: { economyAtLifetimeFraction: 0.8, staticAtLifetimeFraction: 0.6, economyAtDailyFraction: 0.8 } })
      )
    ).toThrow()
  })

  it('rejects a reserve window that ends before it starts', () => {
    expect(() =>
      assertValidConfig(
        testConfig(clock, { reserveWindow: { startIso: '2026-09-24T01:00:00Z', endIso: '2026-09-23T17:00:00Z' } })
      )
    ).toThrow()
  })

  it('rejects an empty namespace', () => {
    expect(() => assertValidConfig(testConfig(clock, { namespace: '' }))).toThrow()
  })
})
