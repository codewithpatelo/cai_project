import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Mechanical enforcement of the hard rules in CLAUDE.md.
 *
 * These exist because every one of them is a rule a person can hold in their head
 * on a good day and forget on a bad one. A grep in a test suite does not have bad
 * days. They run on the working tree, not on a build artefact, so they fail before
 * a commit rather than after a deploy.
 */

const repoRoot = join(import.meta.dirname, '..')

/** Files git actually tracks, plus anything new in the working tree. */
function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return out.split('\n').filter(Boolean)
}

function read(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), 'utf8')
}

describe('hard rule 1 — no key material in the repo', () => {
  // The OpenRouter key format, split so this test file is not itself a match.
  const openRouterKey = new RegExp(['sk', 'or', 'v1-'].join('-') + '[A-Za-z0-9]{16,}')
  const serviceRoleJwt = /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\./

  it('has no OpenRouter key literal in any tracked file', () => {
    const offenders = trackedFiles().filter((f) => {
      if (f === 'lib/guardrails.test.ts') return false
      try {
        return openRouterKey.test(read(f))
      } catch {
        return false // binary or unreadable; not a source file we care about
      }
    })
    expect(offenders).toEqual([])
  })

  it('has no Supabase service-role JWT in any tracked file', () => {
    const offenders = trackedFiles().filter((f) => {
      if (f === 'lib/guardrails.test.ts') return false
      try {
        return serviceRoleJwt.test(read(f))
      } catch {
        return false
      }
    })
    expect(offenders).toEqual([])
  })

  it('does not track a .env.local', () => {
    expect(trackedFiles().filter((f) => f.startsWith('.env') && f.endsWith('.local'))).toEqual([])
  })

  it('never exposes a secret through a NEXT_PUBLIC_ name', () => {
    const offenders = trackedFiles()
      .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
      .filter((f) => /NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN|SALT)/.test(read(f)))
    expect(offenders).toEqual([])
  })
})

describe('hard rule 4 — the governor carries no domain knowledge', () => {
  // ADR-005: lib/governor must be liftable into another project by copying the folder.
  const domainWords = /\b(cadre|chatbot|knowledge[ _-]?base|\bkb\b|faq)\b/i

  it('has no domain string anywhere under lib/governor', () => {
    const offenders = trackedFiles()
      .filter((f) => f.startsWith('lib/governor/'))
      .filter((f) => domainWords.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('imports nothing from lib/kb or lib/prompt', () => {
    const offenders = trackedFiles()
      .filter((f) => f.startsWith('lib/governor/'))
      .filter((f) => /from\s+['"][^'"]*(lib\/)?(kb|prompt)\//.test(read(f)))
    expect(offenders).toEqual([])
  })
})

describe('hard rule 5 — no user message text can be logged', () => {
  it('CallUsage has no field that could hold message text', () => {
    const typesPath = 'lib/governor/types.ts'
    if (!existsSync(join(repoRoot, typesPath))) return // not built yet; Phase 3 adds it
    const src = read(typesPath)
    const iface = src.match(/export interface CallUsage \{([\s\S]*?)\n\}/)
    expect(iface, 'CallUsage interface not found').toBeTruthy()
    const body = iface?.[1] ?? ''
    expect(body).not.toMatch(/\b(message|content|text|prompt|transcript|body)\b\s*\??\s*:/i)
  })
})

describe('CLAUDE.md conventions — colours come from custom properties', () => {
  it('no literal hex in app/ outside globals.css', () => {
    const offenders = trackedFiles()
      .filter((f) => f.startsWith('app/') && f !== 'app/globals.css')
      .filter((f) => /#[0-9A-Fa-f]{6}\b/.test(read(f)))
    expect(offenders).toEqual([])
  })
})

describe('hard rule 3 — governor tests may not be skipped', () => {
  it('no .skip or .only in any test file', () => {
    const offenders = trackedFiles()
      .filter((f) => /\.test\.tsx?$/.test(f) && f !== 'lib/guardrails.test.ts')
      .filter((f) => /\b(it|test|describe)\.(skip|only)\b/.test(read(f)))
    expect(offenders).toEqual([])
  })
})
