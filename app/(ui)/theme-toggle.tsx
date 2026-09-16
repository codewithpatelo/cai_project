'use client'

import { useEffect, useState } from 'react'

/**
 * Light/dark toggle (ADR-015). One header button, not a settings page.
 *
 * Three states, one control: follow the OS by default, override by setting
 * data-theme on <html>, and persist the override. Most people never touch it and
 * should still get the right answer, which is why the default is the OS and not
 * "light".
 */

const STORAGE_KEY = 'cadre-theme'

export type Theme = 'light' | 'dark'

/** Read the stored override. Storage throws in some privacy modes. */
export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    // A theme preference is never worth a white screen.
    return null
  }
}

export function systemTheme(): Theme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function resolveTheme(stored: Theme | null, system: Theme): Theme {
  return stored ?? system
}

/**
 * Runs before first paint, inlined in <head>.
 *
 * Without this the page paints light and then switches, and that flash is the
 * only thing users actually notice about theme handling.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    setTheme(resolveTheme(storedTheme(), systemTheme()))
  }, [])

  const next: Theme = theme === 'dark' ? 'light' : 'dark'

  const apply = () => {
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // The theme still applies for this page view; it just will not persist.
    }
  }

  return (
    <button
      type="button"
      onClick={apply}
      // The label states the ACTION, not the current state: a screen reader user
      // needs to know what pressing it does.
      aria-label={`Switch to ${next} mode`}
      style={{
        width: '44px',
        height: '44px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-input)',
        border: '1px solid var(--border)',
        background: 'var(--raised)',
        color: 'var(--ink-muted)',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

/* Inline stroke SVG. No emoji, no icon font (docs/design-system.md). */

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
    </svg>
  )
}
