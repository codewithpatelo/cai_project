import { describe, it, expect } from 'vitest'
import { daysRemaining, isReserveWindow, utcDateKey, computeSnapshot } from './pacing'
import { FakeClock, testConfig } from './test-helpers'

describe('daysRemaining', () => {
  it('ceils to whole days and never drops below 1', () => {
    const now = new Date('2026-09-20T00:00:00Z')
    expect(daysRemaining(now, '2026-09-24T01:00:00Z')).toBe(5) // 4 days + 1h -> ceil to 5
  })

  it('floors at 1 even after the horizon has passed', () => {
    const now = new Date('2026-09-25T00:00:00Z')
    expect(daysRemaining(now, '2026-09-24T01:00:00Z')).toBe(1)
  })
})

describe('isReserveWindow', () => {
  const window = { startIso: '2026-09-23T17:00:00Z', endIso: '2026-09-24T01:00:00Z' }

  it('is false before the window', () => {
    expect(isReserveWindow(new Date('2026-09-23T16:59:59Z'), window)).toBe(false)
  })
  it('is true at the exact start (inclusive)', () => {
    expect(isReserveWindow(new Date('2026-09-23T17:00:00Z'), window)).toBe(true)
  })
  it('is true just before the exact end (exclusive)', () => {
    expect(isReserveWindow(new Date('2026-09-24T00:59:59Z'), window)).toBe(true)
  })
  it('is false at the exact end (exclusive)', () => {
    expect(isReserveWindow(new Date('2026-09-24T01:00:00Z'), window)).toBe(false)
  })
})

describe('utcDateKey', () => {
  it('resets at UTC midnight regardless of local wall-clock time', () => {
    expect(utcDateKey(new Date('2026-09-23T23:59:59Z'))).toBe('2026-09-23')
    expect(utcDateKey(new Date('2026-09-24T00:00:00Z'))).toBe('2026-09-24')
  })
})

describe('computeSnapshot', () => {
  it('spreads the operating budget evenly across the days remaining', () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z')) // 7 days before expiry
    const cfg = testConfig(clock)
    const snap = computeSnapshot({ cfg, now: clock.now(), spentLifetime: 0, spentToday: 0, simulated: false })
    // operatingBudget = 5.00 - 1.20 = 3.80; daysRemaining = ceil(169h/24h) = 8
    expect(snap.dailyAllowanceUsd).toBeCloseTo(3.8 / 8, 6)
    expect(snap.reserveRemainingUsd).toBeCloseTo(1.2, 6)
    expect(snap.isReserveWindow).toBe(false)
  })

  it('shrinks tomorrow when today spent heavily (rolls forward automatically)', () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const cfg = testConfig(clock)
    const snap = computeSnapshot({ cfg, now: clock.now(), spentLifetime: 3.0, spentToday: 3.0, simulated: false })
    // operatingBudget - spentLifetime = 0.80 remaining, over 8 days
    expect(snap.dailyAllowanceUsd).toBeCloseTo(0.8 / 8, 6)
  })

  it('only counts spend past the operating budget against the reserve', () => {
    const clock = new FakeClock(new Date('2026-09-23T18:00:00Z')) // inside the reserve window
    const cfg = testConfig(clock)
    const snap = computeSnapshot({ cfg, now: clock.now(), spentLifetime: 4.0, spentToday: 0, simulated: false })
    // operatingBudget = 3.80; 4.00 spent -> 0.20 drawn from the 1.20 reserve
    expect(snap.reserveRemainingUsd).toBeCloseTo(1.0, 6)
    expect(snap.dailyAllowanceUsd).toBe(0)
  })
})
