/**
 * Lead validation and the honest confirmation copy.
 *
 * The product rule this file exists to enforce: the bot stores details for
 * Cadre's team to pick up, and promises nothing else. No response time, no named
 * person, no meeting, no priority. Faking a human channel would be the worst
 * possible dishonesty in a support bot (docs/architecture.md §1, OUT #7), so the
 * copy is here, tested, rather than written inline where it can drift.
 */

export type Urgency = 'general' | 'active_project' | 'existing_client'

export interface Lead {
  sessionId: string
  name?: string
  email?: string
  company?: string
  topic: string
  urgency: Urgency
}

export type LeadValidation =
  | { ok: true; value: Lead }
  | { ok: false; message: string; field?: 'contact' | 'topic' | 'email' }

const URGENCIES: readonly Urgency[] = ['general', 'active_project', 'existing_client']

function isUrgency(v: unknown): v is Urgency {
  return typeof v === 'string' && (URGENCIES as readonly string[]).includes(v)
}

function clean(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  return trimmed.length === 0 ? undefined : trimmed.slice(0, max)
}

/**
 * Deliberately permissive. A regex that rejects a valid address is worse than one
 * that accepts a typo: the typo costs Cadre one unreachable lead, the false
 * rejection costs them the lead entirely and tells the user they are wrong.
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function validateLead(input: unknown): LeadValidation {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, message: 'That form could not be read. Try again.' }
  }

  const raw = input as Record<string, unknown>
  const sessionId = clean(raw.sessionId, 100)
  if (sessionId === undefined) {
    return { ok: false, message: 'That form could not be read. Try again.' }
  }

  const name = clean(raw.name, 120)
  const email = clean(raw.email, 200)
  const company = clean(raw.company, 160)

  // At least one contact method, or the lead is unreachable and storing it only
  // creates the impression that someone will follow up.
  if (name === undefined && email === undefined && company === undefined) {
    return {
      ok: false,
      field: 'contact',
      message: 'Add at least one of name, work email or company so the team can reach you.',
    }
  }

  if (email !== undefined && !looksLikeEmail(email)) {
    return { ok: false, field: 'email', message: 'That email address does not look right.' }
  }

  const topic = clean(raw.topic, 1000) ?? ''
  const urgency: Urgency = isUrgency(raw.urgency) ? raw.urgency : 'general'

  return {
    ok: true,
    value: {
      sessionId,
      ...(name === undefined ? {} : { name }),
      ...(email === undefined ? {} : { email }),
      ...(company === undefined ? {} : { company }),
      topic,
      urgency,
    },
  }
}

/**
 * What the user is told after submitting.
 *
 * Every clause here is a promise we can actually keep. Read it against
 * kb/08-contact-and-escalation.md § "Never promise" before changing a word.
 */
export function confirmationCopy(reference: string): string {
  return (
    `Passed along. Your reference is ${reference}. ` +
    "It's stored for Cadre's team to pick up — I can't book a meeting, " +
    "email anyone on your behalf, or promise when someone replies."
  )
}

/**
 * A short opaque reference, so the user has something to quote.
 *
 * Time-ordered like a ULID so support can sort by it, but built from crypto
 * randomness rather than pulling in a dependency for twelve characters.
 */
export function makeReference(now: Date = new Date(), random: () => number = Math.random): string {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32: no I, L, O, U
  let time = now.getTime()
  let stamp = ''
  for (let i = 0; i < 8; i++) {
    stamp = (ALPHABET[time % 32] ?? '0') + stamp
    time = Math.floor(time / 32)
  }
  let suffix = ''
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[Math.floor(random() * 32)] ?? '0'
  }
  return `${stamp}${suffix}`
}
