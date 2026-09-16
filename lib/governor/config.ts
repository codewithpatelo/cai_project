/**
 * Config-time helpers: sanity-checking a GovernorConfig, and reading the demo-simulation
 * env vars (spec §9). These env var names (`GOVERNOR_SIM_*`) are generic to this module,
 * not to any particular deployment, so reading them here doesn't add domain knowledge.
 */

import type { GovernorConfig, Tier } from './types'

const VALID_TIERS: readonly Tier[] = ['PRIMARY', 'ECONOMY', 'STATIC']

function isTier(value: string): value is Tier {
  return (VALID_TIERS as readonly string[]).includes(value)
}

/**
 * Enabled only when GOVERNOR_SIM_ENABLED=true (spec §9): a stray env var alone must not be
 * able to fake the budget in production, where that flag is unset.
 *
 * Typed as a plain string map rather than `NodeJS.ProcessEnv` so tests can pass a minimal
 * fixture instead of a full process environment.
 */
export function simulationFromEnv(
  env: Record<string, string | undefined> = process.env
): GovernorConfig['simulation'] {
  if (env.GOVERNOR_SIM_ENABLED !== 'true') return undefined

  const simulation: { forceSpentUsd?: number; forceTier?: Tier } = {}

  const spent = env.GOVERNOR_SIM_SPENT_USD
  if (spent !== undefined && spent !== '') {
    const parsed = Number(spent)
    if (Number.isFinite(parsed)) simulation.forceSpentUsd = parsed
  }

  const tier = env.GOVERNOR_SIM_TIER
  if (tier !== undefined && tier !== '' && isTier(tier)) simulation.forceTier = tier

  return simulation.forceSpentUsd === undefined && simulation.forceTier === undefined
    ? undefined
    : simulation
}

/**
 * Construction-time invariant checks. These catch a programmer error in wiring the config
 * (not a runtime spend decision), so they throw rather than returning a typed result —
 * consistent with the rest of the codebase's convention that thrown strings are for
 * "this should never happen in a correct deployment", not for request-time outcomes.
 */
export function assertValidConfig(cfg: GovernorConfig): void {
  if (cfg.reserveUsd < 0 || cfg.reserveUsd > cfg.totalBudgetUsd) {
    throw new Error('governor config: reserveUsd must be between 0 and totalBudgetUsd')
  }
  const t = cfg.thresholds
  if (!(0 < t.economyAtLifetimeFraction && t.economyAtLifetimeFraction < t.staticAtLifetimeFraction && t.staticAtLifetimeFraction <= 1)) {
    throw new Error('governor config: thresholds must satisfy 0 < economy < static <= 1')
  }
  if (new Date(cfg.reserveWindow.startIso).getTime() >= new Date(cfg.reserveWindow.endIso).getTime()) {
    throw new Error('governor config: reserveWindow.startIso must be before endIso')
  }
  if (cfg.namespace.trim() === '') {
    throw new Error('governor config: namespace must not be empty')
  }
}
