import { describe, it, expect } from 'vitest'
import { followUpsFor } from './followups'

describe('follow-up chips', () => {
  it('offers somewhere to go after a complete answer', () => {
    const chips = followUpsFor(
      'What does Cadre AI do?',
      'Cadre AI does AI strategy, leadership facilitation, engineering and agents for B2B companies.',
    )
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.length).toBeLessThanOrEqual(3)
    for (const chip of chips) expect(chip.label.length).toBeGreaterThan(0)
  })

  it('stays silent when the bot asked the visitor something', () => {
    // The trap the reference names: offering three new questions right after the
    // bot asked one hands the visitor questions instead of letting them answer.
    expect(
      followUpsFor(
        'Do you work with private equity?',
        'Yes. If you tell me which part of the deal lifecycle you are looking at, I can point you at the closest service line.',
      ),
    ).toEqual([])
    expect(followUpsFor('hi', 'What would you like to know about Cadre?')).toEqual([])
  })

  it('does not suggest what the visitor just asked about', () => {
    const chips = followUpsFor(
      'What is the AI Maturity Index?',
      'It is an eight-pillar framework Cadre publishes.',
    )
    expect(chips.some((c) => /maturity index/i.test(c.label))).toBe(false)
  })

  it('does not repeat a topic from earlier in the conversation', () => {
    const chips = followUpsFor('Are you SOC 2 compliant?', 'No certification is published.', [
      'What does Cadre AI do?',
    ])
    expect(chips.some((c) => /services does Cadre offer/i.test(c.label))).toBe(false)
  })

  it('suggests nothing rather than something ungrounded', () => {
    expect(followUpsFor('anything', '')).toEqual([])
    expect(followUpsFor('', '   ')).toEqual([])
  })

  it('only ever proposes questions the knowledge base covers', async () => {
    // The reason these are derived rather than generated: a chip must never send
    // the visitor at something the bot will then refuse.
    const { FAQ } = await import('../kb/faq.generated')
    const covered = new Set(FAQ.map((e) => e.scenario))
    const chips = followUpsFor('What does Cadre do?', 'Strategy, engineering and agents.')
    expect(chips.length).toBeGreaterThan(0)
    expect(covered.size).toBeGreaterThan(0)
  })
})
