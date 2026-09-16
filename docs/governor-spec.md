# `@budget-governor` — specification

A **domain-agnostic** budget, pacing and degradation module for LLM-backed agents.

> **Design constraint, enforced by review:** nothing in `lib/governor/` may mention Cadre,
> chatbots, support, or any knowledge base. It knows about money, tokens, time and model
> names. If a Cadre string appears in this directory, the PR is wrong. The module should be
> liftable into another project by copying the folder and writing a new config object.

## 0. Why this exists

The key holds **$5, expires in 7 days, and the bot is publicly reachable the whole time,
including during the live review.** Running out of money before the review is the single
worst outcome available — worse than a mediocre answer, worse than a missing feature. A
naive "stop at $5" check fails that test: it would let day 1 eat everything. So the module
does four separable jobs, and they compose:

1. **Account** for what was spent (real numbers when available, estimates when not).
2. **Pace** what is left across the days remaining, with a reserve nothing can touch.
3. **Degrade** in graded steps instead of failing.
4. **Refuse** to call the model when it cannot do (1).

## 1. Public interface

```ts
// lib/governor/types.ts

export type Tier = 'PRIMARY' | 'ECONOMY' | 'STATIC';

export interface ModelTier {
  id: string;                    // provider model id, e.g. 'google/gemini-2.5-flash'
  inputPerMTok: number;          // USD
  outputPerMTok: number;         // USD
  cachedInputPerMTok?: number;   // USD, if the provider prices cache reads
}

export interface GovernorConfig {
  totalBudgetUsd: number;        // hard lifetime ceiling
  reserveUsd: number;            // carved out, spendable only inside reserveWindow
  reserveWindow: { startIso: string; endIso: string };
  keyExpiresAtIso: string;       // pacing horizon
  tiers: { PRIMARY: ModelTier; ECONOMY: ModelTier };
  thresholds: {
    economyAtLifetimeFraction: number;   // e.g. 0.60
    staticAtLifetimeFraction: number;    // e.g. 0.76  (= (total-reserve)/total)
    economyAtDailyFraction: number;      // e.g. 0.80
  };
  context: {
    maxHistoryTurns: number;
    maxHistoryTokens: number;
    maxOutputTokens: number;
  };
  rateLimits: {
    perIp:      { windowSec: number; max: number };
    perSession: { windowSec: number; max: number };
    perIpDaily: { windowSec: number; max: number };
  };
  simulation?: { forceSpentUsd?: number; forceTier?: Tier };
}

export interface Decision {
  allowed: boolean;
  tier: Tier;
  model: string | null;          // null when tier === 'STATIC'
  reason: DecisionReason;
  maxOutputTokens: number;
  historyBudget: { maxTurns: number; maxTokens: number };
  budgetSnapshot: BudgetSnapshot;
  retryAfterSec?: number;        // set when reason is a rate limit
}

export type DecisionReason =
  | 'ok'
  | 'paced_down'             // daily allowance mostly consumed
  | 'lifetime_threshold'     // cumulative spend crossed a tier boundary
  | 'reserve_locked'         // only the reserve is left, and it is not the reserve window
  | 'exhausted'              // no money at all
  | 'ledger_unavailable'     // FAIL CLOSED
  | 'rate_limited_ip'
  | 'rate_limited_session'
  | 'simulated';

export interface BudgetSnapshot {
  spentUsdLifetime: number;
  spentUsdToday: number;
  dailyAllowanceUsd: number;
  reserveRemainingUsd: number;
  daysRemaining: number;
  isReserveWindow: boolean;
  simulated: boolean;
}

export interface CallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens?: number;
  costUsd: number;
  costSource: 'provider' | 'estimated';
  latencyMs: number;
  tier: Tier;
  error?: string;
}
```

```ts
// lib/governor/index.ts — the whole public surface, five functions
export function createGovernor(cfg: GovernorConfig, store: LedgerStore): Governor;

interface Governor {
  authorize(ctx: { ip: string; sessionId: string }): Promise<Decision>;
  record(usage: CallUsage): Promise<void>;
  trimHistory<T extends { role: string; content: string }>(
    history: T[], budget: Decision['historyBudget']
  ): { kept: T[]; dropped: number; summarized: boolean };
  snapshot(): Promise<BudgetSnapshot>;
  estimateCostUsd(tier: Tier, inputTokens: number, outputTokens: number, cachedInputTokens?: number): number;
}
```

`LedgerStore` is a three-method port (`incrBy`, `getMany`, `expiringIncr`) so the module is
storage-agnostic. Ship a Redis adapter and an in-memory adapter for tests.

## 2. Cost accounting

**Preferred — provider-reported.** OpenRouter returns usage accounting on every chat
completion without an extra call: prompt tokens, completion tokens, reasoning tokens where
relevant, **cached token counts**, and **total cost in credits**. The legacy
`usage: { include: true }` / `stream_options.include_usage` parameters are deprecated and
have no effect — full usage is always included. On streaming responses the usage block
arrives in the **final chunk**, so the client must read to completion before recording.

Exact post-hoc figures are also available from the generation endpoint
(`GET /api/v1/generation?id=…` → `total_cost`, `tokens_prompt`, `tokens_completion`,
`native_tokens_*`). We do **not** call it on the hot path — it is a second network hop for
a number we already have. It is used by `/eval` for reconciliation only.

Remaining credit can be read from `GET /api/v1/key` (usage, limit, daily/weekly/monthly
spend). The governor polls this **at most once per minute**, cached, as a cross-check
against its own ledger. If the two disagree by more than 10%, the **larger** figure wins
and a `ledger_drift` telemetry event fires.

**Fallback — estimated.** If the usage block is missing or malformed:

```
cost = (inputTokens - cachedInputTokens) * tier.inputPerMTok / 1e6
     + cachedInputTokens * (tier.cachedInputPerMTok ?? tier.inputPerMTok) / 1e6
     + outputTokens * tier.outputPerMTok / 1e6
```

recorded with `costSource: 'estimated'` and **multiplied by 1.25**. Estimates are
deliberately pessimistic: an under-estimate silently spends money we think we still have.

Sources: https://openrouter.ai/docs/cookbook/administration/usage-accounting ·
https://openrouter.ai/docs/api_reference/limits (both 2026-09-16)

## 3. Fail closed

> **If the governor cannot read the ledger, and cannot compute an estimate, no model call
> happens.** `authorize()` returns `{ allowed: false, tier: 'STATIC', reason:
> 'ledger_unavailable' }`.

This is the one rule with no escape hatch, no timeout-and-proceed, no "probably fine".
The failure mode it prevents — Redis down, every request looks free, $5 gone in minutes —
is unrecoverable, because the key cannot be topped up. Degrading to canned FAQ answers
during a Redis outage is a bad afternoon. Being broke on review day is a failed take-home.

Concretely: Redis timeout is **400 ms**; a timeout *is* unavailability, not a retry. There
is no in-process counter fallback, because serverless instances don't share one and a
per-instance counter would under-count by exactly the concurrency factor.

## 4. Pacing

```
daysRemaining     = max(1, ceil((keyExpiresAt - now) / 1 day))
operatingBudget   = totalBudget - reserve
spendableToday    = (operatingBudget - spentLifetime_excl_reserve) / daysRemaining
```

Recomputed per request, so an unused day rolls forward automatically and a heavy day
tightens tomorrow without any cron job.

**The reserve is inviolable.** `reserveUsd` is subtracted from every operating calculation
and only becomes spendable when `now` falls inside `reserveWindow` — the live-review slot,
set explicitly in config. Outside that window, hitting the reserve boundary returns
`reason: 'reserve_locked'` and tier `STATIC`. The bot stays *up* and useful; it just stops
paying for tokens.

## 5. Degradation ladder

| Tier | Entered when | Model | KB | History | User sees |
|---|---|---|---|---|---|
| `PRIMARY` | default | Flash | full | 6 turns / 1,500 tok | normal streamed answer |
| `ECONOMY` | `spentLifetime ≥ 60% × total` **OR** `spentToday ≥ 80% × dailyAllowance` | Flash Lite | full | 4 turns / 900 tok | normal streamed answer, slightly terser |
| `STATIC` | `spentLifetime ≥ 76% × total` (outside reserve window) **OR** daily allowance exhausted **OR** `ledger_unavailable` **OR** rate limited **OR** upstream error after 1 retry | none | n/a | n/a | keyword-matched FAQ answer + handoff form |

`76%` is not arbitrary: it is `(5.00 − 1.20) / 5.00`, the point at which only the locked
reserve remains.

**The bot never surfaces a raw error.** Every path — provider 429, provider 5xx, timeout,
budget exhaustion, ledger failure — lands in `STATIC`, which always has an answer:
a keyword-matched FAQ entry drawn from the same KB at build time, plus the handoff form.
`STATIC` costs $0 and cannot fail, which is what makes it a valid floor.

Transitions are **monotonic within a day** (no flapping back up mid-day once a threshold is
crossed) and re-evaluated at UTC midnight.

### State table

| From | Event | To |
|---|---|---|
| PRIMARY | lifetime ≥ 60% or today ≥ 80% | ECONOMY |
| PRIMARY | ledger unavailable / rate limit / 2× upstream fail | STATIC |
| ECONOMY | lifetime ≥ 76% outside reserve window | STATIC |
| ECONOMY | daily allowance exhausted | STATIC |
| ECONOMY | ledger unavailable / rate limit | STATIC |
| STATIC | new UTC day **and** lifetime < 60% | PRIMARY |
| STATIC | new UTC day **and** 60% ≤ lifetime < 76% | ECONOMY |
| STATIC | enters reserve window **and** reserve > 0 | PRIMARY |
| any | `simulation.forceTier` set | that tier |

## 6. Context budget

Per-conversation caps, enforced in `trimHistory()` before prompt assembly:

- Hard cap **6 turns** (PRIMARY) / **4 turns** (ECONOMY) of user+assistant pairs.
- Hard cap **1,500 / 900 tokens** of history, whichever binds first.
- Overflow strategy: **drop oldest pairs first**. If dropping would remove the first user
  turn (which usually carries the actual intent), replace the dropped span with a
  one-line, locally-generated extractive summary — **no LLM call**, because spending money
  to save money is not a saving. `summarized: true` is reported in telemetry.
- The fixed prefix (instructions + KB) is **never** trimmed. Trimming it would silently
  delete the "Not published" blocks and turn a cost saving into a hallucination.

## 7. Rate limits

| Scope | Window | Max | On breach |
|---|---|---|---|
| per IP | 60 s | 8 requests | `STATIC` + `retryAfterSec` |
| per IP | 24 h | 120 requests | `STATIC` for the rest of the window |
| per session | 60 s | 6 requests | `STATIC` + `retryAfterSec` |
| per session | lifetime | 40 messages | `STATIC` + "start a new conversation" |

Fixed-window counters via `expiringIncr` (`INCR` + `EXPIRE NX`) — one round trip, no Lua,
good enough at this scale. Sliding windows are `LATER`. The 24h per-IP cap is the one that
actually bounds a determined abuser's spend: 120 × $0.0028 ≈ **$0.34/day/IP** worst case.

Breaching a rate limit returns a **429-shaped but friendly** response: the user gets a
static answer and a "give it a few seconds" note, never a stack trace.

## 8. Telemetry

One row per call, appended to a capped Redis list (last 1,000) and `console.log`-ed as
single-line JSON for Vercel log drains:

```jsonc
{
  "ts": "2026-09-16T12:00:00.000Z",
  "model": "google/gemini-2.5-flash",
  "tier": "PRIMARY",
  "inputTokens": 7150, "outputTokens": 243, "cachedInputTokens": 5800,
  "reasoningTokens": 0,
  "costUsd": 0.00278, "costSource": "provider",
  "latencyMs": 1340,
  "error": null,
  "sessionHash": "a3f1…",         // HMAC(sessionId), truncated — not reversible
  "spentUsdLifetime": 0.412
}
```

**Never logged:** user message text, assistant response text, IP addresses, emails, names,
company names, form contents. The rule is structural, not a habit — the logging function
takes a `CallUsage`, and `CallUsage` has no field that can hold message content. You cannot
log a transcript through this interface without changing the type, and changing the type
shows up in review.

`sessionHash` is `HMAC-SHA256(sessionId, TELEMETRY_SALT)` truncated to 8 hex chars: enough
to group a conversation's calls, useless for identifying a person.

## 9. Demo simulation mode

Set `GOVERNOR_SIM_SPENT_USD=4.10` (or `GOVERNOR_SIM_TIER=ECONOMY`) and the governor
computes every decision as if that much had been spent — **without touching the real
ledger and without spending a cent.**

- Simulated state is **read-only**: `record()` writes nothing while simulation is active.
- Every `Decision` and telemetry row carries `simulated: true`, and the UI shows a small
  "simulated budget" badge, so a simulated demo can never be mistaken for a real one.
- Enabled only when `GOVERNOR_SIM_ENABLED=true`. In production that variable is unset, so
  a stray env var alone cannot silently fake the budget.

This exists so the **live review can demonstrate the full degradation ladder in 90 seconds**
— PRIMARY → ECONOMY → STATIC → reserve-window recovery — on the real deployed URL, with
real code paths, for $0. Demoing the most important safety property by actually exhausting
the key would be a strange thing to do on the morning of the review.

## 10. Testing

The governor is pure logic over an injected clock and an injected store, which is the whole
reason to build it this way:

- `FakeClock` — drive the 7-day pacing curve, the UTC-midnight reset, and the reserve
  window without waiting.
- `MemoryLedgerStore` — deterministic, plus a `FailingStore` for the fail-closed path.
- `MockLlm` — returns canned usage blocks, including malformed ones, to exercise the
  estimate fallback.

**Zero network, zero spend, and these tests are non-negotiable before any deploy** (see
CLAUDE.md hard rules). Required coverage: every row of the §5 state table, the fail-closed
path, the estimate fallback, the ×1.25 pessimism, history trimming at both caps, the
summarize-instead-of-drop-first-turn path, all four rate limits, and simulation read-only-ness.

## 11. Explicitly LATER

Sliding-window rate limits · per-user quotas · adaptive model routing by question
difficulty · cost attribution per KB topic · a real dashboard · anomaly alerting.
Each is a real improvement; none is worth a minute of the five hours.
