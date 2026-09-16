/**
 * The ledger port, plus every implementation. Storage-agnostic by design: swapping the
 * store touches this file and the caller's config, nothing in the rest of the module.
 */

import type { Clock } from './types'

export interface LedgerStore {
  /** Add amountUsd to key's running total. Never expires. Returns the new total. */
  incrBy(key: string, amountUsd: number): Promise<number>
  /** Read several counters at once. A missing key reads as 0, not an error. */
  getMany(keys: string[]): Promise<Record<string, number>>
  /**
   * Atomically increment a fixed-window counter by 1, creating it with `ttlSec` if it is
   * absent or has expired. Returns the new count. Maps to a single `governor_incr(key, 1,
   * ttl)` round trip against the real store — one call, and an expired row resets in place,
   * so there is no cleanup job to forget.
   */
  expiringIncr(key: string, ttlSec: number): Promise<number>
}

/**
 * Deterministic in-memory store for tests. Takes an injected clock so window expiry is
 * driven by the same FakeClock the rest of a test uses — no real timer ever sleeps.
 */
export class MemoryLedgerStore implements LedgerStore {
  private readonly values = new Map<string, number>()
  private readonly expiresAtMs = new Map<string, number>()

  constructor(private readonly clock: Clock) {}

  incrBy(key: string, amountUsd: number): Promise<number> {
    const next = (this.values.get(key) ?? 0) + amountUsd
    this.values.set(key, next)
    return Promise.resolve(next)
  }

  getMany(keys: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (const key of keys) out[key] = this.readLive(key)
    return Promise.resolve(out)
  }

  expiringIncr(key: string, ttlSec: number): Promise<number> {
    const nowMs = this.clock().getTime()
    const expiresAt = this.expiresAtMs.get(key)
    if (expiresAt === undefined || expiresAt <= nowMs) {
      this.values.set(key, 1)
      this.expiresAtMs.set(key, nowMs + ttlSec * 1000)
      return Promise.resolve(1)
    }
    const next = (this.values.get(key) ?? 0) + 1
    this.values.set(key, next)
    return Promise.resolve(next)
  }

  private readLive(key: string): number {
    const expiresAt = this.expiresAtMs.get(key)
    const nowMs = this.clock().getTime()
    if (expiresAt !== undefined && expiresAt <= nowMs) return 0
    return this.values.get(key) ?? 0
  }
}

/** Always throws. Exercises the fail-closed-by-error path (AC3.4). */
export class FailingStore implements LedgerStore {
  incrBy(): Promise<number> {
    return Promise.reject(new Error('ledger unavailable: incrBy'))
  }
  getMany(): Promise<Record<string, number>> {
    return Promise.reject(new Error('ledger unavailable: getMany'))
  }
  expiringIncr(): Promise<number> {
    return Promise.reject(new Error('ledger unavailable: expiringIncr'))
  }
}

/**
 * Resolves successfully but only after `delayMs`. Paired with fake timers, this exercises
 * the fail-closed-by-timeout path (AC3.4) without any test actually waiting 400ms.
 */
export class SlowStore implements LedgerStore {
  constructor(private readonly delayMs: number) {}

  async incrBy(): Promise<number> {
    await this.wait()
    return 0
  }
  async getMany(keys: string[]): Promise<Record<string, number>> {
    await this.wait()
    const out: Record<string, number> = {}
    for (const key of keys) out[key] = 0
    return out
  }
  async expiringIncr(): Promise<number> {
    await this.wait()
    return 1
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.delayMs))
  }
}

export interface SupabaseLedgerStoreConfig {
  url: string
  serviceRoleKey: string
  /** Injected for testability; defaults to the platform's global fetch. No network in tests. */
  fetchImpl?: typeof fetch
}

/**
 * Supabase Postgres via the PostgREST API (never a direct connection — serverless opens
 * many short-lived connections and REST connections establish far faster). Two RPCs and
 * one filtered select cover the three-method port; see the `governor_ledger` /
 * `governor_incr` functions this expects on the database side.
 */
export class SupabaseLedgerStore implements LedgerStore {
  private readonly url: string
  private readonly serviceRoleKey: string
  private readonly fetchImpl: typeof fetch

  constructor(cfg: SupabaseLedgerStoreConfig) {
    this.url = cfg.url.replace(/\/$/, '')
    this.serviceRoleKey = cfg.serviceRoleKey
    this.fetchImpl = cfg.fetchImpl ?? fetch
  }

  async incrBy(key: string, amountUsd: number): Promise<number> {
    const res = await this.request('/rest/v1/rpc/governor_incr_by', {
      key,
      amount: amountUsd,
    })
    const body: unknown = await res.json()
    return asTotal(body)
  }

  async getMany(keys: string[]): Promise<Record<string, number>> {
    if (keys.length === 0) return {}
    const filter = encodeURIComponent(`(${keys.join(',')})`)
    const res = await this.request(
      `/rest/v1/governor_ledger?key=in.${filter}&select=key,value`,
      undefined,
      'GET'
    )
    const rows: unknown = await res.json()
    const out: Record<string, number> = {}
    for (const key of keys) out[key] = 0
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (isLedgerRow(row)) out[row.key] = row.value
      }
    }
    return out
  }

  async expiringIncr(key: string, ttlSec: number): Promise<number> {
    const res = await this.request('/rest/v1/rpc/governor_incr', {
      key,
      amount: 1,
      ttl_sec: ttlSec,
    })
    const body: unknown = await res.json()
    return asTotal(body)
  }

  private async request(path: string, body: unknown, method: 'GET' | 'POST' = 'POST'): Promise<Response> {
    const res = await this.fetchImpl(`${this.url}${path}`, {
      method,
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`ledger store request failed: ${res.status} ${path}`)
    }
    return res
  }
}

function asTotal(body: unknown): number {
  if (typeof body === 'number') return body
  if (Array.isArray(body) && body.length > 0 && typeof body[0] === 'number') return body[0]
  throw new Error('ledger store returned a malformed response')
}

function isLedgerRow(row: unknown): row is { key: string; value: number } {
  return (
    typeof row === 'object' &&
    row !== null &&
    'key' in row &&
    'value' in row &&
    typeof (row as { key: unknown }).key === 'string' &&
    typeof (row as { value: unknown }).value === 'number'
  )
}
