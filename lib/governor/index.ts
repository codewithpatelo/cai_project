/**
 * The whole public surface: createGovernor(cfg, store) -> the five functions described in
 * governor-spec.md §1. Everything else in this directory is a private implementation
 * detail reached only through this file (ledger.ts's store classes are the one exception,
 * exported directly so callers can construct a store to hand in).
 */

import { assertValidConfig, simulationFromEnv } from './config'
import type { LedgerStore } from './ledger'
import { computeSnapshot, daysRemaining, isReserveWindow, utcDateKey } from './pacing'
import { checkRateLimits } from './ratelimit'
import { decideTier, historyBudgetFor, modelFor } from './tiers'
import { emitTelemetry } from './telemetry'
import type { BudgetSnapshot, CallUsage, Decision, DecisionReason, GovernorConfig, Tier } from './types'

export type {
  Tier,
  ModelTier,
  HistoryBudget,
  GovernorConfig,
  Decision,
  DecisionReason,
  BudgetSnapshot,
  CallUsage,
  Clock,
} from './types'
export type { LedgerStore, SupabaseLedgerStoreConfig } from './ledger'
export { MemoryLedgerStore, FailingStore, SlowStore, SupabaseLedgerStore } from './ledger'
export { simulationFromEnv, assertValidConfig } from './config'
export { hashSession } from './telemetry'

/**
 * The ledger call budget: a timeout IS unavailability, not something to retry (spec §3).
 *
 * The original 400ms was chosen without measuring anything. Measured against a
 * colocated Supabase project, one cold call costs 330-670ms of DNS, TLS and
 * query, and authorising a single request makes several calls. A budget below
 * that does not protect against a stalled ledger -- it guarantees every cold
 * request fails closed, which looks exactly like a permanently broken store.
 */
const DEFAULT_LEDGER_TIMEOUT_MS = 2000

export interface Governor {
  authorize(ctx: { ip: string; sessionId: string }): Promise<Decision>
  record(usage: CallUsage): Promise<void>
  trimHistory<T extends { role: string; content: string }>(
    history: T[],
    budget: Decision['historyBudget']
  ): { kept: T[]; dropped: number; summarized: boolean }
  snapshot(): Promise<BudgetSnapshot>
  estimateCostUsd(tier: Tier, inputTokens: number, outputTokens: number, cachedInputTokens?: number): number
}

function lifetimeKey(cfg: GovernorConfig): string {
  return `${cfg.namespace}:spend:lifetime`
}
function todayKey(cfg: GovernorConfig, now: Date): string {
  return `${cfg.namespace}:spend:day:${utcDateKey(now)}`
}

/** A timeout IS unavailability: race the real call against a timer and never await past it. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ledger_timeout')), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      })
  })
}

/** The one decision with no escape hatch: ledger unreachable or slow -> STATIC, no model call. */
function failClosedDecision(now: Date, cfg: GovernorConfig): Decision {
  const snapshot: BudgetSnapshot = {
    spentUsdLifetime: 0,
    spentUsdToday: 0,
    dailyAllowanceUsd: 0,
    reserveRemainingUsd: 0,
    daysRemaining: daysRemaining(now, cfg.keyExpiresAtIso),
    isReserveWindow: isReserveWindow(now, cfg.reserveWindow),
    simulated: false,
  }
  return {
    allowed: false,
    tier: 'STATIC',
    model: null,
    reason: 'ledger_unavailable',
    maxOutputTokens: 0,
    historyBudget: { maxTurns: 0, maxTokens: 0 },
    budgetSnapshot: snapshot,
  }
}

function buildDecision(tier: Tier, reason: DecisionReason, snapshot: BudgetSnapshot, cfg: GovernorConfig, retryAfterSec?: number): Decision {
  return {
    allowed: tier !== 'STATIC',
    tier,
    model: modelFor(tier, cfg),
    reason,
    maxOutputTokens: tier === 'STATIC' ? 0 : cfg.context.maxOutputTokens,
    historyBudget: historyBudgetFor(tier, cfg),
    budgetSnapshot: snapshot,
    ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
  }
}

function rateLimitedDecision(
  reason: Extract<DecisionReason, 'rate_limited_ip' | 'rate_limited_session'>,
  retryAfterSec: number | undefined,
  now: Date,
  cfg: GovernorConfig
): Decision {
  const snapshot: BudgetSnapshot = {
    spentUsdLifetime: 0,
    spentUsdToday: 0,
    dailyAllowanceUsd: 0,
    reserveRemainingUsd: 0,
    daysRemaining: daysRemaining(now, cfg.keyExpiresAtIso),
    isReserveWindow: isReserveWindow(now, cfg.reserveWindow),
    simulated: false,
  }
  return buildDecision('STATIC', reason, snapshot, cfg, retryAfterSec)
}

function estimateCostUsdImpl(tier: Tier, cfg: GovernorConfig, inputTokens: number, outputTokens: number, cachedInputTokens: number): number {
  const modelTier = tier === 'ECONOMY' ? cfg.tiers.ECONOMY : cfg.tiers.PRIMARY
  const nonCachedInput = Math.max(0, inputTokens - cachedInputTokens)
  const cachedRate = modelTier.cachedInputPerMTok ?? modelTier.inputPerMTok
  const raw =
    (nonCachedInput * modelTier.inputPerMTok) / 1e6 +
    (cachedInputTokens * cachedRate) / 1e6 +
    (outputTokens * modelTier.outputPerMTok) / 1e6
  // Estimates are deliberately pessimistic (spec §2): an under-estimate silently spends
  // money we think we still have.
  return raw * 1.25
}

const TOKEN_CHARS_ESTIMATE = 4 // no tokenizer dependency; a rough, deterministic proxy is enough for a trim budget

function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHARS_ESTIMATE)
}

function summarizeDroppedTurns<T extends { role: string; content: string }>(droppedPairs: T[][]): string {
  const firstDroppedUserMessage = droppedPairs[0]?.[0]
  const snippet = (firstDroppedUserMessage?.content ?? '').slice(0, 120).trim()
  const truncated = (firstDroppedUserMessage?.content.length ?? 0) > 120
  return `[earlier conversation summary] ${snippet}${truncated ? '…' : ''}`
}

export function createGovernor(cfg: GovernorConfig, store: LedgerStore): Governor {
  assertValidConfig(cfg)
  const simulation = cfg.simulation ?? simulationFromEnv()
  const ledgerTimeoutMs = cfg.ledgerTimeoutMs ?? DEFAULT_LEDGER_TIMEOUT_MS

  async function authorize(ctx: { ip: string; sessionId: string }): Promise<Decision> {
    const now = cfg.now()

    if (simulation) {
      // Simulated state is read-only and never touches the real store (spec §9) — the demo
      // must work even if the store is unreachable, which is the whole point of it.
      const forcedSpend = simulation.forceSpentUsd ?? 0
      const snapshot = computeSnapshot({ cfg, now, spentLifetime: forcedSpend, spentToday: forcedSpend, simulated: true })
      const decided = simulation.forceTier
        ? { tier: simulation.forceTier, reason: 'simulated' as const }
        : { ...decideTier(snapshot, cfg), reason: 'simulated' as const }
      return buildDecision(decided.tier, decided.reason, snapshot, cfg)
    }

    try {
      const rl = await withTimeout(checkRateLimits(store, cfg, ctx), ledgerTimeoutMs)
      if (rl.blocked && rl.reason) {
        return rateLimitedDecision(rl.reason, rl.retryAfterSec, now, cfg)
      }

      const totals = await withTimeout(store.getMany([lifetimeKey(cfg), todayKey(cfg, now)]), ledgerTimeoutMs)
      const snapshot = computeSnapshot({
        cfg,
        now,
        spentLifetime: totals[lifetimeKey(cfg)] ?? 0,
        spentToday: totals[todayKey(cfg, now)] ?? 0,
        simulated: false,
      })
      const { tier, reason } = decideTier(snapshot, cfg)
      return buildDecision(tier, reason, snapshot, cfg)
    } catch {
      // No escape hatch: a throw or a >400ms stall both land here, never a model call.
      return failClosedDecision(now, cfg)
    }
  }

  async function record(usage: CallUsage): Promise<void> {
    const now = cfg.now()

    if (simulation) {
      emitTelemetry(
        usage,
        { now, salt: cfg.telemetrySalt, spentUsdLifetime: simulation.forceSpentUsd ?? 0, simulated: true }
      )
      return
    }

    const newLifetime = await store.incrBy(lifetimeKey(cfg), usage.costUsd)
    await store.incrBy(todayKey(cfg, now), usage.costUsd)
    emitTelemetry(usage, { now, salt: cfg.telemetrySalt, spentUsdLifetime: newLifetime, simulated: false })
  }

  function trimHistory<T extends { role: string; content: string }>(
    history: T[],
    budget: Decision['historyBudget']
  ): { kept: T[]; dropped: number; summarized: boolean } {
    const pairs: T[][] = []
    for (let i = 0; i < history.length; i += 2) {
      pairs.push(history.slice(i, Math.min(i + 2, history.length)))
    }

    let keptPairs = pairs.slice(Math.max(0, pairs.length - budget.maxTurns))

    const tokensOf = (pair: T[]) => pair.reduce((sum, message) => sum + estimateTokens(message.content), 0)
    while (
      keptPairs.length > 0 &&
      keptPairs.reduce((sum, pair) => sum + tokensOf(pair), 0) > budget.maxTokens
    ) {
      keptPairs = keptPairs.slice(1)
    }

    const dropped = pairs.length - keptPairs.length
    const firstPair = pairs[0]
    const firstPairSurvived = keptPairs.length > 0 && keptPairs[0] === firstPair

    let kept = keptPairs.flat()
    let summarized = false

    if (dropped > 0 && firstPair !== undefined && !firstPairSurvived) {
      const firstMessageOfFirstPair = firstPair[0]
      if (firstMessageOfFirstPair !== undefined) {
        const droppedPairs = pairs.slice(0, pairs.length - keptPairs.length)
        // The dropped span removed the first user turn, which usually carries the actual
        // intent (spec §6): replace it with a one-line, locally-generated summary rather
        // than just deleting it. No LLM call — spending money to save money isn't a saving.
        const summaryMessage: T = { ...firstMessageOfFirstPair, content: summarizeDroppedTurns(droppedPairs) }
        kept = [summaryMessage, ...kept]
        summarized = true
      }
    }

    return { kept, dropped, summarized }
  }

  async function snapshot(): Promise<BudgetSnapshot> {
    const now = cfg.now()
    if (simulation) {
      const forcedSpend = simulation.forceSpentUsd ?? 0
      return computeSnapshot({ cfg, now, spentLifetime: forcedSpend, spentToday: forcedSpend, simulated: true })
    }
    try {
      const totals = await withTimeout(store.getMany([lifetimeKey(cfg), todayKey(cfg, now)]), ledgerTimeoutMs)
      return computeSnapshot({
        cfg,
        now,
        spentLifetime: totals[lifetimeKey(cfg)] ?? 0,
        spentToday: totals[todayKey(cfg, now)] ?? 0,
        simulated: false,
      })
    } catch {
      // Same fail-closed posture as authorize(): a snapshot the caller can't get is a zero
      // snapshot, never a thrown error the caller has to remember to catch.
      return {
        spentUsdLifetime: 0,
        spentUsdToday: 0,
        dailyAllowanceUsd: 0,
        reserveRemainingUsd: 0,
        daysRemaining: daysRemaining(now, cfg.keyExpiresAtIso),
        isReserveWindow: isReserveWindow(now, cfg.reserveWindow),
        simulated: false,
      }
    }
  }

  function estimateCostUsd(tier: Tier, inputTokens: number, outputTokens: number, cachedInputTokens = 0): number {
    return estimateCostUsdImpl(tier, cfg, inputTokens, outputTokens, cachedInputTokens)
  }

  return { authorize, record, trimHistory, snapshot, estimateCostUsd }
}
