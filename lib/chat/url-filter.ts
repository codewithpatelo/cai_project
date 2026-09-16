/**
 * Output-side URL filter.
 *
 * The last line of defence, and the only one that does not depend on the model
 * behaving (docs/system-prompt.md § Prompt-injection posture, layer 4). Whatever
 * the model produced and for whatever reason, a link that no kb/ Sources block
 * cites does not reach the user.
 *
 * This matters more than it looks. An invented portal link sends a real client to
 * a page that does not exist -- a support ticket Cadre did not have before,
 * created by the bot that exists to prevent exactly that.
 */

import { KB_URL_ALLOWLIST } from '../kb/kb.generated'

/** Matches a full URL, and also a bare host like `portal.cadreai.com/login`. */
const URL_LIKE =
  /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>()[\]"']*)?/gi

/** What replaces a stripped link. Says what happened; does not apologise. */
const REDACTION = '[link removed — not in Cadre’s published pages]'

/**
 * Normalise for comparison: drop scheme, `www.`, trailing slash and case.
 *
 * Comparing whole strings would let `https://www.cadreai.com/contact` past while
 * blocking `cadreai.com/contact`, which is the same page and the same risk.
 */
function canonical(raw: string): string {
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[.,;:!?)\]]+$/, '')
    .replace(/\/$/, '')
    .toLowerCase()
}

const ALLOWED: ReadonlySet<string> = new Set(KB_URL_ALLOWLIST.map(canonical))

/**
 * True when this looks like a link at all.
 *
 * Guards against stripping ordinary prose: "e.g." and "i.e." match a naive
 * host pattern, and a bot that mangles its own sentences is worse than one that
 * occasionally leaves a harmless string alone.
 */
function isLinkLike(candidate: string): boolean {
  const c = canonical(candidate)
  const tld = c.split('/')[0]?.split('.').pop() ?? ''
  // Two-letter "TLDs" from abbreviations like e.g. / i.e. are not links.
  return tld.length >= 2 && /^[a-z]+$/.test(tld) && !/^(e\.g|i\.e|etc)\b/i.test(candidate)
}

export interface FilterResult {
  text: string
  /** Links removed, for telemetry. Never includes user text. */
  removed: string[]
}

export function filterUrls(text: string, allowed: ReadonlySet<string> = ALLOWED): FilterResult {
  const removed: string[] = []

  const filtered = text.replace(URL_LIKE, (match) => {
    if (!isLinkLike(match)) return match
    if (allowed.has(canonical(match))) return match
    removed.push(match)
    return REDACTION
  })

  return { text: filtered, removed }
}

/** Exposed so the health endpoint and tests can report what the bot may link to. */
export function allowedUrls(): string[] {
  return [...KB_URL_ALLOWLIST]
}
