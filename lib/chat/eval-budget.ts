/**
 * Routes evaluation traffic to its own ledger.
 *
 * `docs/eval-set.md` always specified that the eval reads a separate
 * `EVAL_BUDGET_USD` key rather than the production one. That held while the eval
 * called the provider directly. When `--target` was added it began driving the
 * deployment's own /api/chat -- which is strictly more faithful, and charged every
 * case to the visitor budget. Two runs in one afternoon consumed a whole day's
 * allowance and degraded the live bot to STATIC for real visitors, which is the
 * governor working correctly against traffic that was never a visitor's.
 *
 * So the eval identifies itself and is charged to the `eval` namespace, with its
 * own smaller budget. The isolation is the same mechanism ADR-014 uses to keep dev
 * spend off the client's curve: a different key prefix in the database, not a flag
 * anyone has to remember.
 */

import type { GovernorConfig } from '../governor/types'
import { present, type EnvLike } from '../llm/models'

export const EVAL_NAMESPACE = 'eval'

/**
 * Whether this request may spend the eval budget instead of the visitor's.
 *
 * Requires a shared secret. Without one an ordinary visitor could send the header
 * and escape the pacing that protects the demo -- the budget would still be
 * bounded, but by the wrong ceiling. An unset EVAL_TOKEN disables the route
 * entirely rather than falling back to something permissive: the eval losing its
 * separate ledger is an accounting problem, a visitor gaining one is a hole.
 */
export function isEvalRequest(header: string | null, env: EnvLike = process.env): boolean {
  const expected = present(env.EVAL_TOKEN)
  if (expected === undefined) return false
  if (header === null) return false
  return timingSafeEqual(header, expected)
}

/** Length-independent comparison. Not security-critical here, but free. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * The visitor's config, re-pointed at the eval ledger and its own budget.
 *
 * Everything else -- tiers, pricing, reserve window, thresholds -- is deliberately
 * left identical. An eval that ran under different pacing rules would not be
 * evaluating the deployed system.
 */
export function asEvalBudget(cfg: GovernorConfig, env: EnvLike = process.env): GovernorConfig {
  const budget = Number(present(env.EVAL_BUDGET_USD))
  const totalBudgetUsd = Number.isFinite(budget) && budget > 0 ? budget : 0.4
  return {
    ...cfg,
    namespace: EVAL_NAMESPACE,
    totalBudgetUsd,
    // The reserve exists to keep the live review answerable. An eval run has no
    // review to protect, and a reserve larger than the budget is rejected by
    // validateConfig, so the eval simply runs without one.
    reserveUsd: 0,
  }
}
