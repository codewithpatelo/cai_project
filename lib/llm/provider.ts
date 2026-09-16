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
  },
  deepseek: {
    id: 'deepseek',
    // OpenAI-compatible endpoint; same request and streaming shape.
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    reportsCost: false,
  },
}

export function isProviderId(value: string): value is ProviderId {
  return value === 'openrouter' || value === 'deepseek'
}

export function activeProvider(env: EnvLike = process.env): Provider {
  const configured = env.LLM_PROVIDER ?? 'openrouter'
  const id: ProviderId = isProviderId(configured) ? configured : 'openrouter'
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
