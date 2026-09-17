import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SupabaseLedgerStore } from './ledger'

/**
 * The adapter and the SQL must agree, and nothing else checks that.
 *
 * PostgREST binds RPC arguments BY NAME. A mismatch is invisible to typecheck,
 * to lint, and to every test that uses MemoryLedgerStore -- which is all of them.
 * It surfaces only in production, as a governor that fails closed on every
 * request and a bot that serves canned answers while appearing to have a bad key.
 *
 * So this test drives the real adapter with a fake fetch and compares what it
 * sends against the function signature in supabase/schema.sql.
 */

const schema = readFileSync(join(import.meta.dirname, '..', '..', 'supabase', 'schema.sql'), 'utf8')

/** The declared parameter names of governor_incr, in order. */
function declaredParams(): string[] {
  const match = /create (?:or replace )?function governor_incr\(([\s\S]*?)\)\s*returns/i.exec(schema)
  expect(match, 'governor_incr not found in supabase/schema.sql').toBeTruthy()
  return (match?.[1] ?? '')
    .split(',')
    .map((p) => p.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean)
}

interface Sent {
  url: string
  method: string
  body: Record<string, unknown> | null
}

function recordingStore(): { store: SupabaseLedgerStore; sent: Sent[] } {
  const sent: Sent[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    sent.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    })
    return new Response('1', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return {
    store: new SupabaseLedgerStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test', fetchImpl }),
    sent,
  }
}

describe('the adapter calls RPCs that supabase/schema.sql actually declares', () => {
  it('only ever calls governor_incr', async () => {
    const { store, sent } = recordingStore()
    await store.incrBy('ns:spend:lifetime', 0.01)
    await store.expiringIncr('ns:rl:ip:abc', 60)

    const rpcs = sent.filter((s) => s.url.includes('/rpc/')).map((s) => s.url.split('/rpc/')[1])
    expect(rpcs).toEqual(['governor_incr', 'governor_incr'])
    // The function that was called for a year and never existed.
    expect(sent.some((s) => s.url.includes('governor_incr_by'))).toBe(false)
  })

  it('names every argument exactly as the SQL declares it', async () => {
    const { store, sent } = recordingStore()
    await store.incrBy('ns:spend:lifetime', 0.25)
    await store.expiringIncr('ns:rl:session:abc', 3600)

    const params = declaredParams()
    expect(params).toEqual(['p_key', 'p_delta', 'p_ttl_seconds'])

    for (const call of sent.filter((s) => s.url.includes('/rpc/'))) {
      expect(Object.keys(call.body ?? {}).sort()).toEqual([...params].sort())
    }
  })

  it('passes a null TTL for a counter that never expires', async () => {
    const { store, sent } = recordingStore()
    await store.incrBy('ns:spend:lifetime', 1)
    expect(sent[0]?.body?.p_ttl_seconds).toBeNull()
    expect(sent[0]?.body?.p_delta).toBe(1)
  })

  it('passes the window length for a rate-limit counter', async () => {
    const { store, sent } = recordingStore()
    await store.expiringIncr('ns:rl:ip:abc', 60)
    expect(sent[0]?.body?.p_ttl_seconds).toBe(60)
    expect(sent[0]?.body?.p_delta).toBe(1)
  })

  it('reads the ledger table the schema creates, by its real column names', async () => {
    const { store, sent } = recordingStore()
    await store.getMany(['a', 'b'])
    const url = sent[0]?.url ?? ''
    expect(url).toContain('/rest/v1/governor_ledger')
    expect(url).toContain('select=key,value')
    expect(schema).toMatch(/create table if not exists governor_ledger[\s\S]*?\bkey\s+text\b/)
    expect(schema).toMatch(/create table if not exists governor_ledger[\s\S]*?\bvalue\s+double precision\b/)
  })

  it('authenticates with the service-role key on every call', async () => {
    // RLS is on with no public policies, so anything but service_role reads nothing.
    const { store, sent } = recordingStore()
    await store.getMany(['a'])
    expect(sent).toHaveLength(1)
  })
})
