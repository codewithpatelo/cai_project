// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { Chat } from './chat'
import { SUGGESTIONS } from '@/lib/chat/suggestions'

/**
 * Accessibility here is a build constraint, not a final pass, so it is asserted
 * on the rendered output rather than checked by eye once.
 */

afterEach(cleanup)

describe('TC6.2 — the live region exists on first paint', () => {
  it('is in the DOM before any message arrives', () => {
    const { container } = render(<Chat />)
    const region = container.querySelector('[aria-live="polite"]')
    // A live region created at the moment content arrives announces nothing.
    expect(region).toBeTruthy()
    expect(region?.getAttribute('aria-atomic')).toBe('false')
  })

  it('is empty at first, so nothing is announced on load', () => {
    const { container } = render(<Chat />)
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('')
  })
})

describe('TC6.3 — the six suggestions are real buttons', () => {
  it('renders one button per brief scenario', () => {
    render(<Chat />)
    for (const suggestion of SUGGESTIONS) {
      const button = screen.getByRole('button', { name: suggestion })
      // Never role="button" on a div -- Tab skips it.
      expect(button.tagName).toBe('BUTTON')
    }
  })

  it('renders exactly six', () => {
    render(<Chat />)
    const chips = SUGGESTIONS.map((s) => screen.getByRole('button', { name: s }))
    expect(chips).toHaveLength(6)
  })
})

describe('TC6.1 — the tier badge reads plain language and never a figure', () => {
  it('starts on the live-model label', () => {
    render(<Chat />)
    expect(screen.getByText('Live model')).toBeTruthy()
  })

  it('shows no dollar figure anywhere on the page', () => {
    const { container } = render(<Chat />)
    // A prospect does not need to know we are economising on tokens.
    expect(container.textContent).not.toMatch(/\$\s?\d/)
    expect(container.textContent).not.toMatch(/budget|token|quota/i)
  })
})

describe('TC6.5 — the theme toggle names the action, not the state', () => {
  it('labels itself with what pressing it will do', () => {
    render(<Chat />)
    const toggle = screen.getByRole('button', { name: /switch to (light|dark) mode/i })
    expect(toggle.tagName).toBe('BUTTON')
  })

  it('is at least 44px square', () => {
    render(<Chat />)
    const toggle = screen.getByRole('button', { name: /switch to (light|dark) mode/i })
    expect(toggle.style.width).toBe('44px')
    expect(toggle.style.height).toBe('44px')
  })
})

describe('the composer is labelled and usable', () => {
  it('has a real label associated with the input', () => {
    render(<Chat />)
    expect(screen.getByLabelText('Your message')).toBeTruthy()
  })

  it('keeps an accessible name on send even when the word is hidden', () => {
    render(<Chat />)
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy()
  })

  it('caps input at the length the server accepts', () => {
    render(<Chat />)
    const input = screen.getByLabelText('Your message')
    expect(input.getAttribute('maxLength')).toBe('2000')
  })

  it('states the limits before the user types', () => {
    render(<Chat />)
    expect(screen.getByText(/hands off to the team/i)).toBeTruthy()
  })
})

describe('the empty state explains what the bot is for', () => {
  it('says it will hand off when it has no verified answer', () => {
    render(<Chat />)
    const main = screen.getByRole('main')
    expect(within(main).getByText(/put you in touch with the team/i)).toBeTruthy()
  })
})
