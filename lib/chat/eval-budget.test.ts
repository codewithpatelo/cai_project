import { describe, it, expect } from 'vitest'
import { asEvalBudget, isEvalRequest, EVAL_NAMESPACE } from './eval-budget'
import { governorConfigFromEnv } from './governor-config'

describe('isEvalRequest', () => {
  it('is false when no token is configured, whatever the caller sends', () => {
    // The permissive direction is the dangerous one: a visitor who guesses the
    // header must not escape the pacing that protects the demo.
    expect(isEvalRequest('anything', {})).toBe(false)
    expect(isEvalRequest('', {})).toBe(false)
    expect(isEvalRequest(null, {})).toBe(false)
  })

  it('is false when the caller sends nothing or the wrong token', () => {
    const env = { EVAL_TOKEN: 'correct-horse' }
    expect(isEvalRequest(null, env)).toBe(false)
    expect(isEvalRequest('', env)).toBe(false)
    expect(isEvalRequest('correct-hors', env)).toBe(false)
    expect(isEvalRequest('correct-horsE', env)).toBe(false)
    expect(isEvalRequest('correct-horse-battery', env)).toBe(false)
  })

  it('is true only on an exact match', () => {
    expect(isEvalRequest('correct-horse', { EVAL_TOKEN: 'correct-horse' })).toBe(true)
  })

  it('ignores surrounding whitespace in the configured token', () => {
    expect(isEvalRequest('tok', { EVAL_TOKEN: '  tok  ' })).toBe(true)
  })
})

describe('asEvalBudget', () => {
  const base = governorConfigFromEnv({})

  it('moves spend to its own namespace', () => {
    expect(base.namespace).toBe('dev')
    expect(asEvalBudget(base, {}).namespace).toBe(EVAL_NAMESPACE)
  })

  it('defaults to the budget docs/eval-set.md specifies', () => {
    expect(asEvalBudget(base, {}).totalBudgetUsd).toBe(0.4)
  })

  it('takes EVAL_BUDGET_USD when it is a usable number', () => {
    expect(asEvalBudget(base, { EVAL_BUDGET_USD: '0.25' }).totalBudgetUsd).toBe(0.25)
  })

  it('falls back rather than trusting a broken EVAL_BUDGET_USD', () => {
    // An empty string parses to 0, which would be a budget of nothing -- the same
    // empty-env-var bug that produced a zero price and a NaN horizon earlier.
    for (const raw of ['', '   ', 'free', '-1', '0']) {
      expect(asEvalBudget(base, { EVAL_BUDGET_USD: raw }).totalBudgetUsd).toBe(0.4)
    }
  })

  it('runs without a reserve, which a budget smaller than the reserve would reject', () => {
    expect(base.reserveUsd).toBeGreaterThan(0.4)
    expect(asEvalBudget(base, {}).reserveUsd).toBe(0)
  })

  it('leaves the pacing rules identical, so it evaluates the deployed system', () => {
    const evalCfg = asEvalBudget(base, {})
    expect(evalCfg.tiers).toEqual(base.tiers)
    expect(evalCfg.thresholds).toEqual(base.thresholds)
    expect(evalCfg.reserveWindow).toEqual(base.reserveWindow)
    expect(evalCfg.keyExpiresAtIso).toBe(base.keyExpiresAtIso)
  })
})
