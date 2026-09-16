import { describe, it, expect } from 'vitest'
import { decideTier, modelFor, historyBudgetFor } from './tiers'
import { FakeClock, testConfig } from './test-helpers'
import type { BudgetSnapshot } from './types'

const clock = new FakeClock(new Date('2026-09-17T00:00:00Z')) // outside the reserve window
const cfg = testConfig(clock)

function snapshot(overrides: Partial<BudgetSnapshot>): BudgetSnapshot {
  return {
    spentUsdLifetime: 0,
    spentUsdToday: 0,
    dailyAllowanceUsd: 0.475, // 3.80 operating / 8 days, matches the reference config
    reserveRemainingUsd: 1.2,
    daysRemaining: 8,
    isReserveWindow: false,
    simulated: false,
    ...overrides,
  }
}

// --- spec §5 state table, one test per row -------------------------------------------

describe('§5 state table: PRIMARY -> ECONOMY', () => {
  it('lifetime >= 60% of total crosses to ECONOMY (AC3.1)', () => {
    const snap = snapshot({ spentUsdLifetime: 3.0 }) // 3.00 / 5.00 = 60%
    expect(decideTier(snap, cfg)).toEqual({ tier: 'ECONOMY', reason: 'lifetime_threshold' })
  })

  it('today >= 80% of the daily allowance crosses to ECONOMY (paced_down)', () => {
    const snap = snapshot({ spentUsdLifetime: 1.0, spentUsdToday: 0.4, dailyAllowanceUsd: 0.475 })
    // 0.4 / 0.475 = 84.2% >= 80%, and lifetime 1.0/5.0=20% is well under the 60% line
    expect(decideTier(snap, cfg)).toEqual({ tier: 'ECONOMY', reason: 'paced_down' })
  })

  it('stays PRIMARY below both thresholds', () => {
    const snap = snapshot({ spentUsdLifetime: 1.0, spentUsdToday: 0.1 })
    expect(decideTier(snap, cfg)).toEqual({ tier: 'PRIMARY', reason: 'ok' })
  })
})

describe('§5 state table: ECONOMY -> STATIC', () => {
  it('lifetime >= 76% outside the reserve window -> STATIC reserve_locked (AC3.2)', () => {
    const snap = snapshot({ spentUsdLifetime: 3.8, isReserveWindow: false }) // 3.80/5.00 = 76%
    expect(decideTier(snap, cfg)).toEqual({ tier: 'STATIC', reason: 'reserve_locked' })
  })

  it('daily allowance exhausted -> STATIC exhausted', () => {
    const snap = snapshot({ spentUsdLifetime: 3.1, spentUsdToday: 0.5, dailyAllowanceUsd: 0.5 })
    expect(decideTier(snap, cfg)).toEqual({ tier: 'STATIC', reason: 'exhausted' })
  })
})

describe('§5 state table: STATIC -> PRIMARY / ECONOMY on a new UTC day', () => {
  it('new day, lifetime < 60% -> PRIMARY', () => {
    const snap = snapshot({ spentUsdLifetime: 1.0, spentUsdToday: 0 }) // fresh day counter
    expect(decideTier(snap, cfg)).toEqual({ tier: 'PRIMARY', reason: 'ok' })
  })

  it('new day, 60% <= lifetime < 76% -> ECONOMY', () => {
    const snap = snapshot({ spentUsdLifetime: 3.2, spentUsdToday: 0 })
    expect(decideTier(snap, cfg)).toEqual({ tier: 'ECONOMY', reason: 'lifetime_threshold' })
  })
})

describe('§5 state table: STATIC -> PRIMARY on entering the reserve window', () => {
  it('inside the reserve window with reserve remaining -> PRIMARY (AC3.3)', () => {
    const snap = snapshot({ spentUsdLifetime: 4.5, isReserveWindow: true, reserveRemainingUsd: 0.7 })
    expect(decideTier(snap, cfg)).toEqual({ tier: 'PRIMARY', reason: 'ok' })
  })

  it('inside the reserve window but the reserve itself is spent -> STATIC exhausted', () => {
    const snap = snapshot({ spentUsdLifetime: 5.0, isReserveWindow: true, reserveRemainingUsd: 0 })
    expect(decideTier(snap, cfg)).toEqual({ tier: 'STATIC', reason: 'exhausted' })
  })
})

// The state table's last row — "any -> simulation.forceTier set -> that tier" — is applied
// in index.ts's authorize(), one layer above decideTier(); see index.test.ts for that
// coverage (AC3.7), since it requires the simulation short-circuit, not just tier math.

// --- model and history-budget selection per tier --------------------------------------

describe('modelFor', () => {
  it('returns the pinned id for PRIMARY and ECONOMY, and null for STATIC', () => {
    expect(modelFor('PRIMARY', cfg)).toBe('vendor/primary-model')
    expect(modelFor('ECONOMY', cfg)).toBe('vendor/economy-model')
    expect(modelFor('STATIC', cfg)).toBeNull()
  })
})

describe('historyBudgetFor', () => {
  it('PRIMARY gets 6 turns / 1500 tokens', () => {
    expect(historyBudgetFor('PRIMARY', cfg)).toEqual({ maxTurns: 6, maxTokens: 1500 })
  })
  it('ECONOMY gets 4 turns / 900 tokens', () => {
    expect(historyBudgetFor('ECONOMY', cfg)).toEqual({ maxTurns: 4, maxTokens: 900 })
  })
  it('STATIC gets nothing: no model call is made', () => {
    expect(historyBudgetFor('STATIC', cfg)).toEqual({ maxTurns: 0, maxTokens: 0 })
  })
})
