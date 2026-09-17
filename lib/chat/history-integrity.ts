/**
 * Proof that the bot actually said what the client claims it said.
 *
 * OWASP LLM01:2026 (Prompt Injection), in its indirect form. The transcript is
 * held by the browser -- there is no server-side conversation store, by decision
 * (ADR-012) -- so `history` arrives in the request body and every `assistant`
 * turn in it is attacker-controlled. Posting a forged transcript makes the model
 * treat a fabricated line as something it previously said, and a follow-up
 * question can then lean on it.
 *
 * For a consultancy the damage is a screenshot: "look what Cadre's bot told me."
 * The output filter catches an invented URL, but nothing catches an invented
 * price or promise arriving through a forged turn.
 *
 * The fix is stateless, which is what lets it coexist with storing nothing: the
 * server signs each answer it produces, the client echoes the signature back,
 * and a turn whose signature does not verify is dropped before assembly. An
 * attacker cannot forge a signature without the salt, and the salt never leaves
 * the server.
 *
 * This does NOT authenticate the user or prevent anyone from asking anything.
 * It only means the model cannot be told it said something it did not.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Short on purpose: it rides in every request, and 96 bits is ample here. */
const SIGNATURE_BYTES = 12

export function signAnswer(content: string, salt: string): string {
  return createHmac('sha256', salt).update(content).digest('base64url').slice(0, SIGNATURE_BYTES * 2)
}

export function verifyAnswer(content: string, signature: string, salt: string): boolean {
  const expected = signAnswer(content, salt)
  if (expected.length !== signature.length) return false
  // Constant-time: a length-independent compare would leak the prefix a guess
  // got right, one character at a time.
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

export interface SignedTurn {
  role: 'user' | 'assistant'
  content: string
  /** Present only on assistant turns this server produced. */
  sig?: string
}

export interface HistoryCheck {
  kept: { role: 'user' | 'assistant'; content: string }[]
  /** Assistant turns dropped because they were unsigned or wrongly signed. */
  rejected: number
  /** True when no salt is configured and verification could not run. */
  unverified: boolean
}

/**
 * Drop any assistant turn the server cannot prove it wrote.
 *
 * User turns pass through untouched: the user is allowed to have said anything,
 * and the prompt already treats user text as something to answer rather than to
 * obey. It is the *assistant* role that carries borrowed authority.
 *
 * With no salt configured, verification cannot run. It fails OPEN rather than
 * closed, because failing closed would silently erase every conversation's
 * context and look like amnesia; /api/health reports the state instead.
 */
export function verifyHistory(turns: SignedTurn[], salt: string): HistoryCheck {
  if (salt === '') {
    return {
      kept: turns.map((t) => ({ role: t.role, content: t.content })),
      rejected: 0,
      unverified: true,
    }
  }

  const kept: { role: 'user' | 'assistant'; content: string }[] = []
  let rejected = 0

  for (const turn of turns) {
    if (turn.role === 'user') {
      kept.push({ role: 'user', content: turn.content })
      continue
    }
    if (typeof turn.sig === 'string' && verifyAnswer(turn.content, turn.sig, salt)) {
      kept.push({ role: 'assistant', content: turn.content })
      continue
    }
    rejected++
  }

  return { kept, rejected, unverified: false }
}
