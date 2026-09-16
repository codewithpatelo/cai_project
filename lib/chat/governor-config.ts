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
  return env.OPENROUTER_KEY_PROFILE === 'client' ? 'client' : 'dev'
}

function num(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function governorConfigFromEnv(env: EnvLike = process.env): GovernorConfig {
  const totalBudgetUsd = num(env.GOVERNOR_TOTAL_BUDGET_USD, 5)
  const reserveUsd = num(env.GOVERNOR_RESERVE_USD, 1.2)

  return {
    namespace: keyProfile(env),
    totalBudgetUsd,
    reserveUsd,
    reserveWindow: {
      startIso: env.GOVERNOR_RESERVE_WINDOW_START ?? '2026-09-23T17:00:00Z',
      endIso: env.GOVERNOR_RESERVE_WINDOW_END ?? '2026-09-24T01:00:00Z',
    },
    keyExpiresAtIso: env.GOVERNOR_KEY_EXPIRES_AT ?? '2026-09-24T01:00:00Z',
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
    telemetrySalt: env.TELEMETRY_SALT ?? '',
  }
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
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) return null
  return { url, serviceRoleKey }
}
