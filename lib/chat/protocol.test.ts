import { describe, it, expect } from 'vitest'
import { shouldEscalate } from './protocol'

/**
 * The form is lead capture, and as an ending it is the right ending. The bug was
 * that it was every ending: the trigger matched the contact URL, which the prompt
 * puts in nearly every reply, so a visitor got a form under each answer and the
 * conversation felt finished before it started.
 */
describe('shouldEscalate', () => {
  it('fires when the bot offers to take the visitor\'s details', () => {
    for (const answer of [
      "Or give me your name, work email and company and I'll pass your details to the team.",
      'I can also pass your details along.',
      "If you give me your name, work email and company I'll pass the access request to the team.",
      "I can't connect you to someone live, but I can take your details and pass them to the Cadre team.",
      'Happy to pass your information on to a strategist.',
    ]) {
      expect(shouldEscalate(answer), answer).toBe(true)
    }
  })

  it('does not fire on an answer that merely points at the contact page', () => {
    // Every one of these is a real answer the bot should be allowed to finish
    // without a lead form appearing underneath it.
    for (const answer of [
      'Cadre works across professional services, private equity and financial services. If your industry is not on that list, the team can tell you: https://www.cadreai.com/contact',
      'Pricing comes from a conversation with their team: https://www.cadreai.com/contact',
      'You can reach them at https://www.cadreai.com/contact, on hello@gocadre.ai, or (619) 324-3223.',
      'Cadre publishes an eight-pillar AI Maturity Index. Want me to walk through the pillars?',
    ]) {
      expect(shouldEscalate(answer), answer).toBe(false)
    }
  })

  it('does not fire on an ordinary informational answer', () => {
    expect(shouldEscalate('Cadre AI does AI strategy, engineering and agents for B2B companies.')).toBe(false)
    expect(shouldEscalate('')).toBe(false)
  })

  it('does not fire on the words appearing in an unrelated sentence', () => {
    // "details" and "request" are ordinary words; the trigger is the offer.
    expect(shouldEscalate('The team can go over the details of your setup.')).toBe(false)
    expect(shouldEscalate('That request would go to your Cadre contact.')).toBe(false)
  })
})
