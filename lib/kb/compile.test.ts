import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { compileKb, estimateTokens, type CompileOptions } from './compile'

/**
 * The compiler is a build gate, so most of these tests are about what it REFUSES.
 * A compiler that only proves it can concatenate markdown proves nothing worth
 * having: the property we need is that an unsourced fact or an invented URL
 * cannot reach the prompt.
 */

const FULL: CompileOptions = { minVerification: 'snippet' }
const BRIEF_ONLY: CompileOptions = { minVerification: 'brief' }

/** A minimal well-formed KB, so each test can bend exactly one thing. */
function validFiles(): { name: string; raw: string }[] {
  return [
    {
      name: '01-test.md',
      raw: [
        '# Test',
        '- A sourced fact. `[V:snippet]`',
        '- A fact from the brief. `[V:brief]`',
        '',
        '## What the bot says',
        'Scenario: services',
        'Keywords: services, what do you do',
        '',
        '> We do the thing. https://www.example.com/contact',
        '',
        'Sources:',
        '- https://www.example.com/contact (extract, 2026-09-16)',
      ].join('\n'),
    },
    ...(
      ['industries', 'booking', 'portal', 'maturity-index', 'llm-security', 'pricing', 'fallback'] as const
    ).map((scenario, i) => ({
      name: `0${i + 2}-${scenario}.md`,
      raw: [
        `# ${scenario}`,
        '## What the bot says',
        `Scenario: ${scenario}`,
        `Keywords: ${scenario}`,
        '',
        `> Canned answer for ${scenario}.`,
        '',
        'Sources: derived from the brief.',
      ].join('\n'),
    })),
  ]
}

describe('AC1.1 / UC1.2 — an unsourced fact fails the build', () => {
  it('rejects a file that asserts facts with no Sources block, and names it', () => {
    const files = validFiles()
    files[0] = { name: '01-test.md', raw: '# Test\n- An unsourced fact. `[V:snippet]`\n' }
    const result = compileKb(files, FULL)
    expect(result.errors.join('\n')).toContain('01-test.md')
    expect(result.errors.join('\n')).toMatch(/no "Sources:" block/)
  })

  it('TC1.4 — removing the Sources block from a real kb file fails the build', () => {
    const files = realKbFiles()
    const target = files.find((f) => f.name === '01-company.md')
    expect(target).toBeTruthy()
    if (target) target.raw = target.raw.slice(0, target.raw.indexOf('\nSources:'))
    expect(compileKb(files, FULL).errors.join('\n')).toContain('01-company.md')
  })

  it('accepts a policy-only file that carries no facts and no Sources block', () => {
    // 09-boundaries.md is synthesised guidance, not Cadre facts. Requiring a
    // source for a rule we wrote ourselves would fail the build on a file that
    // is working exactly as intended.
    const files = validFiles()
    files.push({ name: '99-policy.md', raw: '# Policy\n- The bot never quotes a price.\n' })
    expect(compileKb(files, FULL).errors).toEqual([])
  })
})

describe('the invented-URL guard', () => {
  it('rejects a URL that no Sources block in kb/ cites', () => {
    const files = validFiles()
    const first = files[0]
    if (first) first.raw = first.raw.replace('# Test', '# Test\nLog in at https://portal.example.com/login.')
    const errors = compileKb(files, FULL).errors.join('\n')
    expect(errors).toContain('portal.example.com')
    expect(errors).toMatch(/no Sources block in kb\/ cites/)
  })

  it('allows a URL cited by a DIFFERENT file, since the allow-list is repo-wide', () => {
    const files = validFiles()
    const second = files[1]
    if (second) second.raw = second.raw.replace('# industries', '# industries\nSee https://www.example.com/contact.')
    expect(compileKb(files, FULL).errors).toEqual([])
  })

  it('exports the allow-list the output filter needs', () => {
    expect(compileKb(validFiles(), FULL).urlAllowlist).toContain('https://www.example.com/contact')
  })

  it('is not fooled by markdown emphasis or sentence punctuation around a URL', () => {
    const files = validFiles()
    const first = files[0]
    if (first) first.raw = first.raw.replace('# Test', '# Test\nGo to **https://www.example.com/contact**.')
    expect(compileKb(files, FULL).errors).toEqual([])
  })
})

describe('verification gating', () => {
  it('keeps every tier by default', () => {
    const r = compileKb(validFiles(), FULL)
    expect(r.kept.snippet).toBe(1)
    expect(r.kept.brief).toBe(1)
  })

  it('drops unverified facts when the build asks for brief-or-better', () => {
    const r = compileKb(validFiles(), BRIEF_ONLY)
    expect(r.kept.snippet).toBe(0)
    expect(r.kept.brief).toBe(1)
    expect(r.kb).not.toContain('A sourced fact')
    expect(r.kb).toContain('A fact from the brief')
  })

  it('treats a tag mentioned mid-sentence as prose, not as verification', () => {
    // kb/04 explains the tagging convention in a sentence containing [V:live].
    // Reading that as a tag would let an unverified claim survive a gate that
    // should have dropped it.
    const files = validFiles()
    files.push({
      name: '98-prose.md',
      raw: '# Prose\n- Until someone confirms it with `[V:live]`, we do not say it.\n',
    })
    const r = compileKb(files, BRIEF_ONLY)
    expect(r.kept.live).toBe(0)
    expect(r.kb).toContain('we do not say it') // kept as policy, not gated as a fact
  })

  it('keeps a tag that is followed by an inline Source page line', () => {
    const files = validFiles()
    files.push({
      name: '97-inline.md',
      raw: [
        '# Inline',
        '- A fact. `[V:snippet]`',
        '  Source page: https://www.example.com/contact',
        '',
        'Sources:',
        '- https://www.example.com/contact (extract, 2026-09-16)',
      ].join('\n'),
    })
    expect(compileKb(files, FULL).kept.snippet).toBe(2)
  })
})

describe('TC1.5 — the STATIC tier can answer every required scenario', () => {
  it('fails the build when a scenario has no canned answer', () => {
    const files = validFiles().filter((f) => !f.name.includes('portal'))
    expect(compileKb(files, FULL).errors.join('\n')).toContain('"portal"')
  })

  it('fails the build on two answers claiming the same scenario', () => {
    const files = validFiles()
    files.push({
      name: '96-dupe.md',
      raw: '# Dupe\n## What the bot says\nScenario: portal\nKeywords: portal\n\n> Another one.\n',
    })
    expect(compileKb(files, FULL).errors.join('\n')).toMatch(/duplicate STATIC answer/)
  })

  it('strips compiler metadata lines from what the model sees', () => {
    const kb = compileKb(validFiles(), FULL).kb
    expect(kb).not.toContain('Scenario:')
    expect(kb).not.toContain('Keywords:')
    expect(kb).not.toContain('Sources:')
    expect(kb).not.toMatch(/\[V:\w+\]/)
  })
})

// ---------------------------------------------------------------------------
// The real knowledge base
// ---------------------------------------------------------------------------

function realKbFiles(): { name: string; raw: string }[] {
  const kbDir = join(import.meta.dirname, '..', '..', 'kb')
  return readdirSync(kbDir)
    .filter((n) => n.endsWith('.md') && n !== 'README.md')
    .sort()
    .map((name) => ({ name, raw: readFileSync(join(kbDir, name), 'utf8') }))
}

describe('the committed generated files match kb/', () => {
  // kb.generated.ts is committed so a clean checkout typechecks without a build
  // step. That only stays honest if it cannot drift from its source: edit a kb/
  // file without re-running the compiler and this test says so.
  it('kb.generated.ts is what the compiler produces today', async () => {
    const { COMPILED_KB, KB_URL_ALLOWLIST } = await import('./kb.generated')
    const fresh = compileKb(realKbFiles(), FULL)
    expect(COMPILED_KB, 'run `pnpm kb:compile`').toBe(fresh.kb)
    expect([...KB_URL_ALLOWLIST]).toEqual(fresh.urlAllowlist)
  })

  it('faq.generated.ts is what the compiler produces today', async () => {
    const { FAQ } = await import('./faq.generated')
    expect(FAQ, 'run `pnpm kb:compile`').toEqual(compileKb(realKbFiles(), FULL).faq)
  })
})

describe('the real knowledge base compiles clean', () => {
  const result = compileKb(realKbFiles(), FULL)

  it('has no errors', () => {
    expect(result.errors).toEqual([])
  })

  it('AC1.4 — stays under the 6,000-token budget ceiling', () => {
    expect(estimateTokens(result.kb)).toBeLessThanOrEqual(6000)
  })

  it('answers all eight required scenarios statically', () => {
    expect(result.faq).toHaveLength(8)
    for (const entry of result.faq) {
      expect(entry.answer.length).toBeGreaterThan(40)
      expect(entry.keywords.length).toBeGreaterThan(0)
    }
  })

  it('never emits a URL outside the allow-list', () => {
    const urls = result.kb.match(/https?:\/\/[^\s)<>\]"'`,]+/g) ?? []
    for (const raw of urls) {
      const url = raw.replace(/(\*\*|__|\*|_|`)+$/, '').replace(/[.,;:!?]+$/, '').replace(/\/$/, '').toLowerCase()
      expect(result.urlAllowlist, `${raw} is not cited anywhere in kb/`).toContain(url)
    }
  })

  it('contains no invented portal or booking URL in linkable form', () => {
    // CLAUDE.md names portal.cadreai.com, /login, app.cadreai.com and scheduler
    // links as previously fabricated. The KB deliberately NAMES them as
    // inventions -- that is the instruction that stops the model producing one --
    // so the property to hold is that none appears as a followable link.
    for (const invented of ['portal.cadreai.com', 'app.cadreai.com', 'cadreai.com/login', 'calendly.com']) {
      expect(result.kb, `${invented} must never appear as a link`).not.toContain(`https://${invented}`)
      expect(result.kb).not.toContain(`http://${invented}`)
      expect(result.kb).not.toContain(`www.${invented}`)
    }
  })

  it('explicitly tells the model that the portal URLs are inventions', () => {
    // The bare hostnames are in the KB on purpose. Removing them would remove the
    // warning; the output-side filter is what stops them being emitted.
    expect(result.kb).toMatch(/portal\.cadreai\.com/)
    expect(result.kb).toMatch(/are all inventions|are inventions/)
  })

  it('names all eight AI Maturity Index pillars, because all eight are published', () => {
    // This test used to assert FOUR and require the KB to say the list was
    // partial. A live read of cadreai.com/strategy on 2026-09-16 found the full
    // list, so refusing to give it was under-answering rather than caution.
    const pillars = [
      'dedicated AI team',
      'AI Command Center',
      'AI-First Culture Shift',
      'Connect & Enable your Tech Stack',
      'AI-Healthy Data Assessment',
      'AI Agent Readiness',
      'Departmental AI Deep Dives',
      '3-Year AI Vision',
    ]
    for (const p of pillars) expect(result.kb, `missing pillar: ${p}`).toContain(p)
  })

  it('no longer claims a numeric Maturity Index scale', () => {
    // "1-to-100" was in the KB and is on no Cadre page. Cadre publishes "a grade
    // in each area" and nothing numeric.
    expect(result.kb).not.toMatch(/\b1\s*[-–]?\s*(to)?\s*[-–]?\s*100\b/i)
  })

  it('no longer claims a count of companies served', () => {
    expect(result.kb).not.toMatch(/200\+?\s*(companies|businesses)/i)
  })

  it('carries the published contact details', () => {
    expect(result.kb).toContain('hello@gocadre.ai')
    expect(result.kb).toContain('619')
  })

  it('carries a brief-verified construction fact but no unsourced construction detail', () => {
    expect(result.kb).toMatch(/construction/i)
    expect(result.kb).not.toMatch(/takeoff report|material quantities|days to hours/i)
  })

  it('has nothing left for the verification gate to drop', () => {
    // After the live audit there are no [V:snippet] facts, so a brief-or-better
    // build is byte-identical to the default one. That is the gate having done
    // its job, not the gate being broken -- the mechanism stays in place for the
    // next fact someone adds from a search extract.
    const brief = compileKb(realKbFiles(), BRIEF_ONLY)
    expect(brief.errors).toEqual([])
    expect(brief.kept.snippet).toBe(0)
    expect(result.kept.snippet).toBe(0)
    expect(brief.kb).toBe(result.kb)
    expect(brief.faq).toHaveLength(8)
    expect(brief.kb).toContain('https://www.cadreai.com/contact')
  })

  it('still drops an unverified fact if one is added', () => {
    // The gate is only meaningful if it demonstrably still bites.
    const files = realKbFiles()
    files.push({
      name: '90-new.md',
      raw: '# New\n- Something from a search extract. `[V:snippet]`\n\nSources:\n- from the brief.\n',
    })
    expect(compileKb(files, FULL).kept.snippet).toBe(1)
    expect(compileKb(files, BRIEF_ONLY).kept.snippet).toBe(0)
    expect(compileKb(files, BRIEF_ONLY).kb).not.toContain('Something from a search extract')
  })
})
