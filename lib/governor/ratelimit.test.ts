import { describe, it, expect } from 'vitest'
import { checkRateLimits } from './ratelimit'
import { MemoryLedgerStore } from './ledger'
import { FakeClock, testConfig } from './test-helpers'

const ctx = { ip: '203.0.113.4', sessionId: 'sess-1' }

describe('checkRateLimits — spec §7, all four limits', () => {
  it('allows requests under every limit', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock)
    const result = await checkRateLimits(store, cfg, ctx)
    expect(result).toEqual({ blocked: false })
  })

  it('per-IP 60s: blocks the 9th request in a minute and reports retryAfterSec', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock)
    // Distinct session per call so the tighter per-session-60s cap (max 6) doesn't trip
    // first; this test is isolating the per-IP limit.
    for (let i = 0; i < 8; i++) {
      const result = await checkRateLimits(store, cfg, { ip: ctx.ip, sessionId: `s-${i}` })
      expect(result.blocked).toBe(false)
    }
    const ninth = await checkRateLimits(store, cfg, { ip: ctx.ip, sessionId: 's-8' })
    expect(ninth).toEqual({ blocked: true, reason: 'rate_limited_ip', retryAfterSec: 60 })
  })

  it('per-IP 60s window resets after 60 seconds', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock)
    for (let i = 0; i < 8; i++) await checkRateLimits(store, cfg, { ip: ctx.ip, sessionId: `s-${i}` })
    expect((await checkRateLimits(store, cfg, { ip: ctx.ip, sessionId: 's-8' })).blocked).toBe(true)
    clock.advanceMs(61_000)
    expect((await checkRateLimits(store, cfg, { ip: ctx.ip, sessionId: 's-9' })).blocked).toBe(false)
  })

  it('per-IP 24h: blocks the 81st request in a day, no retryAfterSec (STATIC for the rest of the window)', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock)
    // A distinct session per call, and the clock stepped past the 60s window each time, so
    // only the per-IP daily cap can bind.
    for (let i = 0; i < 80; i++) {
      const result = await checkRateLimits(store, cfg, { ip: ctx.ip, sessionId: `s-${i}` })
      clock.advanceMs(61_000)
      expect(result.blocked).toBe(false)
    }
    const breach = await checkRateLimits(store, cfg, { ip: ctx.ip, sessionId: 's-final' })
    expect(breach).toEqual({ blocked: true, reason: 'rate_limited_ip' })
  })

  it('per-session 60s: blocks the 7th request in a minute and reports retryAfterSec', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock)
    for (let i = 0; i < 6; i++) {
      const result = await checkRateLimits(store, cfg, { ip: `1.1.1.${i}`, sessionId: ctx.sessionId })
      expect(result.blocked).toBe(false)
    }
    const seventh = await checkRateLimits(store, cfg, { ip: '1.1.1.99', sessionId: ctx.sessionId })
    expect(seventh).toEqual({ blocked: true, reason: 'rate_limited_session', retryAfterSec: 60 })
  })

  it('per-session lifetime: blocks the 41st message ever, no retryAfterSec ("start a new conversation")', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock)
    for (let i = 0; i < 40; i++) {
      // Spread across IPs/minutes so only the lifetime session cap is exercised.
      const result = await checkRateLimits(store, cfg, { ip: `10.0.0.${i % 250}`, sessionId: ctx.sessionId })
      clock.advanceMs(61_000)
      expect(result.blocked).toBe(false)
    }
    const breach = await checkRateLimits(store, cfg, { ip: '10.0.0.250', sessionId: ctx.sessionId })
    expect(breach).toEqual({ blocked: true, reason: 'rate_limited_session' })
  })

  it('every counter increments even on an already-blocked request (no free window)', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock)
    for (let i = 0; i < 9; i++) await checkRateLimits(store, cfg, ctx)
    const counts = await store.getMany([`test:rl:ip:60:${ctx.ip}`])
    expect(counts[`test:rl:ip:60:${ctx.ip}`]).toBe(9)
  })
})
