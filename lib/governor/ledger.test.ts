import { describe, it, expect, vi, afterEach } from 'vitest'
import { MemoryLedgerStore, FailingStore, SlowStore, SupabaseLedgerStore } from './ledger'
import type { LedgerStore } from './ledger'
import { FakeClock } from './test-helpers'

describe('MemoryLedgerStore', () => {
  it('incrBy accumulates and returns the running total', async () => {
    const store = new MemoryLedgerStore(new FakeClock(new Date('2026-09-17T00:00:00Z')).now)
    await store.incrBy('k', 1.5)
    const total = await store.incrBy('k', 2.5)
    expect(total).toBe(4)
  })

  it('getMany reads a missing key as 0, not an error', async () => {
    const store = new MemoryLedgerStore(new FakeClock(new Date()).now)
    const out = await store.getMany(['never-written'])
    expect(out).toEqual({ 'never-written': 0 })
  })

  it('expiringIncr creates a fresh counter with a ttl and increments within the window', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    expect(await store.expiringIncr('rl', 60)).toBe(1)
    clock.advanceMs(30_000)
    expect(await store.expiringIncr('rl', 60)).toBe(2)
  })

  it('expiringIncr resets the counter once the ttl has elapsed (an expired row resets in place)', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    await store.expiringIncr('rl', 60)
    clock.advanceMs(61_000)
    expect(await store.expiringIncr('rl', 60)).toBe(1)
  })

  it('getMany also reflects an expired window as 0', async () => {
    const clock = new FakeClock(new Date('2026-09-17T00:00:00Z'))
    const store = new MemoryLedgerStore(clock.now)
    await store.expiringIncr('rl', 60)
    clock.advanceMs(61_000)
    expect(await store.getMany(['rl'])).toEqual({ rl: 0 })
  })
})

describe('FailingStore', () => {
  it('every method rejects', async () => {
    const store: LedgerStore = new FailingStore()
    await expect(store.incrBy('k', 1)).rejects.toThrow()
    await expect(store.getMany(['k'])).rejects.toThrow()
    await expect(store.expiringIncr('k', 60)).rejects.toThrow()
  })
})

describe('SlowStore', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves, but only after the configured delay (fake timers only — no real wait)', async () => {
    vi.useFakeTimers()
    const store: LedgerStore = new SlowStore(1000)
    const pending = store.incrBy('k', 1)
    let resolved = false
    void pending.then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)
  })
})

describe('SupabaseLedgerStore', () => {
  function fakeFetch(status: number, body: unknown): typeof fetch {
    return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
  }

  it('incrBy posts to governor_incr and returns the new total', async () => {
    // This test used to assert a `governor_incr_by` RPC that was never created.
    // It passed, because it checked that the adapter did what the adapter did --
    // not that the database had anything to answer with. The contract against
    // supabase/schema.sql lives in ledger.contract.test.ts.
    const fetchImpl = fakeFetch(200, 4.2)
    const store = new SupabaseLedgerStore({ url: 'https://example.test', serviceRoleKey: 'k', fetchImpl })
    const total = await store.incrBy('ns:spend:lifetime', 1.1)
    expect(total).toBe(4.2)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/rest/v1/rpc/governor_incr',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('getMany defaults missing rows to 0', async () => {
    const fetchImpl = fakeFetch(200, [{ key: 'a', value: 1 }])
    const store = new SupabaseLedgerStore({ url: 'https://example.test', serviceRoleKey: 'k', fetchImpl })
    const out = await store.getMany(['a', 'b'])
    expect(out).toEqual({ a: 1, b: 0 })
  })

  it('throws (never returns a fabricated number) on a non-ok response', async () => {
    const fetchImpl = fakeFetch(500, { error: 'boom' })
    const store = new SupabaseLedgerStore({ url: 'https://example.test', serviceRoleKey: 'k', fetchImpl })
    await expect(store.incrBy('k', 1)).rejects.toThrow()
  })
})
