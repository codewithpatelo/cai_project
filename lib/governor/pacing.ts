/**
 * Pure pacing math (spec §4). Recomputed fresh on every request from cumulative counters,
 * never from a stored "current tier" — that's what makes an unused day roll forward and a
 * heavy day tighten tomorrow without a cron job, and it's also what makes the degradation
 * ladder monotonic within a day for free: spend only grows, so a threshold once crossed
 * stays crossed until the UTC-midnight recompute.
 */

import type { BudgetSnapshot, GovernorConfig } from './types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function daysRemaining(now: Date, keyExpiresAtIso: string): number {
  const diffMs = new Date(keyExpiresAtIso).getTime() - now.getTime()
  return Math.max(1, Math.ceil(diffMs / MS_PER_DAY))
}

export function isReserveWindow(now: Date, window: { startIso: string; endIso: string }): boolean {
  const t = now.getTime()
  return t >= new Date(window.startIso).getTime() && t < new Date(window.endIso).getTime()
}

/** UTC calendar date, YYYY-MM-DD. `toISOString` is always UTC, so this needs no timezone math. */
export function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function computeSnapshot(params: {
  cfg: GovernorConfig
  now: Date
  spentLifetime: number
  spentToday: number
  simulated: boolean
}): BudgetSnapshot {
  const { cfg, now, spentLifetime, spentToday, simulated } = params
  const operatingBudget = cfg.totalBudgetUsd - cfg.reserveUsd
  const days = daysRemaining(now, cfg.keyExpiresAtIso)

  // Spend can only tap the reserve inside the reserve window (spec §4); everything up to
  // operatingBudget is charged against pacing, anything beyond it is reserve draw-down.
  const spentAgainstOperating = Math.min(spentLifetime, operatingBudget)
  const spentAgainstReserve = Math.max(0, spentLifetime - operatingBudget)

  const dailyAllowanceUsd = Math.max(0, (operatingBudget - spentAgainstOperating) / days)
  const reserveRemainingUsd = Math.max(0, cfg.reserveUsd - spentAgainstReserve)

  return {
    spentUsdLifetime: spentLifetime,
    spentUsdToday: spentToday,
    dailyAllowanceUsd,
    reserveRemainingUsd,
    daysRemaining: days,
    isReserveWindow: isReserveWindow(now, cfg.reserveWindow),
    simulated,
  }
}
