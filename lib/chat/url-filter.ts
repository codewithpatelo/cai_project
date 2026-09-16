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

import { KB_URL_ALLOWLIST, KB_EMAIL_ALLOWLIST } from '../kb/kb.generated'

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
 * Email addresses get the same treatment as links, for the same reason: the bot
 * may give one Cadre publishes and must never invent a plausible-looking one.
 * They are matched BEFORE the URL pattern, because the domain half of an address
 * is host-shaped -- without this, `hello@gocadre.ai` came out as
 * `hello@[link removed]`, mangling the most useful answer the bot has.
 */
const EMAIL_LIKE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi
const ALLOWED_EMAILS: ReadonlySet<string> = new Set(KB_EMAIL_ALLOWLIST.map((e) => e.toLowerCase()))

const EMAIL_REDACTION = '[address removed \u2014 not one Cadre publishes]'

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

  // Emails first, and the surviving ones are placeholdered so the URL pass
  // cannot see their host half.
  const kept: string[] = []
  const withoutEmails = text.replace(EMAIL_LIKE, (match) => {
    if (!ALLOWED_EMAILS.has(match.toLowerCase())) {
      removed.push(match)
      return EMAIL_REDACTION
    }
    kept.push(match)
    return `\u0000EMAIL${kept.length - 1}\u0000`
  })

  const filtered = withoutEmails.replace(URL_LIKE, (match) => {
    if (!isLinkLike(match)) return match
    if (allowed.has(canonical(match))) return match
    removed.push(match)
    return REDACTION
  })

  // Restore the addresses that were allowed through.
  const restored = filtered.replace(/\u0000EMAIL(\d+)\u0000/g, (_, i: string) => kept[Number(i)] ?? '')

  return { text: restored, removed }
}

/** Exposed so the health endpoint and tests can report what the bot may link to. */
export function allowedUrls(): string[] {
  return [...KB_URL_ALLOWLIST]
}
