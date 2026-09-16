import { describe, it, expect } from 'vitest'
import { validateLead, confirmationCopy, makeReference } from './lead'

/**
 * The promises in confirmationCopy are the product. A support bot that invents a
 * response time is worse than one that says it cannot help, so the copy is
 * asserted here rather than trusted to survive an edit.
 */

const base = { sessionId: 's-1', topic: 'pricing', urgency: 'general' }

describe('TC5.1 — at least one contact method is required', () => {
  it('rejects a submission with no name, email or company', () => {
    const result = validateLead(base)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.field).toBe('contact')
  })

  it('accepts email only', () => {
    expect(validateLead({ ...base, email: 'a@b.com' }).ok).toBe(true)
  })

  it('accepts name and company with no email', () => {
    expect(validateLead({ ...base, name: 'Dana', company: 'Acme' }).ok).toBe(true)
  })

  it('treats whitespace as absent', () => {
    expect(validateLead({ ...base, name: '   ', email: '  ' }).ok).toBe(false)
  })

  it('rejects an email that is clearly not one', () => {
    const result = validateLead({ ...base, email: 'not-an-email' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.field).toBe('email')
  })

  it('accepts unusual but valid addresses rather than lecturing the user', () => {
    // A false rejection costs Cadre the lead and tells the user they are wrong.
    for (const email of ['a+tag@sub.example.co.uk', "o'brien@example.com"]) {
      expect(validateLead({ ...base, email }).ok, email).toBe(true)
    }
  })

  it('defaults an unknown urgency rather than failing the submission', () => {
    const result = validateLead({ ...base, name: 'Dana', urgency: 'urgent!!' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.urgency).toBe('general')
  })

  it('truncates rather than rejecting an over-long field', () => {
    const result = validateLead({ ...base, name: 'x'.repeat(5000) })
    expect(result.ok).toBe(true)
    if (result.ok) expect((result.value.name ?? '').length).toBeLessThanOrEqual(120)
  })

  it('gives a human message, never a validation code', () => {
    const result = validateLead(base)
    if (!result.ok) {
      expect(result.message).toMatch(/[a-z]{4,}/)
      expect(result.message).not.toMatch(/undefined|null|Error|schema/i)
    }
  })
})

describe('AC5.2 — the confirmation promises nothing we cannot keep', () => {
  const copy = confirmationCopy('01J2ABCXYZ')

  it('gives the reference back', () => {
    expect(copy).toContain('01J2ABCXYZ')
  })

  it('promises no response time', () => {
    expect(copy).not.toMatch(/\b(24|48|business day|shortly|soon|within)\b/i)
  })

  it('promises no meeting and no named person', () => {
    // The words "book" and "meeting" are allowed -- but only inside a denial.
    // Asserting their absence would be wrong: "I can't book a meeting" is
    // exactly the sentence we want.
    expect(copy).toMatch(/can't book a meeting/i)
    expect(copy).not.toMatch(/\b(I'll|I will|we'll|we will)\s+(book|schedule|arrange|set up)/i)
    expect(copy).not.toMatch(/your account manager|will be in touch|someone will/i)
  })

  it('does not claim it emailed anyone', () => {
    expect(copy).toMatch(/can't .*email anyone/i)
  })

  it('says plainly where the details went', () => {
    expect(copy).toMatch(/stored for Cadre's team/i)
  })
})

describe('the reference is opaque, short and sortable', () => {
  it('is quotable: short and unambiguous characters only', () => {
    const ref = makeReference()
    expect(ref).toMatch(/^[0-9A-HJKMNP-TV-Z]{14}$/) // Crockford base32: no I, L, O, U
  })

  it('sorts by time', () => {
    const early = makeReference(new Date('2026-09-18T10:00:00Z'), () => 0)
    const later = makeReference(new Date('2026-09-18T11:00:00Z'), () => 0)
    expect(early < later).toBe(true)
  })

  it('differs between two calls in the same millisecond', () => {
    const now = new Date('2026-09-18T10:00:00Z')
    let n = 0
    const notRandom = () => (n++ % 32) / 32
    expect(makeReference(now, notRandom)).not.toBe(makeReference(now, notRandom))
  })

  it('encodes nothing about the user', () => {
    const ref = makeReference(new Date('2026-09-18T10:00:00Z'), () => 0.5)
    expect(ref).not.toMatch(/@|\./)
  })
})

describe('TC5.3 — nothing the user typed can reach telemetry', () => {
  it('the validated lead exposes PII only under named fields', () => {
    const result = validateLead({ ...base, name: 'Dana', email: 'dana@acme.com', company: 'Acme' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // The handoff route logs sessionHash / urgency / hasEmail and nothing else.
      // This test documents which keys are PII so that list stays deliberate.
      expect(Object.keys(result.value).sort()).toEqual(
        ['company', 'email', 'name', 'sessionId', 'topic', 'urgency'].sort(),
      )
    }
  })
})
