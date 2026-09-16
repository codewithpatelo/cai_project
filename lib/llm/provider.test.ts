import { describe, it, expect } from 'vitest'
import { activeProvider, isProviderId } from './provider'
import { primaryTier, economyTier } from './models'

describe('provider selection', () => {
  it('defaults to OpenRouter', () => {
    expect(activeProvider({}).id).toBe('openrouter')
  })

  it('selects DeepSeek when asked', () => {
    const p = activeProvider({ LLM_PROVIDER: 'deepseek' })
    expect(p.id).toBe('deepseek')
    expect(p.baseUrl).toContain('api.deepseek.com')
  })

  it('falls back to OpenRouter on an unknown value rather than failing at request time', () => {
    expect(activeProvider({ LLM_PROVIDER: 'anthropic' }).id).toBe('openrouter')
    expect(isProviderId('anthropic')).toBe(false)
  })

  it('sends OpenRouter attribution headers only to OpenRouter', () => {
    expect(activeProvider({ OPENROUTER_APP_TITLE: 'x' }).extraHeaders['X-Title']).toBe('x')
    expect(activeProvider({ LLM_PROVIDER: 'deepseek', OPENROUTER_APP_TITLE: 'x' }).extraHeaders).toEqual({})
  })

  it('records that DeepSeek does not report a real cost', () => {
    // Every DeepSeek call is therefore priced from configured rates and recorded
    // as `estimated`, with the pessimistic multiplier applied.
    expect(activeProvider({ LLM_PROVIDER: 'deepseek' }).reportsCost).toBe(false)
    expect(activeProvider({}).reportsCost).toBe(true)
  })
})

describe('prices are never invented for an unverified provider', () => {
  it('uses the captured OpenRouter prices by default', () => {
    expect(primaryTier({}).inputPerMTok).toBe(0.75)
    expect(economyTier({}).outputPerMTok).toBe(1.5)
  })

  it('falls back to the most expensive captured rates for an unknown model', () => {
    // Guessing low under-counts spend on a key that cannot be topped up;
    // guessing high only degrades the bot early.
    const t = primaryTier({ MODEL_PRIMARY: 'deepseek-chat' })
    expect(t.inputPerMTok).toBe(1.0)
    expect(t.outputPerMTok).toBe(5.0)
  })

  it('accepts an explicit price override from the deployment', () => {
    const t = primaryTier({
      MODEL_PRIMARY: 'deepseek-chat',
      MODEL_PRIMARY_INPUT_PER_MTOK: '0.28',
      MODEL_PRIMARY_OUTPUT_PER_MTOK: '0.42',
    })
    expect(t.id).toBe('deepseek-chat')
    expect(t.inputPerMTok).toBe(0.28)
    expect(t.outputPerMTok).toBe(0.42)
  })

  it('ignores a half-configured override rather than using a zero rate', () => {
    // An input rate with no output rate would price every completion at zero.
    const t = primaryTier({ MODEL_PRIMARY: 'deepseek-chat', MODEL_PRIMARY_INPUT_PER_MTOK: '0.28' })
    expect(t.inputPerMTok).toBe(1.0)
  })

  it('ignores a negative or non-numeric override', () => {
    for (const bad of ['-1', 'free', '']) {
      const t = primaryTier({
        MODEL_PRIMARY: 'deepseek-chat',
        MODEL_PRIMARY_INPUT_PER_MTOK: bad,
        MODEL_PRIMARY_OUTPUT_PER_MTOK: '0.42',
      })
      expect(t.inputPerMTok, bad).toBe(1.0)
    }
  })
})

describe('a key provisioned under the vendor name is found', () => {
  it('accepts DEEPSEEK_API_KEY for DeepSeek, before the generic name', () => {
    // Platform integrations provision the vendor's own variable. Insisting on
    // the generic name turns a working setup into a silent "no key".
    expect(activeProvider({ LLM_PROVIDER: 'deepseek' }).keyEnvNames[0]).toBe('DEEPSEEK_API_KEY')
    expect(activeProvider({ LLM_PROVIDER: 'deepseek' }).keyEnvNames).toContain('OPENROUTER_API_KEY')
  })

  it('does not let an OpenRouter deployment pick up a DeepSeek key', () => {
    expect(activeProvider({ LLM_PROVIDER: 'openrouter' }).keyEnvNames).toEqual(['OPENROUTER_API_KEY'])
  })
})

describe('the provider is inferred when LLM_PROVIDER is unset', () => {
  it('infers DeepSeek from a DeepSeek key alone', () => {
    // Guessing wrong here sends a Gemini model id to DeepSeek and fails in a way
    // that reads like a bad key.
    expect(activeProvider({ DEEPSEEK_API_KEY: 'x' }).id).toBe('deepseek')
  })

  it('keeps OpenRouter when both keys are present', () => {
    expect(activeProvider({ DEEPSEEK_API_KEY: 'x', OPENROUTER_API_KEY: 'y' }).id).toBe('openrouter')
  })

  it('lets an explicit LLM_PROVIDER override the inference', () => {
    expect(activeProvider({ LLM_PROVIDER: 'openrouter', DEEPSEEK_API_KEY: 'x' }).id).toBe('openrouter')
  })
})

describe('the default model follows the provider', () => {
  it('uses a DeepSeek model id on DeepSeek', () => {
    // Sending google/gemini-3.8-flash to api.deepseek.com is an obvious failure
    // that is not obvious at all when you are reading a 400 from a provider.
    expect(primaryTier({ LLM_PROVIDER: 'deepseek' }).id).toBe('deepseek-chat')
    expect(economyTier({ LLM_PROVIDER: 'deepseek' }).id).toBe('deepseek-chat')
  })

  it('still lets MODEL_PRIMARY override it', () => {
    expect(primaryTier({ LLM_PROVIDER: 'deepseek', MODEL_PRIMARY: 'deepseek-reasoner' }).id).toBe('deepseek-reasoner')
  })

  it('prices an uncaptured DeepSeek model pessimistically', () => {
    // We could reach no pricing page, so the rate is the most expensive one we
    // did capture. That degrades the bot early rather than overspending.
    expect(primaryTier({ LLM_PROVIDER: 'deepseek' }).inputPerMTok).toBe(1.0)
  })
})
