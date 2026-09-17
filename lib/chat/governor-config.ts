/**
 * Builds the governor's config from the environment.
 *
 * This is the domain edge: lib/governor knows nothing about Cadre, env var names
 * or OpenRouter, so the mapping from deployment settings to a GovernorConfig
 * lives out here. Changing the budget touches exactly this object
 * (docs/architecture.md §6).
 */

import type { GovernorConfig } from '../governor/types'
import { simulationFromEnv } from '../governor'
import { primaryTier, economyTier, type EnvLike } from '../llm/models'

export type KeyProfile = 'dev' | 'client'

/**
 * Which budget this deployment is spending (ADR-014).
 *
 * The profile drives the ledger namespace, so dev spend is physically incapable
 * of moving the client's pacing curve or degradation tier. That isolation is in
 * the database key, not in anyone's memory.
 *
 * Defaults to `dev`: the failure we must never have is a deployment that spends
 * the client's non-regenerable $5 because a variable was unset.
 */
export function keyProfile(env: EnvLike = process.env): KeyProfile {
  return present(env.OPENROUTER_KEY_PROFILE) === 'client' ? 'client' : 'dev'
}

/**
 * A configured value, or undefined.
 *
 * Deployment platforms write an unset variable as an EMPTY STRING, and `'' ?? d`
 * is `''`, not `d`. Every default in this file was reachable only when a variable
 * was truly absent -- and an empty ISO date then became `new Date('')`, whose
 * arithmetic is NaN all the way down. `JSON.stringify(NaN)` is `null`, which is
 * how a broken pacing horizon showed up as a tidy `"daysRemaining": null` rather
 * than as an error.
 */
function present(raw: string | undefined): string | undefined {
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : undefined
}

function num(raw: string | undefined, fallback: number): number {
  const parsed = Number(present(raw))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * An ISO timestamp that actually parses, or the fallback.
 *
 * An unparseable horizon does not fail loudly; it makes daysRemaining NaN, which
 * makes the daily allowance NaN, which makes every pacing comparison false. The
 * governor would keep authorising PRIMARY while its budget maths meant nothing.
 */
function iso(raw: string | undefined, fallback: string): string {
  const value = present(raw)
  if (value === undefined) return fallback
  return Number.isNaN(new Date(value).getTime()) ? fallback : value
}

export function governorConfigFromEnv(env: EnvLike = process.env): GovernorConfig {
  const totalBudgetUsd = num(env.GOVERNOR_TOTAL_BUDGET_USD, 5)
  const reserveUsd = num(env.GOVERNOR_RESERVE_USD, 1.2)

  return {
    namespace: keyProfile(env),
    totalBudgetUsd,
    reserveUsd,
    reserveWindow: {
      startIso: iso(env.GOVERNOR_RESERVE_WINDOW_START, '2026-09-23T17:00:00Z'),
      endIso: iso(env.GOVERNOR_RESERVE_WINDOW_END, '2026-09-24T01:00:00Z'),
    },
    keyExpiresAtIso: iso(env.GOVERNOR_KEY_EXPIRES_AT, '2026-09-24T01:00:00Z'),
    tiers: { PRIMARY: primaryTier(env), ECONOMY: economyTier(env) },
    thresholds: {
      economyAtLifetimeFraction: 0.6,
      // Not arbitrary: the point at which only the locked reserve remains.
      staticAtLifetimeFraction: (totalBudgetUsd - reserveUsd) / totalBudgetUsd,
      economyAtDailyFraction: 0.8,
    },
    context: {
      maxOutputTokens: 250,
      primaryHistory: { maxTurns: 6, maxTokens: 1500 },
      economyHistory: { maxTurns: 4, maxTokens: 900 },
    },
    rateLimits: {
      perIp: { windowSec: 60, max: 8 },
      perSession: { windowSec: 60, max: 6 },
      perIpDaily: { windowSec: 86_400, max: 80 },
      perSessionLifetime: { max: 40 },
    },
    ...(simulationFromEnv(env) ? { simulation: simulationFromEnv(env) } : {}),
    now: () => new Date(),
    telemetrySalt: present(env.TELEMETRY_SALT) ?? '',
  }
}

/**
 * Variable names that may hold the Supabase server-side key, in priority order.
 *
 * Supabase renamed the concept: the legacy `service_role` JWT and the newer
 * `sb_secret_…` "secret key" both grant server-side access and bypass RLS, and
 * the dashboard has shown both at different times. Accepting one spelling means a
 * correctly-configured deployment silently behaves as if it had no database.
 */
const SUPABASE_KEY_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE',
] as const

/** Which variable supplied the key, or null. The NAME only -- never the value. */
export function supabaseKeySource(env: EnvLike = process.env): string | null {
  return SUPABASE_KEY_NAMES.find((name) => {
    const value = env[name]
    return value !== undefined && value.trim() !== ''
  }) ?? null
}

/**
 * The ledger store. Supabase when configured, otherwise none.
 *
 * Returning null rather than a memory store is deliberate: an in-process store on
 * serverless would under-count spend by exactly the concurrency factor, so a
 * missing store must fail closed to STATIC, not quietly pretend to be a ceiling.
 */
export function supabaseConfigFromEnv(
  env: EnvLike = process.env,
): { url: string; serviceRoleKey: string } | null {
  const url = env.SUPABASE_URL
  const source = supabaseKeySource(env)
  if (!url || source === null) return null
  const serviceRoleKey = env[source]
  if (!serviceRoleKey) return null
  return { url, serviceRoleKey }
}
