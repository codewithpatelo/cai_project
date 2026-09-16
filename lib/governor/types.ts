/**
 * Public types for the budget governor. Domain-agnostic by construction: nothing here
 * knows what the caller's product is, only money, tokens, time and model ids.
 *
 * Deviations from the literal type block in governor-spec.md §1, each forced by a gap
 * between that block and the rest of the spec (see the handback report for the reasoning):
 *  - `GovernorConfig.now` / `telemetrySalt` — the spec requires an injected clock and an
 *    HMAC salt (§8, §10) but the given `GovernorConfig` has no field for either.
 *  - `GovernorConfig.context` is split into `primaryHistory` / `economyHistory` instead of
 *    one flat `maxHistoryTurns`/`maxHistoryTokens` — §5's ladder needs different caps per
 *    tier, and a single flat pair can't express both.
 *  - `GovernorConfig.rateLimits.perSessionLifetime` — §7's table has four limits; the given
 *    type only names three.
 *  - `CallUsage.sessionId` (optional) — §8's telemetry row includes `sessionHash`, which
 *    requires *something* session-identifying to hash; the given `CallUsage` has nothing.
 *    It is hashed immediately in telemetry.ts and never logged raw.
 */

export type Tier = 'PRIMARY' | 'ECONOMY' | 'STATIC'

/** Injected clock. Production passes `() => new Date()`; tests pass a FakeClock. */
export type Clock = () => Date

export interface ModelTier {
  id: string // pinned provider model id, e.g. 'google/gemini-3.8-flash'
  inputPerMTok: number // USD
  outputPerMTok: number // USD
  cachedInputPerMTok?: number // USD, if the provider prices cache reads
}

export interface HistoryBudget {
  maxTurns: number
  maxTokens: number
}

export interface GovernorConfig {
  namespace: string // prefixes every ledger key; isolates budgets
  totalBudgetUsd: number // hard lifetime ceiling
  reserveUsd: number // carved out, spendable only inside reserveWindow
  reserveWindow: { startIso: string; endIso: string }
  keyExpiresAtIso: string // pacing horizon
  tiers: { PRIMARY: ModelTier; ECONOMY: ModelTier }
  thresholds: {
    economyAtLifetimeFraction: number // e.g. 0.60
    staticAtLifetimeFraction: number // e.g. 0.76  (= (total-reserve)/total)
    economyAtDailyFraction: number // e.g. 0.80
  }
  context: {
    maxOutputTokens: number
    primaryHistory: HistoryBudget // 6 turns / 1,500 tok in the reference config
    economyHistory: HistoryBudget // 4 turns / 900 tok in the reference config
  }
  rateLimits: {
    perIp: { windowSec: number; max: number }
    perSession: { windowSec: number; max: number }
    perIpDaily: { windowSec: number; max: number }
    perSessionLifetime: { max: number } // no window: a true lifetime cap on one conversation
  }
  simulation?: { forceSpentUsd?: number; forceTier?: Tier }
  /** Injected clock. No file in this module calls `Date.now()` or `new Date()` directly. */
  now: Clock
  /** HMAC key for telemetry's session hash. Never itself logged. */
  telemetrySalt: string
}

export interface Decision {
  allowed: boolean
  tier: Tier
  model: string | null // null when tier === 'STATIC'
  reason: DecisionReason
  maxOutputTokens: number
  historyBudget: { maxTurns: number; maxTokens: number }
  budgetSnapshot: BudgetSnapshot
  retryAfterSec?: number // set when reason is a rate limit
}

export type DecisionReason =
  | 'ok'
  | 'paced_down' // daily allowance mostly consumed
  | 'lifetime_threshold' // cumulative spend crossed a tier boundary
  | 'reserve_locked' // only the reserve is left, and it is not the reserve window
  | 'exhausted' // no money at all
  | 'ledger_unavailable' // FAIL CLOSED
  | 'rate_limited_ip'
  | 'rate_limited_session'
  | 'simulated'

export interface BudgetSnapshot {
  spentUsdLifetime: number
  spentUsdToday: number
  dailyAllowanceUsd: number
  reserveRemainingUsd: number
  daysRemaining: number
  isReserveWindow: boolean
  simulated: boolean
}

export interface CallUsage {
  model: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningTokens?: number
  costUsd: number
  costSource: 'provider' | 'estimated'
  latencyMs: number
  tier: Tier
  error?: string
  /** Session identifier, hashed (never logged raw) for telemetry grouping only. */
  sessionId?: string
}
