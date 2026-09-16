/**
 * The STATIC tier: keyword-matched answers compiled from the same kb/ files the
 * live answers are grounded in.
 *
 * This is the floor the whole degradation ladder rests on. It makes no provider
 * call, so it costs nothing and cannot fail -- which is what makes it a valid
 * floor rather than just a nicer error page. Every path that could otherwise
 * surface an error to the user lands here: budget exhausted, ledger unreachable,
 * rate limited, provider down.
 */

import { FAQ } from '../kb/faq.generated'
import type { FaqEntry } from '../kb/compile'

/** Split into comparable words, so "pricing" matches "price" only via the keyword list. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Score one entry against the question.
 *
 * A multi-word keyword ("do you work with") scores by its whole phrase, which is
 * what stops a stray "work" from beating an exact topic match. Longer phrases are
 * worth more because they are less likely to match by accident.
 */
export function scoreEntry(question: string, entry: FaqEntry): number {
  const haystack = ` ${words(question).join(' ')} `
  let score = 0
  for (const keyword of entry.keywords) {
    const needle = ` ${words(keyword).join(' ')} `
    if (needle.trim().length === 0) continue
    if (haystack.includes(needle)) score += needle.trim().split(' ').length
  }
  return score
}

/**
 * Pick the best canned answer.
 *
 * Falls back to the handoff answer rather than to silence: a user who asked
 * something unrecognised still gets a route to a person, which is the honest
 * answer the product is built around.
 */
export function staticAnswer(question: string, faq: readonly FaqEntry[] = FAQ): string {
  let best: FaqEntry | null = null
  let bestScore = 0

  for (const entry of faq) {
    if (entry.scenario === 'fallback') continue
    const score = scoreEntry(question, entry)
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }

  if (best !== null) return best.answer

  const fallback = faq.find((e) => e.scenario === 'fallback')
  return (
    fallback?.answer ??
    'I do not have a verified answer for that. You can reach the Cadre team at https://www.cadreai.com/contact.'
  )
}

/**
 * Stream a static answer in small pieces.
 *
 * Deliberately shaped like a model response: the user should not be able to tell
 * that the budget ran out, only that the answer arrived. The tier badge is for
 * the reviewer, not for a prospect.
 */
export function* chunkAnswer(answer: string, size = 24): Generator<string> {
  const pieces = answer.split(/(\s+)/)
  let buffer = ''
  for (const piece of pieces) {
    buffer += piece
    if (buffer.length >= size) {
      yield buffer
      buffer = ''
    }
  }
  if (buffer.length > 0) yield buffer
}
