import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * AC6.5 / AC6.6. Contrast is computed from the tokens actually in globals.css
 * with the WCAG relative-luminance formula, not copied from the table in
 * docs/design-system.md. If someone lightens a grey, this fails -- which is the
 * only way a written contrast table stays true.
 */

const raw = readFileSync(join(import.meta.dirname, 'globals.css'), 'utf8')

/**
 * Comments stripped before any assertion. A comment saying "never outline:none"
 * otherwise matches a grep for `outline:none` -- the test would fail on the very
 * note explaining the rule it enforces.
 */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

/** Pull a token block: `:root { ... }` or a scoped dark override. */
function tokens(blockPattern: RegExp): Record<string, string> {
  const block = blockPattern.exec(css)?.[1] ?? ''
  const out: Record<string, string> = {}
  for (const match of block.matchAll(/(--[a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
    const [, name, value] = match
    if (name && value) out[name] = value
  }
  return out
}

const light = tokens(/:root\s*\{([\s\S]*?)\}/)
const dark = tokens(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

const PAIRS: [string, string, string][] = [
  ['body on surface', '--ink', '--surface'],
  ['secondary on surface', '--ink-muted', '--surface'],
  ['caption on surface', '--ink-subtle', '--surface'],
  ['link on surface', '--accent', '--surface'],
  ['body on raised', '--ink', '--raised'],
  ['caption on raised', '--ink-subtle', '--raised'],
  ['warn badge', '--warn', '--warn-soft'],
  ['neutral badge', '--neutral', '--neutral-soft'],
  ['user bubble text', '--ink', '--accent-soft'],
]

describe('AC6.5 — contrast is at least 4.5:1 in both themes', () => {
  for (const [label, fg, bg] of PAIRS) {
    it(`light: ${label}`, () => {
      const f = light[fg]
      const b = light[bg]
      expect(f, `missing ${fg}`).toBeTruthy()
      expect(b, `missing ${bg}`).toBeTruthy()
      if (f && b) expect(contrast(f, b)).toBeGreaterThanOrEqual(4.5)
    })

    it(`dark: ${label}`, () => {
      const f = dark[fg] ?? light[fg]
      const b = dark[bg] ?? light[bg]
      if (f && b) expect(contrast(f, b)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('button text on the accent passes in both themes', () => {
    const l = [light['--on-accent'], light['--accent']]
    const d = [dark['--on-accent'] ?? light['--on-accent'], dark['--accent'] ?? light['--accent']]
    if (l[0] && l[1]) expect(contrast(l[0], l[1])).toBeGreaterThanOrEqual(4.5)
    if (d[0] && d[1]) expect(contrast(d[0], d[1])).toBeGreaterThanOrEqual(4.5)
  })
})

describe('the dark theme is a real palette, not the light one inverted', () => {
  it('overrides every colour token the light theme defines', () => {
    for (const name of Object.keys(light)) {
      if (!name.startsWith('--')) continue
      if (['--radius-tail', '--radius-input', '--radius-composer', '--radius-bubble', '--radius-pill'].includes(name)) continue
      expect(dark[name], `dark theme is missing ${name}`).toBeTruthy()
    }
  })

  it('makes the accent LIGHTER in dark mode', () => {
    // A deep green that reads well on paper disappears on charcoal.
    const l = light['--accent']
    const d = dark['--accent']
    if (l && d) expect(luminance(d)).toBeGreaterThan(luminance(l))
  })

  it('keeps the OS override guard so the toggle can win', () => {
    expect(css).toMatch(/:root:not\(\[data-theme="light"\]\)/)
  })
})

describe('AC6.9 / AC6.11 — layout and motion constraints are in the stylesheet', () => {
  it('uses dvh rather than vh for the full-height container', () => {
    // 100vh under the iOS keyboard pushes the composer off-screen.
    expect(css).toContain('100dvh')
    expect(css).not.toMatch(/min-height:\s*100vh/)
  })

  it('prevents horizontal scroll', () => {
    expect(css).toMatch(/overflow-x:\s*hidden/)
  })

  it('lets long URLs wrap instead of widening the page', () => {
    expect(css).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('respects prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })

  it('never removes a focus outline without replacing it', () => {
    expect(css).toMatch(/:focus-visible/)
    expect(css).not.toMatch(/outline:\s*none/)
  })

  it('is mobile-first: no max-width breakpoints', () => {
    expect(css).not.toMatch(/@media[^{]*max-width/)
  })
})

describe('motion is present but disabled under reduced-motion', () => {
  it('animates the bubble entrance and the streaming cursor', () => {
    expect(css).toMatch(/@keyframes bubble-in/)
    expect(css).toMatch(/@keyframes cursor-blink/)
    expect(css).toMatch(/\.stream-cursor[\s\S]*animation: cursor-blink/)
  })

  it('still honours prefers-reduced-motion for both', () => {
    // The blanket reduce block sets animation-duration to ~0 on everything, so a
    // new animation cannot escape it by being added later in the file.
    const reduce = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(reduce).toMatch(/\*,\s*\*::before,\s*\*::after/)
    expect(reduce).toMatch(/animation-duration:\s*0\.01ms\s*!important/)
    expect(reduce).toMatch(/animation-iteration-count:\s*1\s*!important/)
  })

  it('keeps the cursor to the specified 2px accent bar, with no dots or shimmer', () => {
    expect(css).toMatch(/\.stream-cursor[\s\S]*width: 2px[\s\S]*background: var\(--accent\)/)
    expect(css).not.toMatch(/typing-dot|shimmer|skeleton/i)
  })
})
