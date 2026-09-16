import { describe, it, expect } from 'vitest'
import { filterUrls } from './url-filter'

/**
 * TC4.1. The cases here are drawn from the failure list in CLAUDE.md: these are
 * URLs this project has actually hallucinated before, not hypothetical ones.
 */

describe('TC4.1 — the output-side URL filter', () => {
  it('lets a KB-cited URL through untouched', () => {
    const text = 'You can reach the team at https://www.cadreai.com/contact.'
    expect(filterUrls(text).text).toBe(text)
  })

  it('strips an invented portal URL', () => {
    const result = filterUrls('Log in at https://portal.cadreai.com/login to see your agents.')
    expect(result.text).not.toContain('portal.cadreai.com')
    expect(result.removed).toHaveLength(1)
  })

  it('strips a bare hostname with no scheme', () => {
    // The KB names these hostnames as inventions, so the model has seen the
    // string. Only matching `https://` would let the bare form straight through.
    const result = filterUrls('Try app.cadreai.com or portal.cadreai.com.')
    expect(result.text).not.toContain('app.cadreai.com')
    expect(result.text).not.toContain('portal.cadreai.com')
    expect(result.removed).toHaveLength(2)
  })

  it('strips an invented path on an allowed host', () => {
    // The host is real; the page is not. Allowing by host would defeat the point.
    const result = filterUrls('Book at https://www.cadreai.com/book')
    expect(result.text).not.toContain('/book')
  })

  it('strips a scheduler link', () => {
    expect(filterUrls('https://calendly.com/cadre/intro').removed).toHaveLength(1)
  })

  it('treats www and bare forms of an allowed URL as the same page', () => {
    expect(filterUrls('see cadreai.com/contact').removed).toEqual([])
    expect(filterUrls('see https://cadreai.com/contact').removed).toEqual([])
  })

  it('ignores a trailing sentence period when matching', () => {
    expect(filterUrls('Go to https://www.cadreai.com/contact.').removed).toEqual([])
  })

  it('leaves ordinary prose alone', () => {
    const text = 'Cadre works with B2B companies, e.g. professional services and manufacturing.'
    expect(filterUrls(text).text).toBe(text)
  })

  it('leaves text with no links at all completely unchanged', () => {
    const text = 'Cadre AI has four service lines and does not publish pricing.'
    expect(filterUrls(text).text).toBe(text)
  })

  it('handles several links in one answer, keeping the good one', () => {
    const result = filterUrls(
      'Contact https://www.cadreai.com/contact or log in at portal.cadreai.com.',
    )
    expect(result.text).toContain('https://www.cadreai.com/contact')
    expect(result.text).not.toContain('portal.cadreai.com')
    expect(result.removed).toEqual(['portal.cadreai.com'])
  })

  it('records what it removed without recording any user text', () => {
    const result = filterUrls('My password is hunter2, see portal.cadreai.com')
    expect(result.removed).toEqual(['portal.cadreai.com'])
    expect(result.removed.join()).not.toContain('hunter2')
  })
})

describe('email addresses are a class of their own', () => {
  it('lets a published Cadre address through intact', () => {
    // Regression: the domain half of an address is host-shaped, so the URL pass
    // turned hello@gocadre.ai into "hello@[link removed]" -- mangling the most
    // useful answer the bot has.
    const text = 'Email hello@gocadre.ai or call (619) 324-3223.'
    expect(filterUrls(text).text).toBe(text)
    expect(filterUrls(text).removed).toEqual([])
  })

  it('strips an invented address that looks plausible', () => {
    const result = filterUrls('Write to support@cadreai.com and they will help.')
    expect(result.text).not.toContain('support@cadreai.com')
    expect(result.removed).toEqual(['support@cadreai.com'])
  })

  it('leaves a phone number alone', () => {
    expect(filterUrls('Call (619) 324-3223.').removed).toEqual([])
  })

  it('handles an address and a link in the same sentence', () => {
    const result = filterUrls('See https://www.cadreai.com/contact or email hello@gocadre.ai')
    expect(result.text).toContain('https://www.cadreai.com/contact')
    expect(result.text).toContain('hello@gocadre.ai')
    expect(result.removed).toEqual([])
  })

  it('still strips an invented link when a good address is present', () => {
    const result = filterUrls('hello@gocadre.ai or portal.cadreai.com')
    expect(result.text).toContain('hello@gocadre.ai')
    expect(result.text).not.toContain('portal.cadreai.com')
  })
})
