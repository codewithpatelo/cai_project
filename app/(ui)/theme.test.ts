import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveTheme, storedTheme, THEME_BOOTSTRAP } from './theme-toggle'

/**
 * TC6.4 / AC6.7 / AC6.8. Theme resolution is pure and tested without a DOM;
 * storage behaviour is tested against a stub that throws, because that is what
 * some privacy modes actually do.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TC6.4 — theme resolution', () => {
  it('follows the OS when nothing is stored', () => {
    expect(resolveTheme(null, 'dark')).toBe('dark')
    expect(resolveTheme(null, 'light')).toBe('light')
  })

  it('lets a stored override beat the OS', () => {
    expect(resolveTheme('light', 'dark')).toBe('light')
    expect(resolveTheme('dark', 'light')).toBe('dark')
  })
})

describe('AC6.8 — storage failure never breaks the page', () => {
  it('falls back to the OS preference when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('access denied')
      },
    })
    expect(storedTheme()).toBeNull()
    expect(resolveTheme(storedTheme(), 'dark')).toBe('dark')
  })

  it('ignores a corrupted stored value rather than trusting it', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'purple' })
    expect(storedTheme()).toBeNull()
  })
})

describe('AC6.7 — no flash of light before the theme applies', () => {
  it('sets the attribute in a script that runs before paint', () => {
    expect(THEME_BOOTSTRAP).toContain('setAttribute')
    expect(THEME_BOOTSTRAP).toContain('data-theme')
  })

  it('cannot throw and take the page down with it', () => {
    // It runs before anything else on the page; an exception here is a blank screen.
    expect(THEME_BOOTSTRAP).toContain('try')
    expect(THEME_BOOTSTRAP).toContain('catch')
  })

  it('only ever writes a known theme value', () => {
    expect(THEME_BOOTSTRAP).toMatch(/t==='light'\|\|t==='dark'/)
  })
})
