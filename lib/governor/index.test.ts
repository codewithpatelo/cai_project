import { describe, it, expect, vi, afterEach } from 'vitest'
import { createGovernor } from './index'
import { MemoryLedgerStore, FailingStore, SlowStore } from './ledger'
import { FakeClock, testConfig } from './test-helpers'
import type { CallUsage } from './types'

function usage(overrides: Partial<CallUsage> = {}): CallUsage {
  return {
    model: 'vendor/primary-model',
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 0,
    costUsd: 0.01,
    costSource: 'provider',
    latencyMs: 200,
    tier: 'PRIMARY',
    ...overrides,
  }
}

// --- AC3.1 / AC3.2 / AC3.3 exercised through authorize() itself, not just decideTier() ---

describe('authorize() — lifetime and reserve thresholds (AC3.1, AC3.2, AC3.3)', () => {
  it('AC3.1: lifetime spend crossing 60% of total makes authorize() return ECONOMY', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock)
    const governor = createGovernor(cfg, store)
    // Seed the lifetime counter directly, as if accrued on earlier days, so today's own
    // counter stays low and the daily-exhaustion check (spec §5) doesn't also fire and mask
    // the lifetime-threshold check this test is isolating.
    await store.incrBy('test:spend:lifetime', 3.0) // 3.00 / 5.00 = 60%

    const decision = await governor.authorize({ ip: '1.2.3.4', sessionId: 's1' })
    expect(decision.tier).toBe('ECONOMY')
    expect(decision.allowed).toBe(true)
    expect(decision.model).toBe('vendor/economy-model')
  })

  it('AC3.2: lifetime >= 76% and outside the reserve window -> STATIC, reason reserve_locked', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z')) // outside the reserve window
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock)
    const governor = createGovernor(cfg, store)
    await governor.record(usage({ costUsd: 3.8 })) // 3.80 / 5.00 = 76%

    const decision = await governor.authorize({ ip: '1.2.3.4', sessionId: 's1' })
    expect(decision).toMatchObject({ allowed: false, tier: 'STATIC', reason: 'reserve_locked', model: null })
  })

  it('AC3.3: inside the reserve window with reserve remaining -> PRIMARY', async () => {
    const clock = new FakeClock(new Date('2026-09-23T18:00:00Z')) // inside the reserve window
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock)
    const governor = createGovernor(cfg, store)
    await governor.record(usage({ costUsd: 4.5 })) // 4.50 / 5.00 = 90%, well past the static line

    const decision = await governor.authorize({ ip: '1.2.3.4', sessionId: 's1' })
    expect(decision.tier).toBe('PRIMARY')
    expect(decision.allowed).toBe(true)
    expect(decision.budgetSnapshot.isReserveWindow).toBe(true)
  })
})

// --- AC3.4: fail closed, no escape hatch ------------------------------------------------

describe('authorize() — fail closed (AC3.4)', () => {
  it('a store that throws returns {allowed:false, tier:STATIC, reason:ledger_unavailable} and no model', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const cfg = testConfig(clock)
    const governor = createGovernor(cfg, new FailingStore())

    const decision = await governor.authorize({ ip: '1.2.3.4', sessionId: 's1' })
    expect(decision).toMatchObject({ allowed: false, tier: 'STATIC', reason: 'ledger_unavailable', model: null })
  })

  describe('a store slower than its configured budget', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    // The budget is set explicitly rather than assumed. It used to be a hardcoded
    // 400ms that was never measured; this test asserts the BEHAVIOUR -- a slow
    // store fails closed at whatever ceiling is configured -- so tuning the
    // number cannot quietly turn the guarantee off.
    const BUDGET_MS = 300

    it('times out rather than waiting — a timeout IS unavailability, not a retry', async () => {
      vi.useFakeTimers()
      const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
      const cfg = { ...testConfig(clock), ledgerTimeoutMs: BUDGET_MS }
      const governor = createGovernor(cfg, new SlowStore(BUDGET_MS + 200))

      const decisionPromise = governor.authorize({ ip: '1.2.3.4', sessionId: 's1' })
      await vi.advanceTimersByTimeAsync(BUDGET_MS)
      const decision = await decisionPromise

      expect(decision).toMatchObject({ allowed: false, tier: 'STATIC', reason: 'ledger_unavailable', model: null })
    })

    it('still authorizes a store that answers inside the budget', async () => {
      // The counterpart matters as much: a ceiling set below the cost of a cold
      // connection does not protect anything, it just fails every request closed.
      vi.useFakeTimers()
      const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
      const cfg = { ...testConfig(clock), ledgerTimeoutMs: BUDGET_MS }
      const governor = createGovernor(cfg, new SlowStore(BUDGET_MS - 200))

      const decisionPromise = governor.authorize({ ip: '1.2.3.4', sessionId: 's1' })
      await vi.advanceTimersByTimeAsync(BUDGET_MS)
      const decision = await decisionPromise

      expect(decision.reason).not.toBe('ledger_unavailable')
    })
  })
})

// --- AC3.5: pessimistic estimate ---------------------------------------------------------

describe('estimateCostUsd() — pessimistic fallback estimate (AC3.5)', () => {
  it('applies the §2 formula multiplied by 1.25', () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const governor = createGovernor(testConfig(clock), new MemoryLedgerStore(clock.now))

    const cost = governor.estimateCostUsd('PRIMARY', 1_000_000, 1_000_000, 200_000)
    // PRIMARY: inputPerMTok=1, outputPerMTok=2, cachedInputPerMTok=0.5
    const raw = (800_000 * 1) / 1e6 + (200_000 * 0.5) / 1e6 + (1_000_000 * 2) / 1e6 // = 2.9
    expect(cost).toBeCloseTo(raw * 1.25, 10)
  })

  it('falls back to the plain input rate when a tier prices no cache discount', () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const governor = createGovernor(testConfig(clock), new MemoryLedgerStore(clock.now))

    // ECONOMY in the reference config has no cachedInputPerMTok.
    const cost = governor.estimateCostUsd('ECONOMY', 1000, 0, 500)
    const raw = (500 * 0.2) / 1e6 + (500 * 0.2) / 1e6
    expect(cost).toBeCloseTo(raw * 1.25, 10)
  })
})

// --- AC3.6: namespace isolation -----------------------------------------------------------

describe('namespace isolation (AC3.6)', () => {
  it('spend keys are namespace-prefixed and a dev namespace never moves a client namespace', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const devGovernor = createGovernor(testConfig(clock, { namespace: 'dev' }), store)
    const clientGovernor = createGovernor(testConfig(clock, { namespace: 'client' }), store)

    await devGovernor.record(usage({ costUsd: 1.5 }))

    const keys = await store.getMany(['dev:spend:lifetime', 'client:spend:lifetime'])
    expect(keys['dev:spend:lifetime']).toBe(1.5)
    expect(keys['client:spend:lifetime']).toBe(0)

    const clientSnapshot = await clientGovernor.snapshot()
    expect(clientSnapshot.spentUsdLifetime).toBe(0)
  })

  it('rate-limit keys are also namespace-prefixed', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const devGovernor = createGovernor(testConfig(clock, { namespace: 'dev' }), store)

    await devGovernor.authorize({ ip: '9.9.9.9', sessionId: 'sx' })

    const counts = await store.getMany(['dev:rl:ip:60:9.9.9.9', 'client:rl:ip:60:9.9.9.9'])
    expect(counts['dev:rl:ip:60:9.9.9.9']).toBe(1)
    expect(counts['client:rl:ip:60:9.9.9.9']).toBe(0)
  })
})

// --- AC3.7: demo simulation mode ----------------------------------------------------------

describe('simulation mode (AC3.7, spec §9)', () => {
  it('cfg.simulation.forceSpentUsd drives decisions, record() writes nothing, results carry simulated:true', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock, { simulation: { forceSpentUsd: 4.1 } })
    const governor = createGovernor(cfg, store)

    const decision = await governor.authorize({ ip: '1.1.1.1', sessionId: 's1' })
    expect(decision.budgetSnapshot.simulated).toBe(true)
    expect(decision.budgetSnapshot.spentUsdLifetime).toBe(4.1)
    expect(decision.reason).toBe('simulated')

    await governor.record(usage({ costUsd: 99 }))
    const stored = await store.getMany(['test:spend:lifetime'])
    expect(stored['test:spend:lifetime']).toBe(0) // record() is read-only under simulation
  })

  it('GOVERNOR_SIM_SPENT_USD=4.10 drives decisions when GOVERNOR_SIM_ENABLED=true (literal AC3.7)', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock) // no cfg.simulation set — must come from env
    process.env.GOVERNOR_SIM_ENABLED = 'true'
    process.env.GOVERNOR_SIM_SPENT_USD = '4.10'
    try {
      const governor = createGovernor(cfg, store)
      const decision = await governor.authorize({ ip: '2.2.2.2', sessionId: 's2' })
      expect(decision.budgetSnapshot.spentUsdLifetime).toBe(4.1)
      expect(decision.budgetSnapshot.simulated).toBe(true)
      expect(decision.reason).toBe('simulated')
    } finally {
      delete process.env.GOVERNOR_SIM_ENABLED
      delete process.env.GOVERNOR_SIM_SPENT_USD
    }
  })

  it('a stray GOVERNOR_SIM_SPENT_USD without GOVERNOR_SIM_ENABLED=true is ignored', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const cfg = testConfig(clock)
    process.env.GOVERNOR_SIM_SPENT_USD = '4.10' // GOVERNOR_SIM_ENABLED intentionally unset
    try {
      const governor = createGovernor(cfg, store)
      const decision = await governor.authorize({ ip: '2.2.2.3', sessionId: 's2b' })
      expect(decision.budgetSnapshot.simulated).toBe(false)
      expect(decision.reason).not.toBe('simulated')
    } finally {
      delete process.env.GOVERNOR_SIM_SPENT_USD
    }
  })

  it('simulation never touches the store, even a store that would throw', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const cfg = testConfig(clock, { simulation: { forceTier: 'PRIMARY' } })
    const governor = createGovernor(cfg, new FailingStore())

    const decision = await governor.authorize({ ip: '3.3.3.3', sessionId: 's3' })
    expect(decision.tier).toBe('PRIMARY')
    expect(decision.reason).toBe('simulated')
  })
})

// --- UTC midnight reset -------------------------------------------------------------------

describe('UTC midnight reset', () => {
  it("today's spend resets at UTC midnight while lifetime spend carries over", async () => {
    const clock = new FakeClock(new Date('2026-09-17T23:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const governor = createGovernor(testConfig(clock), store)

    await governor.record(usage({ costUsd: 0.3 }))
    let snap = await governor.snapshot()
    expect(snap.spentUsdToday).toBe(0.3)
    expect(snap.spentUsdLifetime).toBe(0.3)

    clock.advanceMs(2 * 60 * 60 * 1000) // now 2026-09-18T01:00:00Z
    snap = await governor.snapshot()
    expect(snap.spentUsdToday).toBe(0)
    expect(snap.spentUsdLifetime).toBe(0.3)
  })

  it('§5 state table: STATIC -> new UTC day, lifetime < 60% -> PRIMARY', async () => {
    const clock = new FakeClock(new Date('2026-09-17T23:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const governor = createGovernor(testConfig(clock), store)

    // Spend today's entire allowance (~0.475) without approaching the 60% lifetime line.
    await governor.record(usage({ costUsd: 0.475 }))
    const exhausted = await governor.authorize({ ip: '5.5.5.5', sessionId: 'sA' })
    expect(exhausted).toMatchObject({ tier: 'STATIC', reason: 'exhausted' })

    clock.advanceMs(2 * 60 * 60 * 1000) // crosses into the next UTC day
    const recovered = await governor.authorize({ ip: '5.5.5.6', sessionId: 'sB' })
    expect(recovered).toMatchObject({ tier: 'PRIMARY', reason: 'ok' })
  })
})

// --- History trimming (spec §6) -----------------------------------------------------------

type Msg = { role: 'user' | 'assistant'; content: string }

function pairs(n: number, content = 'hi'): Msg[] {
  const out: Msg[] = []
  for (let i = 0; i < n; i++) {
    out.push({ role: 'user', content: `${content}-u${i}` })
    out.push({ role: 'assistant', content: `${content}-a${i}` })
  }
  return out
}

describe('trimHistory() — spec §6', () => {
  const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
  const governor = createGovernor(testConfig(clock), new MemoryLedgerStore(clock.now))

  it('keeps everything, drops nothing, when under both caps', () => {
    const history = pairs(2)
    const result = governor.trimHistory(history, { maxTurns: 6, maxTokens: 1500 })
    expect(result).toEqual({ kept: history, dropped: 0, summarized: false })
  })

  it('caps at maxTurns, dropping the oldest pairs first (PRIMARY: 6 turns)', () => {
    const history = pairs(8) // 8 turns, well under the token cap
    const result = governor.trimHistory(history, { maxTurns: 6, maxTokens: 1500 })
    expect(result.dropped).toBe(2)
    // The kept span is the six most recent pairs (12 messages) plus the summary line for
    // the two dropped ones, since dropping oldest-first always removes the first turn.
    expect(result.kept).toHaveLength(13)
    expect(result.summarized).toBe(true)
    expect(result.kept[0]?.content).toContain('[earlier conversation summary]')
    expect(result.kept.slice(1)).toEqual(history.slice(4)) // last 6 pairs survive verbatim
  })

  it('caps at maxTokens even when under the turn cap (ECONOMY: 900 tok)', () => {
    // Each message is 2000 chars -> ~500 estimated tokens; each pair -> ~1000 tokens.
    const history = pairs(3, 'x'.repeat(2000))
    const result = governor.trimHistory(history, { maxTurns: 6, maxTokens: 900 })
    // 3 pairs (~3000 tok) is under the turn cap but far over the token cap; only the most
    // recent pair (~1000 tok, still over 900 alone) survives after dropping the rest.
    expect(result.dropped).toBeGreaterThan(0)
    expect(result.summarized).toBe(true)
  })

  it('summarizes instead of silently deleting the first user turn', () => {
    const history = pairs(6, 'this is the actual first question the visitor asked')
    const result = governor.trimHistory(history, { maxTurns: 4, maxTokens: 1500 })
    expect(result.summarized).toBe(true)
    expect(result.kept[0]?.role).toBe('user') // takes the role of the original first turn
    expect(result.kept[0]?.content).toContain('this is the actual first question')
  })

  it('an empty history trims to an empty history', () => {
    const result = governor.trimHistory([], { maxTurns: 6, maxTokens: 1500 })
    expect(result).toEqual({ kept: [], dropped: 0, summarized: false })
  })
})

// --- snapshot() -----------------------------------------------------------------------------

describe('snapshot()', () => {
  it('reflects accumulated spend without gating a call', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    const governor = createGovernor(testConfig(clock), store)
    await governor.record(usage({ costUsd: 0.5 }))
    const snap = await governor.snapshot()
    expect(snap.spentUsdLifetime).toBe(0.5)
    expect(snap.simulated).toBe(false)
  })

  it('fails closed to a zero snapshot rather than throwing when the store is unreachable', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const governor = createGovernor(testConfig(clock), new FailingStore())
    const snap = await governor.snapshot()
    expect(snap.spentUsdLifetime).toBe(0)
    expect(snap.spentUsdToday).toBe(0)
  })
})
