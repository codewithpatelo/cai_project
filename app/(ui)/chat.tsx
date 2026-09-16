'use client'

import { useEffect, useRef, useState } from 'react'
import { useChat, type Tier } from './use-chat'
import { SUGGESTIONS } from '@/lib/chat/suggestions'
import { HandoffForm } from './handoff-form'
import { ThemeToggle } from './theme-toggle'
import { getSessionId } from './use-chat'

/**
 * The chat surface. Built to docs/mock/Empty.dc.html and Main.dc.html.
 *
 * Every colour is a var(--*) from globals.css. No literal hex reaches this file --
 * the mocks carry hexes because their canvas format requires it, not because that
 * is the design.
 */

const TIER_LABEL: Record<Tier, string> = {
  // Plain language, never a number. A prospect does not need to know we are
  // economising on tokens (docs/design-system.md § Components).
  PRIMARY: 'Live model',
  ECONOMY: 'Economy mode',
  STATIC: 'Saved answers',
}

const TIER_COLOR: Record<Tier, string> = {
  PRIMARY: 'var(--accent)',
  ECONOMY: 'var(--warn)',
  STATIC: 'var(--neutral)',
}


const COMPOSER_CAPTION =
  "Answers come from Cadre's public information. For pricing, account access or anything specific to you, this assistant hands off to the team."

export function Chat() {
  const { state, send } = useChat()
  const [draft, setDraft] = useState('')
  const transcriptEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'end' })
  }, [state.turns])

  const submit = (text: string) => {
    if (state.streaming) return
    setDraft('')
    void send(text)
  }

  const empty = state.turns.length === 0

  return (
    <div className="app">
      {/*
        Mounted at the root and never unmounted. A live region created at the
        moment content arrives announces nothing.
      */}
      <div aria-live="polite" aria-atomic="false" className="sr-only">
        {state.announcement}
      </div>

      <Header tier={state.tier} simulated={state.simulated} />

      <main className="gutter" style={{ flex: 1, paddingTop: '24px' }}>
        {empty ? (
          <EmptyState onPick={submit} disabled={state.streaming} />
        ) : (
          <ol className="transcript">
            {state.turns.map((turn, i) => (
              <Bubble
                key={i}
                role={turn.role}
                content={turn.content}
                streaming={state.streaming && i === state.turns.length - 1}
              />
            ))}
            {/* Inline in the transcript, never a modal: the offer is part of the
                answer, not an interruption of it. */}
            {state.escalated && !state.streaming ? (
              <li>
                <HandoffForm sessionId={getSessionId()} topic={lastUserMessage(state.turns)} />
              </li>
            ) : null}
          </ol>
        )}
        <div ref={transcriptEnd} />
      </main>

      <Composer
        draft={draft}
        onDraft={setDraft}
        onSubmit={submit}
        disabled={state.streaming}
      />
    </div>
  )
}

/** What the user was asking when the bot escalated, so the team has context. */
function lastUserMessage(turns: { role: string; content: string }[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn?.role === 'user') return turn.content
  }
  return ''
}

function Header({ tier, simulated }: { tier: Tier; simulated: boolean }) {
  return (
    <header
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--raised)',
        padding: '12px 16px',
      }}
    >
      <div className="gutter" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: 0 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '19px' }}>
          Cadre AI
        </span>
        <span style={{ color: 'var(--ink-subtle)', fontSize: '13px' }}>Support assistant</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
          {simulated ? <Pill label="Simulated" color="var(--warn)" background="var(--warn-soft)" /> : null}
          <Pill label={TIER_LABEL[tier]} color={TIER_COLOR[tier]} background="var(--neutral-soft)" dot />
          <ThemeToggle />
        </span>
      </div>
    </header>
  )
}

function Pill({
  label,
  color,
  background,
  dot = false,
}: {
  label: string
  color: string
  background: string
  dot?: boolean
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        borderRadius: 'var(--radius-pill)',
        background,
        color: 'var(--ink-muted)',
        fontSize: '12px',
        padding: '4px 10px',
        whiteSpace: 'nowrap',
      }}
    >
      {/* Never colour alone: the dot is decoration, the label carries the meaning. */}
      {dot ? (
        <span
          aria-hidden="true"
          style={{ width: '6px', height: '6px', borderRadius: '50%', background: color }}
        />
      ) : null}
      {label}
    </span>
  )
}

function EmptyState({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', margin: '8px 0 6px' }}>
        How can I help?
      </h1>
      <p style={{ color: 'var(--ink-muted)', margin: '0 0 18px', maxWidth: '640px' }}>
        I answer questions about Cadre AI&apos;s services, industries and how to get started. When I
        don&apos;t have a verified answer, I&apos;ll say so and put you in touch with the team.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {SUGGESTIONS.map((q) => (
          <li key={q}>
            <button
              type="button"
              onClick={() => onPick(q)}
              disabled={disabled}
              style={{
                minHeight: '44px',
                padding: '10px 14px',
                borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--border)',
                background: 'var(--raised)',
                color: 'var(--ink)',
                font: 'inherit',
                fontSize: '14px',
                cursor: disabled ? 'default' : 'pointer',
              }}
            >
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Turn bare URLs into links. Nothing else is parsed -- no markdown rendering. */
function linkify(text: string): (string | { href: string })[] {
  const parts: (string | { href: string })[] = []
  const re = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?]/g
  let last = 0
  for (const match of text.matchAll(re)) {
    const at = match.index
    if (at > last) parts.push(text.slice(last, at))
    parts.push({ href: match[0] })
    last = at + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function Bubble({
  role,
  content,
  streaming,
}: {
  role: 'user' | 'assistant'
  content: string
  streaming: boolean
}) {
  const isUser = role === 'user'
  return (
    <li style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-bot'}`}>
        <span className="sr-only">{isUser ? 'You said: ' : 'Assistant said: '}</span>
        {linkify(content).map((part, i) =>
          typeof part === 'string' ? (
            <span key={i}>{part}</span>
          ) : (
            <a key={i} href={part.href} rel="noopener noreferrer" target="_blank">
              {part.href}
            </a>
          ),
        )}
        {streaming ? (
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: '2px',
              height: '17px',
              background: 'var(--accent)',
              marginLeft: '2px',
              verticalAlign: 'text-bottom',
            }}
          />
        ) : null}
      </div>
    </li>
  )
}

function Composer({
  draft,
  onDraft,
  onSubmit,
  disabled,
}: {
  draft: string
  onDraft: (v: string) => void
  onSubmit: (v: string) => void
  disabled: boolean
}) {
  return (
    <div className="composer-bar">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(draft)
        }}
        className="gutter"
        style={{ paddingLeft: 0, paddingRight: 0 }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <label htmlFor="composer" className="sr-only">
            Your message
          </label>
          <input
            id="composer"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder="Your message"
            maxLength={2000}
            autoComplete="off"
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: '48px',
              padding: '0 12px',
              borderRadius: 'var(--radius-composer)',
              border: '1px solid var(--border)',
              background: 'var(--raised)',
              color: 'var(--ink)',
              font: 'inherit',
            }}
          />
          <button
            type="submit"
            disabled={disabled || draft.trim().length === 0}
            style={{
              minHeight: '48px',
              minWidth: '48px',
              padding: '0 18px',
              borderRadius: 'var(--radius-input)',
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              font: 'inherit',
              fontWeight: 600,
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled || draft.trim().length === 0 ? 0.6 : 1,
            }}
            aria-label="Send message"
          >
            <span className="send-label">Send</span>
            <span aria-hidden="true" className="send-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>
        <p style={{ color: 'var(--ink-subtle)', fontSize: '12px', margin: '8px 0 0' }}>
          {COMPOSER_CAPTION}
        </p>
      </form>
    </div>
  )
}
