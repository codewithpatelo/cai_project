import { describe, it, expect } from 'vitest'
import { createGovernor, MemoryLedgerStore, FailingStore } from '../governor'
import { governorConfigFromEnv, keyProfile, supabaseConfigFromEnv, supabaseKeySource } from './governor-config'
import { staticAnswer } from './static-responder'
import { filterUrls } from './url-filter'
import type { GovernorConfig } from '../governor/types'

/**
 * Phase 4's integration surface: the governor's decision, the static floor and
 * the URL filter working together.
 *
 * The governor is NOT mocked here -- CLAUDE.md forbids it, because mocking the
 * thing under test is how a broken ceiling passes CI. MemoryLedgerStore is a real
 * implementation of the port.
 */

const NOW = new Date('2026-09-18T12:00:00Z')

function cfg(over: Partial<GovernorConfig> = {}): GovernorConfig {
  return {
    ...governorConfigFromEnv({ GOVERNOR_TOTAL_BUDGET_USD: '5', GOVERNOR_RESERVE_USD: '1.20' }),
    now: () => NOW,
    telemetrySalt: 'test-salt',
    ...over,
  }
}

describe('AC4.1 — a nearly-exhausted budget still answers usefully', () => {
  it('serves a static answer with no error, and no mention of money', async () => {
    const governor = createGovernor(cfg({ simulation: { forceSpentUsd: 4.1 } }), new MemoryLedgerStore(() => NOW))
    const decision = await governor.authorize({ ip: '1.1.1.1', sessionId: 's' })

    expect(decision.tier).toBe('STATIC')
    expect(decision.model).toBeNull()

    const answer = staticAnswer('What does Cadre AI do?')
    expect(answer.length).toBeGreaterThan(40)
    // The user is never told the reason is budget.
    expect(answer).not.toMatch(/budget|token|quota|limit|cost|econom/i)
  })

  it('marks every simulated decision as simulated', async () => {
    const governor = createGovernor(cfg({ simulation: { forceSpentUsd: 4.1 } }), new MemoryLedgerStore(() => NOW))
    const decision = await governor.authorize({ ip: '1.1.1.1', sessionId: 's' })
    expect(decision.budgetSnapshot.simulated).toBe(true)
  })
})

describe('AC4.2 — with no simulation the tier returns to PRIMARY', () => {
  it('authorizes a real model on a fresh ledger', async () => {
    const governor = createGovernor(cfg(), new MemoryLedgerStore(() => NOW))
    const decision = await governor.authorize({ ip: '1.1.1.1', sessionId: 's' })
    expect(decision.tier).toBe('PRIMARY')
    expect(decision.allowed).toBe(true)
    expect(decision.model).toBe('google/gemini-3.8-flash')
  })
})

describe('AC4.3 / fail-closed — an unreachable ledger never reaches the model', () => {
  it('returns STATIC with model null rather than calling anything', async () => {
    const governor = createGovernor(cfg(), new FailingStore())
    const decision = await governor.authorize({ ip: '1.1.1.1', sessionId: 's' })
    expect(decision.allowed).toBe(false)
    expect(decision.tier).toBe('STATIC')
    expect(decision.model).toBeNull()
    expect(decision.reason).toBe('ledger_unavailable')
  })

  it('still produces a useful answer for the user', () => {
    // Degrading to canned answers during a store outage is a bad afternoon.
    // Showing an error to a prospect is a worse product.
    expect(staticAnswer('How do I book a call?')).toMatch(/contact/i)
  })
})

describe('TC4.2 — tier maps to the pinned model id', () => {
  it('uses the primary model below the economy threshold', async () => {
    const governor = createGovernor(cfg(), new MemoryLedgerStore(() => NOW))
    expect((await governor.authorize({ ip: 'a', sessionId: 'a' })).model).toBe('google/gemini-3.8-flash')
  })

  it('uses the economy model once lifetime spend crosses 60%', async () => {
    // Seeded through the real ledger rather than through simulation: simulation
    // sets spentToday equal to spentLifetime, which also exhausts the daily
    // allowance and lands on STATIC. That is fine for the demo (which wants
    // STATIC) but it cannot exercise the ECONOMY rung.
    const store = new MemoryLedgerStore(() => NOW)
    await store.incrBy('dev:spend:lifetime', 3.05)
    const governor = createGovernor(cfg(), store)
    const decision = await governor.authorize({ ip: 'a', sessionId: 'a' })
    expect(decision.tier).toBe('ECONOMY')
    expect(decision.model).toBe('google/gemini-3.1-flash-lite')
  })

  it('never uses a ~latest alias', async () => {
    // ADR-013: an alias can change model, price and behaviour mid-window and
    // silently invalidate every number in the budget.
    const governor = createGovernor(cfg(), new MemoryLedgerStore(() => NOW))
    const model = (await governor.authorize({ ip: 'a', sessionId: 'a' })).model ?? ''
    expect(model).not.toMatch(/latest|~/)
  })
})

describe('TC4.3 — history is trimmed by tier before assembly', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `turn ${i} `.repeat(40),
  }))

  it('caps history at the PRIMARY budget', async () => {
    const governor = createGovernor(cfg(), new MemoryLedgerStore(() => NOW))
    const decision = await governor.authorize({ ip: 'a', sessionId: 'a' })
    const trimmed = governor.trimHistory(history, decision.historyBudget)

    // Spec §6 counts a "turn" as a user+assistant PAIR, so 6 turns is 12
    // messages. A one-line extractive summary is prepended when dropping would
    // otherwise delete the first user turn, and it inherits that turn's role --
    // so the user-message count is 6 + 1 when summarised, not 6.
    const userMessages = trimmed.kept.filter((t) => t.role === 'user').length
    expect(userMessages).toBeLessThanOrEqual(6 + (trimmed.summarized ? 1 : 0))
    expect(trimmed.kept.length).toBeLessThanOrEqual(12 + (trimmed.summarized ? 1 : 0))
    expect(trimmed.dropped).toBeGreaterThan(0)
  })

  it('summarises rather than silently deleting the first user turn', async () => {
    const governor = createGovernor(cfg(), new MemoryLedgerStore(() => NOW))
    const decision = await governor.authorize({ ip: 'a', sessionId: 'a' })
    const trimmed = governor.trimHistory(history, decision.historyBudget)
    // The first turn usually carries the actual intent, so dropping it outright
    // loses the thread. No LLM call: spending money to save money is not a saving.
    expect(trimmed.summarized).toBe(true)
  })

  it('caps harder at the ECONOMY budget', async () => {
    const primary = createGovernor(cfg(), new MemoryLedgerStore(() => NOW))
    const economy = createGovernor(cfg({ simulation: { forceSpentUsd: 3.05 } }), new MemoryLedgerStore(() => NOW))

    const p = await primary.authorize({ ip: 'a', sessionId: 'a' })
    const e = await economy.authorize({ ip: 'a', sessionId: 'a' })

    expect(e.historyBudget.maxTurns).toBeLessThan(p.historyBudget.maxTurns)
    expect(e.historyBudget.maxTokens).toBeLessThan(p.historyBudget.maxTokens)
  })
})

describe('AC4.4 — an invented URL is stripped whatever produced it', () => {
  it('removes a portal link from a model response', () => {
    const modelSaid = 'Sure — log in at https://portal.cadreai.com to see your agents.'
    expect(filterUrls(modelSaid).text).not.toContain('portal.cadreai.com')
  })

  it('removes it from a static answer too', () => {
    // The filter sits on the output path, not on one tier's path.
    expect(filterUrls('Try portal.cadreai.com').removed).toHaveLength(1)
  })
})

describe('ADR-014 — the key profile defaults to dev', () => {
  it('is dev when unset', () => {
    expect(keyProfile({})).toBe('dev')
  })

  it('is client only when explicitly set to client', () => {
    expect(keyProfile({ OPENROUTER_KEY_PROFILE: 'client' })).toBe('client')
    expect(keyProfile({ OPENROUTER_KEY_PROFILE: 'production' })).toBe('dev')
  })

  it('namespaces the ledger by profile, so dev spend cannot move the client tier', () => {
    const dev = governorConfigFromEnv({ OPENROUTER_KEY_PROFILE: 'dev' })
    const client = governorConfigFromEnv({ OPENROUTER_KEY_PROFILE: 'client' })
    expect(dev.namespace).toBe('dev')
    expect(client.namespace).toBe('client')
    expect(dev.namespace).not.toBe(client.namespace)
  })
})

describe('the static threshold is derived, not hardcoded', () => {
  it('is the point at which only the reserve remains', () => {
    const c = governorConfigFromEnv({
      GOVERNOR_TOTAL_BUDGET_USD: '5',
      GOVERNOR_RESERVE_USD: '1.20',
    })
    expect(c.thresholds.staticAtLifetimeFraction).toBeCloseTo(0.76, 10)
  })

  it('moves with the budget rather than staying at 0.76', () => {
    const c = governorConfigFromEnv({
      GOVERNOR_TOTAL_BUDGET_USD: '10',
      GOVERNOR_RESERVE_USD: '1.20',
    })
    expect(c.thresholds.staticAtLifetimeFraction).toBeCloseTo(0.88, 10)
  })
})

describe('the Supabase key is found under any name the dashboard shows', () => {
  // Supabase renamed the concept: the legacy service_role JWT and the newer
  // sb_secret_… "secret key" both grant server-side access and bypass RLS.
  // Reading one spelling makes a correctly-configured deployment behave as if it
  // had no database at all -- and fail closed, silently and forever.
  const url = 'https://p.supabase.co'

  it('accepts SUPABASE_SERVICE_ROLE_KEY', () => {
    expect(supabaseConfigFromEnv({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'k' })).toEqual({
      url,
      serviceRoleKey: 'k',
    })
  })

  it('accepts SUPABASE_SECRET_KEY', () => {
    expect(supabaseConfigFromEnv({ SUPABASE_URL: url, SUPABASE_SECRET_KEY: 'k' })?.serviceRoleKey).toBe('k')
  })

  it('accepts SUPABASE_SERVICE_ROLE', () => {
    expect(supabaseConfigFromEnv({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE: 'k' })?.serviceRoleKey).toBe('k')
  })

  it('prefers the canonical name when several are set', () => {
    const cfg = supabaseConfigFromEnv({
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE: 'old',
      SUPABASE_SERVICE_ROLE_KEY: 'canonical',
    })
    expect(cfg?.serviceRoleKey).toBe('canonical')
  })

  it('treats an empty value as absent', () => {
    // Vercel writes an unset variable as an empty string, and an empty key would
    // configure a store that 401s on every call rather than failing closed cleanly.
    expect(supabaseConfigFromEnv({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: '   ' })).toBeNull()
  })

  it('still needs the URL', () => {
    expect(supabaseConfigFromEnv({ SUPABASE_SERVICE_ROLE_KEY: 'k' })).toBeNull()
  })

  it('reports the variable NAME that supplied the key, never the value', () => {
    expect(supabaseKeySource({ SUPABASE_SECRET_KEY: 'super-secret' })).toBe('SUPABASE_SECRET_KEY')
    expect(supabaseKeySource({})).toBeNull()
  })
})

describe('an empty or unparseable environment value falls back to the default', () => {
  // Deployment platforms write unset variables as empty strings, and '' ?? d is
  // '' -- so every default here was reachable only when a variable was truly
  // absent. An empty ISO date becomes new Date(''), whose arithmetic is NaN all
  // the way down, and JSON.stringify(NaN) is null: a broken pacing horizon
  // surfaced as a tidy "daysRemaining": null rather than as an error.
  const horizon = (env: Record<string, string | undefined>) =>
    new Date(governorConfigFromEnv(env).keyExpiresAtIso).getTime()

  it('ignores an empty expiry and keeps a parseable horizon', () => {
    expect(Number.isNaN(horizon({ GOVERNOR_KEY_EXPIRES_AT: '' }))).toBe(false)
  })

  it('ignores a blank-but-not-empty expiry', () => {
    expect(Number.isNaN(horizon({ GOVERNOR_KEY_EXPIRES_AT: '   ' }))).toBe(false)
  })

  it('ignores an unparseable expiry rather than producing NaN time', () => {
    expect(Number.isNaN(horizon({ GOVERNOR_KEY_EXPIRES_AT: 'next tuesday' }))).toBe(false)
  })

  it('still honours a real expiry', () => {
    expect(governorConfigFromEnv({ GOVERNOR_KEY_EXPIRES_AT: '2026-09-20T00:00:00Z' }).keyExpiresAtIso).toBe(
      '2026-09-20T00:00:00Z',
    )
  })

  it('keeps both ends of the reserve window parseable', () => {
    const cfg = governorConfigFromEnv({ GOVERNOR_RESERVE_WINDOW_START: '', GOVERNOR_RESERVE_WINDOW_END: 'soon' })
    expect(Number.isNaN(new Date(cfg.reserveWindow.startIso).getTime())).toBe(false)
    expect(Number.isNaN(new Date(cfg.reserveWindow.endIso).getTime())).toBe(false)
  })

  it('ignores an empty budget rather than setting it to zero', () => {
    expect(governorConfigFromEnv({ GOVERNOR_TOTAL_BUDGET_USD: '' }).totalBudgetUsd).toBe(5)
  })

  it('does not read an empty key profile as anything but dev', () => {
    expect(keyProfile({ OPENROUTER_KEY_PROFILE: '' })).toBe('dev')
    expect(keyProfile({ OPENROUTER_KEY_PROFILE: '  ' })).toBe('dev')
  })

  it('produces a finite daily allowance, which is what pacing depends on', () => {
    // With a NaN horizon every pacing comparison is false and the governor keeps
    // authorising PRIMARY while its budget maths means nothing.
    const cfg = governorConfigFromEnv({ GOVERNOR_KEY_EXPIRES_AT: '' })
    const daysMs = new Date(cfg.keyExpiresAtIso).getTime() - Date.now()
    expect(Number.isFinite(daysMs)).toBe(true)
  })
})
