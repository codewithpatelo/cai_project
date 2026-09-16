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

/** Prices keyed by the model they were captured for, so an override cannot silently inherit the wrong ones. */
const PRICES: Record<string, Omit<ModelTier, 'id'>> = {
  [PRIMARY_ID]: { inputPerMTok: 0.75, outputPerMTok: 3.75, cachedInputPerMTok: 0.075 },
  [ECONOMY_ID]: { inputPerMTok: 0.25, outputPerMTok: 1.5 },
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
  return tier(env.MODEL_PRIMARY ?? PRIMARY_ID)
}

export function economyTier(env: EnvLike = process.env): ModelTier {
  return tier(env.MODEL_ECONOMY ?? ECONOMY_ID)
}

/** True when the configured model has no captured price, so the caller can warn. */
export function hasCapturedPrice(id: string): boolean {
  return id in PRICES
}
