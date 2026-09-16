/**
 * The degradation ladder (spec §5). A pure function from a BudgetSnapshot to a tier and a
 * reason — no persisted "current tier" anywhere. See pacing.ts's header for why that's
 * enough to satisfy "monotonic within a day" without extra state: the inputs themselves
 * only move in the degrading direction until UTC midnight recomputes them.
 */

import type { DecisionReason, GovernorConfig, Tier, BudgetSnapshot } from './types'

export function decideTier(
  snapshot: BudgetSnapshot,
  cfg: GovernorConfig
): { tier: Tier; reason: DecisionReason } {
  const lifetimeFraction = snapshot.spentUsdLifetime / cfg.totalBudgetUsd

  // The static boundary is checked first: it is the most severe condition, and inside the
  // reserve window it can flip straight back to PRIMARY, which must win over every other
  // check below it.
  if (lifetimeFraction >= cfg.thresholds.staticAtLifetimeFraction) {
    if (snapshot.isReserveWindow && snapshot.reserveRemainingUsd > 0) {
      return { tier: 'PRIMARY', reason: 'ok' }
    }
    if (snapshot.isReserveWindow) {
      // In the window, but the reserve itself is spent: truly no money left.
      return { tier: 'STATIC', reason: 'exhausted' }
    }
    return { tier: 'STATIC', reason: 'reserve_locked' }
  }

  // Daily allowance fully spent collapses straight to STATIC regardless of which tier the
  // request started in — a paced-down ECONOMY day can still run out before midnight.
  if (snapshot.dailyAllowanceUsd <= 0 || snapshot.spentUsdToday >= snapshot.dailyAllowanceUsd) {
    return { tier: 'STATIC', reason: 'exhausted' }
  }

  if (lifetimeFraction >= cfg.thresholds.economyAtLifetimeFraction) {
    return { tier: 'ECONOMY', reason: 'lifetime_threshold' }
  }

  if (snapshot.spentUsdToday >= cfg.thresholds.economyAtDailyFraction * snapshot.dailyAllowanceUsd) {
    return { tier: 'ECONOMY', reason: 'paced_down' }
  }

  return { tier: 'PRIMARY', reason: 'ok' }
}

export function modelFor(tier: Tier, cfg: GovernorConfig): string | null {
  if (tier === 'PRIMARY') return cfg.tiers.PRIMARY.id
  if (tier === 'ECONOMY') return cfg.tiers.ECONOMY.id
  return null
}

export function historyBudgetFor(tier: Tier, cfg: GovernorConfig): { maxTurns: number; maxTokens: number } {
  if (tier === 'PRIMARY') return cfg.context.primaryHistory
  if (tier === 'ECONOMY') return cfg.context.economyHistory
  return { maxTurns: 0, maxTokens: 0 } // STATIC: n/a, no model call is made
}
