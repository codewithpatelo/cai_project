/**
 * Pinned model ids and their prices.
 *
 * Never a `~latest` alias (ADR-013): an alias can change model, price and
 * behaviour mid-window, which would silently invalidate every number in
 * docs/model-selection.md while the code still looked correct.
 *
 * Prices are USD per million tokens, OpenRouter list price captured 2026-09-16
 * (docs/model-selection.md §1). They live here rather than in env vars because a
 * price is a fact about the world we verified, not a deployment setting -- but the
 * model *ids* are env-overridable so a deployment can be re-pointed without a code
 * change, which is what MODEL_PRIMARY / MODEL_ECONOMY in .env.example are for.
 */

import type { ModelTier } from '../governor/types'

/**
 * Just the shape these functions read. Narrower than NodeJS.ProcessEnv on
 * purpose: it lets a test pass two variables instead of a whole process
 * environment, and it says exactly what is consumed.
 */
export type EnvLike = Record<string, string | undefined>

const PRIMARY_ID = 'google/gemini-3.8-flash'
const ECONOMY_ID = 'google/gemini-3.1-flash-lite'

/**
 * Prices keyed by the model they were captured for, so an override cannot
 * silently inherit the wrong ones.
 *
 * Only the OpenRouter models below have prices captured from a page we read
 * (docs/model-selection.md §1, 2026-09-16). DeepSeek's rates are deliberately
 * NOT hardcoded: this build could not reach any pricing page to verify them, and
 * inventing a plausible number is the same failure the knowledge base exists to
 * prevent -- except here a wrong number silently under-counts real money.
 * Set MODEL_PRIMARY_INPUT_PER_MTOK / MODEL_PRIMARY_OUTPUT_PER_MTOK (and the
 * ECONOMY pair) from the provider's live pricing page. Unset, the pessimistic
 * fallback below applies.
 */
const PRICES: Record<string, Omit<ModelTier, 'id'>> = {
  [PRIMARY_ID]: { inputPerMTok: 0.75, outputPerMTok: 3.75, cachedInputPerMTok: 0.075 },
  [ECONOMY_ID]: { inputPerMTok: 0.25, outputPerMTok: 1.5 },
}

/**
 * A rate from the environment, or null.
 *
 * `Number('')` is 0, and a platform that writes an unset variable as an empty
 * string would therefore price tokens at zero -- silently under-counting real
 * money, which is the one direction this project cannot afford to be wrong in.
 * So an empty or blank value is absent, not free.
 */
function rate(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** An explicit per-tier price override, for a provider whose rates we have not captured. */
function priceOverride(env: EnvLike, tier: 'PRIMARY' | 'ECONOMY'): Omit<ModelTier, 'id'> | null {
  const input = rate(env[`MODEL_${tier}_INPUT_PER_MTOK`])
  const output = rate(env[`MODEL_${tier}_OUTPUT_PER_MTOK`])
  // Both or neither: an input rate with no output rate would price every
  // completion at zero, which is worse than having no override at all.
  if (input === null || output === null) return null
  const cached = rate(env[`MODEL_${tier}_CACHED_INPUT_PER_MTOK`])
  return {
    inputPerMTok: input,
    outputPerMTok: output,
    ...(cached === null ? {} : { cachedInputPerMTok: cached }),
  }
}

/**
 * The most expensive prices in the table, used when a deployment points at a
 * model we have no captured price for. Guessing low would under-count spend on a
 * key that cannot be topped up; guessing high only degrades the bot early.
 */
const UNKNOWN_MODEL_PRICES: Omit<ModelTier, 'id'> = { inputPerMTok: 1.0, outputPerMTok: 5.0 }

function tier(id: string): ModelTier {
  return { id, ...(PRICES[id] ?? UNKNOWN_MODEL_PRICES) }
}

export function primaryTier(env: EnvLike = process.env): ModelTier {
  const id = env.MODEL_PRIMARY ?? PRIMARY_ID
  const override = priceOverride(env, 'PRIMARY')
  return override === null ? tier(id) : { id, ...override }
}

export function economyTier(env: EnvLike = process.env): ModelTier {
  const id = env.MODEL_ECONOMY ?? ECONOMY_ID
  const override = priceOverride(env, 'ECONOMY')
  return override === null ? tier(id) : { id, ...override }
}

/** True when the configured model has no captured price, so the caller can warn. */
export function hasCapturedPrice(id: string): boolean {
  return id in PRICES
}
