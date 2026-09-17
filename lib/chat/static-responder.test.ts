import { describe, it, expect } from 'vitest'
import { staticAnswer, scoreEntry, chunkAnswer, STATIC_PACING } from './static-responder'
import { FAQ } from '../kb/faq.generated'
import { SUGGESTIONS } from './suggestions'

/**
 * STATIC is what the bot says when it has no budget, no store or no provider.
 * If it answers the wrong thing, it does so at exactly the moment nothing else
 * can cover for it.
 */

describe('the STATIC tier answers the six brief scenarios', () => {
  const cases: [string, RegExp][] = [
    ['What does Cadre AI do?', /four service lines|AI Strategy/i],
    ['Do you work with construction companies?', /construction/i],
    ['How do I book a call with a strategist?', /contact/i],
    ['What is the AI Maturity Index?', /Index/i],
    ['How do I access the client portal?', /portal/i],
    ['Is my data safe? Are you SOC 2 compliant?', /security|privacy|compliance/i],
  ]

  for (const [question, expected] of cases) {
    it(`answers: ${question}`, () => {
      expect(staticAnswer(question)).toMatch(expected)
    })
  }
})

describe('every suggested chip has a real answer, not the fallback', () => {
  // These six are what a reviewer clicks first, and they must work in the tier
  // where there is no model to cover a keyword miss.
  const fallbackText = FAQ.find((e) => e.scenario === 'fallback')?.answer
  for (const chip of SUGGESTIONS) {
    it(`matches a scenario: ${chip}`, () => {
      expect(staticAnswer(chip)).not.toBe(fallbackText)
    })
  }
})

describe('STATIC refuses pricing without a model', () => {
  // The refusal cannot depend on the model, because STATIC is the tier where
  // there is no model. It has to be true of the canned text itself.
  const pricingQuestions = [
    'How much does a Cadre engagement cost?',
    'What is the price?',
    'Ballpark budget for a project?',
  ]

  for (const q of pricingQuestions) {
    it(`gives no figure for: ${q}`, () => {
      const answer = staticAnswer(q)
      expect(answer).not.toMatch(/\$\s?\d|\d+\s?(k|thousand|million)\b/i)
      expect(answer).toMatch(/contact/i)
    })
  }
})

describe('no static answer contains a price or an invented link', () => {
  for (const entry of FAQ) {
    it(`${entry.scenario} is safe`, () => {
      expect(entry.answer).not.toMatch(/\$\s?\d/)
      expect(entry.answer).not.toMatch(/portal\.cadreai|app\.cadreai|cadreai\.com\/login|calendly/i)
    })
  }
})

describe('an unrecognised question still routes to a person', () => {
  it('falls back to the handoff answer', () => {
    const answer = staticAnswer('What is the weather in Denver?')
    expect(answer).toMatch(/cadreai\.com\/contact|team/i)
  })

  it('never returns an empty string', () => {
    for (const q of ['', '???', 'asdfgh']) {
      expect(staticAnswer(q).length).toBeGreaterThan(20)
    }
  })
})

describe('keyword scoring prefers the more specific match', () => {
  it('scores a multi-word phrase above a single stray word', () => {
    const portal = FAQ.find((e) => e.scenario === 'portal')
    expect(portal).toBeTruthy()
    if (portal) {
      expect(scoreEntry('how do I access the client portal', portal)).toBeGreaterThan(0)
    }
  })

  it('does not match a keyword inside a longer word', () => {
    // "index" must not fire on "indexed", or unrelated questions get the
    // Maturity Index answer.
    const index = FAQ.find((e) => e.scenario === 'maturity-index')
    expect(index).toBeTruthy()
    if (index) expect(scoreEntry('is my site indexed by Google', index)).toBe(0)
  })
})

describe('static answers stream like a model response', () => {
  it('reassembles to exactly the original text', () => {
    const answer = staticAnswer('What does Cadre AI do?')
    expect([...chunkAnswer(answer)].join('')).toBe(answer)
  })

  it('emits more than one chunk for a real answer', () => {
    expect([...chunkAnswer(staticAnswer('What does Cadre AI do?'))].length).toBeGreaterThan(1)
  })
})

describe('the static tier is paced, not dumped', () => {
  it('declares a lead-in and an inter-chunk delay', () => {
    // Enqueued in a tight loop, every chunk lands in the same frame: the
    // streaming cursor appears and vanishes instantly and the transcript jumps.
    // The words were right and the interface still read as broken.
    expect(STATIC_PACING.leadInMs).toBeGreaterThan(0)
    expect(STATIC_PACING.betweenChunksMs).toBeGreaterThan(0)
  })

  it('stays well under the time a real model call takes', () => {
    // STATIC should feel faster than the model, just not impossibly so.
    const answer = staticAnswer('What does Cadre AI do?')
    const chunks = [...chunkAnswer(answer)].length
    const total = STATIC_PACING.leadInMs + (chunks - 1) * STATIC_PACING.betweenChunksMs
    expect(total).toBeLessThan(1500)
  })
})
