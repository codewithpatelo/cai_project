/**
 * Which LLM provider this deployment talks to.
 *
 * Both providers speak the same OpenAI-compatible chat-completions dialect, so
 * the client code is shared; what differs is the endpoint, the attribution
 * headers, and whether the provider reports a real cost.
 *
 * ADR-023. The primary is OpenRouter with pinned Gemini ids; DeepSeek exists as
 * a fallback when only a DeepSeek key is available.
 */

import type { EnvLike } from './models'

export type ProviderId = 'openrouter' | 'deepseek'

export interface Provider {
  id: ProviderId
  baseUrl: string
  /**
   * Environment variables that may hold this provider's key, in priority order.
   *
   * ADR-023 chose a single generic name so a key could not sit in the wrong
   * variable. Reality supplied the counter-example: platform integrations
   * provision the vendor's own name (DEEPSEEK_API_KEY) automatically, and
   * insisting on the generic one turns a working setup into a silent 'no key'.
   * So each provider accepts its conventional name first, then the generic one.
   */
  keyEnvNames: string[]
  /**
   * Whether the provider returns a real `cost` in the streaming usage block.
   *
   * OpenRouter does. DeepSeek returns token counts but no cost, so every call is
   * priced from the configured per-token rates and recorded as `estimated`. That
   * is not a degradation of the governor -- the pessimistic 1.25x multiplier
   * applies and it errs toward degrading early -- but it does mean the ledger is
   * an estimate rather than the provider's own number, and /api/health says so.
   */
  reportsCost: boolean
  extraHeaders: Record<string, string>
}

const PROVIDERS: Record<ProviderId, Omit<Provider, 'extraHeaders'>> = {
  openrouter: {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    reportsCost: true,
    keyEnvNames: ['OPENROUTER_API_KEY'],
  },
  deepseek: {
    id: 'deepseek',
    // OpenAI-compatible endpoint; same request and streaming shape.
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    reportsCost: false,
    keyEnvNames: ['DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY'],
  },
}

/** Each provider's default model, so a provider switch cannot send the wrong id. */
const DEFAULT_MODELS: Record<ProviderId, { primary: string; economy: string }> = {
  openrouter: { primary: 'google/gemini-3.8-flash', economy: 'google/gemini-3.1-flash-lite' },
  deepseek: { primary: 'deepseek-chat', economy: 'deepseek-chat' },
}

export function defaultModels(env: EnvLike = process.env): { primary: string; economy: string } {
  return DEFAULT_MODELS[activeProvider(env).id]
}

export function isProviderId(value: string): value is ProviderId {
  return value === 'openrouter' || value === 'deepseek'
}

/**
 * Which provider is configured.
 *
 * LLM_PROVIDER wins when set. Otherwise infer from which key is present: a
 * deployment that has DEEPSEEK_API_KEY and no OpenRouter key clearly means
 * DeepSeek, and guessing wrong there sends a Gemini model id to DeepSeek's
 * endpoint and fails in a way that reads like a broken key.
 */
export function activeProvider(env: EnvLike = process.env): Provider {
  const configured = env.LLM_PROVIDER
  let id: ProviderId = 'openrouter'
  if (configured !== undefined && isProviderId(configured)) {
    id = configured
  } else if (env.DEEPSEEK_API_KEY && !env.OPENROUTER_API_KEY) {
    id = 'deepseek'
  }
  const base = PROVIDERS[id]

  return {
    ...base,
    extraHeaders:
      id === 'openrouter'
        ? {
            // Attribution only; both are safe to be public.
            'HTTP-Referer': env.OPENROUTER_APP_URL ?? '',
            'X-Title': env.OPENROUTER_APP_TITLE ?? '',
          }
        : {},
  }
}
