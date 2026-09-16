/**
 * Build-time knowledge-base compiler.
 *
 * Turns `kb/*.md` into two generated modules:
 *   - `kb.generated.ts`  the single string injected inside <knowledge_base>
 *   - `faq.generated.ts` keyword -> canned answer, used by the zero-cost STATIC tier
 *
 * Both come from the same source files on purpose. If the STATIC answers were
 * maintained separately they would drift from the live ones, and the tier that
 * exists to be reliable would become the tier that is quietly wrong.
 *
 * The compiler is also a gate. It fails the build rather than emitting a KB that
 * breaks the project's first property -- never state a Cadre fact that isn't in
 * `kb/` with a source. Run by `pnpm kb:compile`, which `pnpm build` runs first.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Verification tiers
// ---------------------------------------------------------------------------

/** How well a fact is backed. See `kb/README.md` § Verification status. */
export type Verification = 'snippet' | 'brief' | 'live'

/**
 * `brief` and `live` are verified: one is the take-home brief itself, the other
 * was read off the live page. `snippet` came from a search extract of a real
 * page and is *plausible but unconfirmed* -- which is not the same as true.
 */
const VERIFICATION_RANK: Record<Verification, number> = { snippet: 0, brief: 1, live: 1 }

function isVerification(s: string): s is Verification {
  return s === 'snippet' || s === 'brief' || s === 'live'
}

// ---------------------------------------------------------------------------
// The scenarios the STATIC tier must be able to answer
// ---------------------------------------------------------------------------

/**
 * The six inbound scenarios from the brief, plus the two the bot must handle
 * without a model under any circumstances: a pricing refusal and a catch-all.
 *
 * STATIC serves these with no provider call, so if one has no canned answer the
 * bot has a hole exactly when it has no budget left to paper over it. That is a
 * build failure, not a warning.
 */
const REQUIRED_FAQ_SCENARIOS = [
  'services',
  'industries',
  'booking',
  'portal',
  'maturity-index',
  'llm-security',
  'pricing',
  'fallback',
] as const

export type FaqScenario = (typeof REQUIRED_FAQ_SCENARIOS)[number]

export interface FaqEntry {
  scenario: FaqScenario
  keywords: string[]
  answer: string
  /** Which kb file it came from, so a wrong static answer is traceable. */
  source: string
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface CompileOptions {
  /**
   * Lowest verification tier allowed into the compiled KB. Facts below it are
   * dropped -- the bot loses a fact rather than gaining a guess.
   */
  minVerification: Verification
}

export interface CompileResult {
  kb: string
  faq: FaqEntry[]
  /**
   * Every URL any Sources block cites. This is the same list the output-side
   * filter uses to strip invented links from a model response, so the thing the
   * bot is allowed to say and the thing it is allowed to emit cannot drift.
   */
  urlAllowlist: string[]
  /** Every email address the KB asserts. Same purpose, same drift guarantee. */
  emailAllowlist: string[]
  errors: string[]
  /** Facts dropped for being below `minVerification`, by file. */
  dropped: Record<string, number>
  /** Surviving facts by tier, so the caller can report what it is about to ship. */
  kept: Record<Verification, number>
}

const URL_RE = /https?:\/\/[^\s)<>\]"'`,]+/g
/**
 * Email addresses asserted in the KB.
 *
 * They need the same treatment as URLs: the bot may give one Cadre publishes and
 * must never invent a plausible-looking one. Collected here so the output filter
 * and the content the bot may cite come from the same list.
 */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const VERIFICATION_TAG_RE = /`?\[V:(\w+)\]`?/g
const SOURCES_LINE_RE = /^Sources?:/
const KEYWORDS_LINE_RE = /^Keywords:\s*(.+)$/
const SCENARIO_LINE_RE = /^Scenario:\s*([a-z-]+)\s*$/

/** Strip the markdown emphasis and sentence punctuation that sticks to a URL. */
function normalizeUrl(raw: string): string {
  // Strip until stable: markdown and punctuation interleave, so `contact**.`
  // needs two passes in the other order than `contact.**` does.
  let url = raw
  for (;;) {
    const next = url.replace(/(\*\*|__|\*|_|`|[.,;:!?)\]])+$/, '')
    if (next === url) break
    url = next
  }
  return url.replace(/\/$/, '').toLowerCase()
}

/**
 * A "fact bullet" is a list item carrying a verification tag, possibly spanning
 * continuation lines. Returns the index just past the bullet.
 */
function bulletEnd(lines: string[], start: number): number {
  let i = start + 1
  while (i < lines.length) {
    const line = lines[i] ?? ''
    // A new bullet, a heading, or a blank line ends the current bullet.
    if (line.trim() === '' || /^\s*[-*]\s/.test(line) || /^#{1,6}\s/.test(line)) break
    i++
  }
  return i
}

/**
 * The verification tag that *applies* to a block, or null if it carries none.
 *
 * The tag must END A LINE. `kb/README.md` documents it as appended to the claim
 * it verifies, and the distinction matters: a bullet that
 * merely *mentions* `[V:live]` while explaining the convention is prose, not a
 * verified fact. Treating a mid-sentence mention as a tag would let an
 * unverified claim survive a gate it should not survive.
 */
function trailingTag(block: string): string | null {
  // End of any LINE in the block, not end of the block: a bullet's tag is often
  // followed by an inline `Source page:` citation line.
  const m = /\[V:(\w+)\]`?[ \t]*$/m.exec(block.trimEnd())
  return m?.[1] ?? null
}

interface ParsedFile {
  name: string
  body: string
  faq: FaqEntry[]
  errors: string[]
  dropped: number
  kept: Record<Verification, number>
}

function parseFile(
  name: string,
  raw: string,
  opts: CompileOptions,
  citedUrls: ReadonlySet<string>,
): ParsedFile {
  const errors: string[] = []
  const kept: Record<Verification, number> = { snippet: 0, brief: 0, live: 0 }
  let dropped = 0

  const allLines = raw.split('\n')

  // --- split off the Sources block -----------------------------------------
  const sourcesIdx = allLines.findIndex((l) => SOURCES_LINE_RE.test(l))
  // The Sources block is provenance for reviewers; it never reaches the model.
  // Its URLs were already collected repo-wide by the caller.
  const bodyLines = sourcesIdx === -1 ? allLines : allLines.slice(0, sourcesIdx)
  const bodyText = bodyLines.join('\n')
  const hasFactBullets = /\[V:\w+\]/.test(bodyText)

  // UC1.2 / AC1.1 -- a file that asserts facts must cite where they came from.
  if (hasFactBullets && sourcesIdx === -1) {
    errors.push(`${name}: asserts facts but has no "Sources:" block`)
  }

  // --- invented-URL guard ---------------------------------------------------
  // The project's #1 known failure mode is a plausible cadreai.com URL that was
  // reasoned into existence. Per kb/README.md rule 5 the allow-list is repo-wide:
  // a URL may appear anywhere in the KB only if some file's Sources block cites
  // it. So an invented link cannot reach the prompt at all, while the verified
  // contact URL can be referenced by every file that needs it without each one
  // re-citing the same page.
  for (const rawUrl of bodyText.match(URL_RE) ?? []) {
    const url = normalizeUrl(rawUrl)
    if (!citedUrls.has(url)) {
      errors.push(`${name}: asserts URL ${rawUrl}, which no Sources block in kb/ cites`)
    }
  }

  // --- walk the body: gate facts, collect FAQ entries ----------------------
  const out: string[] = []
  const faq: FaqEntry[] = []

  let pendingKeywords: string[] | null = null
  let pendingScenario: FaqScenario | null = null

  for (let i = 0; i < bodyLines.length; ) {
    const line = bodyLines[i] ?? ''

    // Compiler metadata lines: consumed here, never shown to the model.
    const kwMatch = KEYWORDS_LINE_RE.exec(line.trim())
    if (kwMatch) {
      pendingKeywords = (kwMatch[1] ?? '')
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
      i++
      continue
    }
    const scMatch = SCENARIO_LINE_RE.exec(line.trim())
    if (scMatch) {
      const s = scMatch[1] ?? ''
      if ((REQUIRED_FAQ_SCENARIOS as readonly string[]).includes(s)) {
        pendingScenario = s as FaqScenario
      } else {
        errors.push(`${name}: unknown Scenario: "${s}"`)
      }
      i++
      continue
    }

    // A blockquote run directly after Scenario:/Keywords: is a canned answer.
    if (/^>\s?/.test(line.trim()) && pendingScenario && pendingKeywords) {
      const quote: string[] = []
      let j = i
      while (j < bodyLines.length && /^>\s?/.test((bodyLines[j] ?? '').trim())) {
        quote.push((bodyLines[j] ?? '').trim().replace(/^>\s?/, ''))
        j++
      }
      faq.push({
        scenario: pendingScenario,
        keywords: pendingKeywords,
        answer: quote.join(' ').replace(/\s+/g, ' ').trim(),
        source: name,
      })
      // The blockquote itself stays in the KB: it shows the model the phrasing
      // we want, and it is already sourced content from this file.
      for (let k = i; k < j; k++) out.push(bodyLines[k] ?? '')
      pendingScenario = null
      pendingKeywords = null
      i = j
      continue
    }

    // A tagged fact bullet: keep or drop as a whole, tags and all.
    if (/^\s*[-*]\s/.test(line)) {
      const end = bulletEnd(bodyLines, i)
      const block = bodyLines.slice(i, end)
      const tag = trailingTag(block.join('\n'))
      if (tag === null) {
        // No trailing tag: policy or guidance, not a sourced fact. Keep it.
        out.push(...block)
        i = end
        continue
      }
      if (!isVerification(tag)) {
        errors.push(`${name}: unknown verification tag [V:${tag}]`)
        i = end
        continue
      }
      if (VERIFICATION_RANK[tag] < VERIFICATION_RANK[opts.minVerification]) {
        dropped++
      } else {
        kept[tag]++
        out.push(...block)
      }
      i = end
      continue
    }

    // A tagged fact on a non-bullet line (e.g. a lead paragraph).
    const lineTag = trailingTag(line)
    if (lineTag !== null) {
      if (!isVerification(lineTag)) {
        errors.push(`${name}: unknown verification tag [V:${lineTag}]`)
      } else if (VERIFICATION_RANK[lineTag] < VERIFICATION_RANK[opts.minVerification]) {
        dropped++
        i++
        continue
      } else {
        kept[lineTag]++
      }
    }

    out.push(line)
    i++
  }

  // Strip verification tags -- they are provenance for reviewers, noise for the model.
  const body = out
    .join('\n')
    .replace(VERIFICATION_TAG_RE, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { name, body, faq, errors, dropped, kept }
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

export function compileKb(
  files: { name: string; raw: string }[],
  opts: CompileOptions,
): CompileResult {
  const errors: string[] = []
  const faq: FaqEntry[] = []
  const dropped: Record<string, number> = {}
  const kept: Record<Verification, number> = { snippet: 0, brief: 0, live: 0 }
  const sections: string[] = []

  // Pass 1: the repo-wide set of cited URLs.
  const citedUrls = new Set<string>()
  for (const f of files) {
    const idx = f.raw.split('\n').findIndex((l) => SOURCES_LINE_RE.test(l))
    if (idx === -1) continue
    const sourcesText = f.raw.split('\n').slice(idx).join('\n')
    for (const u of sourcesText.match(URL_RE) ?? []) citedUrls.add(normalizeUrl(u))
  }

  // Emails are collected from the body rather than from Sources blocks: a
  // Sources block cites pages, and the address is a fact ON one of those pages.
  const emails = new Set<string>()
  for (const f of files) {
    for (const e of f.raw.match(EMAIL_RE) ?? []) emails.add(e.toLowerCase())
  }

  // Pass 2: gate facts, collect FAQ entries, validate every asserted URL.
  for (const f of files) {
    const parsed = parseFile(f.name, f.raw, opts, citedUrls)
    errors.push(...parsed.errors)
    faq.push(...parsed.faq)
    if (parsed.dropped > 0) dropped[f.name] = parsed.dropped
    kept.snippet += parsed.kept.snippet
    kept.brief += parsed.kept.brief
    kept.live += parsed.kept.live
    if (parsed.body) sections.push(parsed.body)
  }

  // TC1.5 -- every scenario the STATIC tier must answer has a canned answer.
  for (const scenario of REQUIRED_FAQ_SCENARIOS) {
    if (!faq.some((e) => e.scenario === scenario)) {
      errors.push(`no STATIC answer for required scenario "${scenario}"`)
    }
  }

  // Two entries claiming the same scenario means one of them is dead code.
  const seen = new Set<string>()
  for (const e of faq) {
    if (seen.has(e.scenario)) {
      errors.push(`duplicate STATIC answer for scenario "${e.scenario}" (${e.source})`)
    }
    seen.add(e.scenario)
  }

  return {
    kb: sections.join('\n\n---\n\n'),
    faq,
    urlAllowlist: [...citedUrls].sort(),
    emailAllowlist: [...emails].sort(),
    errors,
    dropped,
    kept,
  }
}

/**
 * Rough token count: English prose runs about 4 characters per token.
 *
 * Deliberately not a real tokenizer -- this guards a 6,000-token budget ceiling
 * with ~1,000 tokens of headroom, and a dependency plus a WASM download to
 * sharpen an estimate we round anyway is the trade CLAUDE.md tells us not to make.
 * `lib/governor` carries its own copy rather than importing this one, because the
 * governor must stay liftable by copying the folder (ADR-005).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const KB_TOKEN_CEILING = 6000

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function tsHeader(): string {
  return [
    '// GENERATED BY `pnpm kb:compile` FROM kb/*.md -- DO NOT EDIT.',
    '// Edit the markdown in kb/ and re-run the compiler.',
    '',
  ].join('\n')
}

export function main(): number {
  const here = dirname(fileURLToPath(import.meta.url))
  const repoRoot = join(here, '..', '..')
  const kbDir = join(repoRoot, 'kb')

  const minVerification = (process.env.KB_MIN_VERIFICATION ?? 'snippet') as string
  if (!isVerification(minVerification)) {
    console.error(`kb:compile: KB_MIN_VERIFICATION must be snippet|brief|live, got "${minVerification}"`)
    return 1
  }

  const names = readdirSync(kbDir)
    .filter((n) => n.endsWith('.md') && n !== 'README.md')
    .sort()

  const files = names.map((name) => ({ name, raw: readFileSync(join(kbDir, name), 'utf8') }))
  const result = compileKb(files, { minVerification })

  if (result.errors.length > 0) {
    console.error('kb:compile FAILED\n')
    for (const e of result.errors) console.error(`  - ${e}`)
    console.error('\nFix kb/ and re-run. An unsourced fact does not ship.')
    return 1
  }

  const tokens = estimateTokens(result.kb)
  if (tokens > KB_TOKEN_CEILING) {
    console.error(
      `kb:compile FAILED\n\n  compiled KB is ~${tokens} tokens, ceiling is ${KB_TOKEN_CEILING}` +
        ` (docs/model-selection.md §2).\n  Every request pays for this, so trim kb/ rather than raising the ceiling.`,
    )
    return 1
  }

  writeFileSync(
    join(repoRoot, 'lib', 'kb', 'kb.generated.ts'),
    `${tsHeader()}export const COMPILED_KB = ${JSON.stringify(result.kb)}\n\n` +
      `export const COMPILED_KB_TOKENS = ${tokens}\n\n` +
      `/** Every URL kb/ cites. The output filter strips anything not in here. */\n` +
      `export const KB_URL_ALLOWLIST: readonly string[] = ${JSON.stringify(result.urlAllowlist, null, 2)}\n\n` +
      `/** Every email address kb/ asserts. Anything else is stripped. */\n` +
      `export const KB_EMAIL_ALLOWLIST: readonly string[] = ${JSON.stringify(result.emailAllowlist, null, 2)}\n`,
  )

  writeFileSync(
    join(repoRoot, 'lib', 'kb', 'faq.generated.ts'),
    `${tsHeader()}import type { FaqEntry } from './compile'\n\n` +
      `export const FAQ: readonly FaqEntry[] = ${JSON.stringify(result.faq, null, 2)}\n`,
  )

  const unverified = result.kept.snippet
  console.log(
    `kb:compile ok -- ${names.length} files, ~${tokens} tokens, ${result.faq.length} static answers`,
  )
  console.log(
    `  facts kept: ${result.kept.brief} brief, ${result.kept.live} live, ${unverified} snippet`,
  )
  const droppedTotal = Object.values(result.dropped).reduce((a, b) => a + b, 0)
  if (droppedTotal > 0) {
    console.log(`  facts dropped below "${minVerification}": ${droppedTotal}`)
  }
  if (unverified > 0) {
    console.warn(
      `\n  WARNING: ${unverified} facts are [V:snippet] -- sourced to a real page but\n` +
        `  recovered from a search extract, not read off the page. Before a PUBLIC deploy,\n` +
        `  either run /kb-audit --live or build with KB_MIN_VERIFICATION=brief.\n` +
        `  See kb/README.md § Verification status.`,
    )
  }
  return 0
}

// Run only as a CLI, not when imported by a test.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main())
}
