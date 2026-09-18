// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HandoffForm } from './handoff-form'

/**
 * The form used to mount open. The bot would ask "want me to pass your details to
 * the team?" and then answer its own question by putting the fields in front of
 * you -- at turn one, under an answer it had given correctly. That is what made
 * every conversation feel finished (ADR-033).
 */
afterEach(cleanup)

describe('the handoff card starts closed', () => {
  it('shows one button and no fields until asked', () => {
    render(<HandoffForm sessionId="s-1" topic="maturity index" />)
    expect(screen.getByRole('button', { name: /pass my details/i })).toBeTruthy()
    expect(screen.queryByLabelText(/name/i)).toBeNull()
    expect(screen.queryByLabelText(/work email/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /send to the team/i })).toBeNull()
  })

  it('opens the fields only when the visitor takes the offer', async () => {
    const user = userEvent.setup()
    render(<HandoffForm sessionId="s-1" topic="maturity index" />)
    await user.click(screen.getByRole('button', { name: /pass my details/i }))
    expect(screen.getByLabelText(/name/i)).toBeTruthy()
    expect(screen.getByLabelText(/work email/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /send to the team/i })).toBeTruthy()
  })

  it('keeps the opener reachable by keyboard at a usable size', () => {
    render(<HandoffForm sessionId="s-1" topic="t" />)
    const button = screen.getByRole('button', { name: /pass my details/i })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.style.minHeight).toBe('44px')
  })
})
