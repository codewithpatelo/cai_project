'use client'

import { useId, useState } from 'react'
import type { Urgency } from '@/lib/chat/lead'

/**
 * The handoff card. Built to docs/mock/Escalation.dc.html.
 *
 * Sits INLINE in the transcript, never as a modal: the user asked a question and
 * got an answer, and the offer to pass details on is part of that answer rather
 * than an interruption of it.
 *
 * The copy under the heading is load-bearing. It tells the user what actually
 * happens to their details before they type, which is cheaper than correcting the
 * expectation afterwards.
 */

const URGENCY_OPTIONS: { value: Urgency; label: string }[] = [
  { value: 'general', label: 'General enquiry' },
  { value: 'active_project', label: 'An active project' },
  { value: 'existing_client', label: "I'm an existing client" },
]

type Status =
  | { kind: 'editing'; error?: string; field?: string }
  | { kind: 'sending' }
  | { kind: 'sent'; message: string }
  | { kind: 'dismissed' }

export function HandoffForm({ sessionId, topic }: { sessionId: string; topic: string }) {
  const [status, setStatus] = useState<Status>({ kind: 'editing' })
  const [urgency, setUrgency] = useState<Urgency>('general')
  const ids = useId()

  if (status.kind === 'dismissed') return null

  if (status.kind === 'sent') {
    return (
      <div className="handoff-card" style={cardStyle} role="status">
        <p style={{ margin: 0, color: 'var(--ink)' }}>{status.message}</p>
      </div>
    )
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setStatus({ kind: 'sending' })

    try {
      const response = await fetch('/api/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          name: form.get('name'),
          email: form.get('email'),
          company: form.get('company'),
          topic,
          urgency,
        }),
      })
      const body: unknown = await response.json()
      const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}

      if (response.ok && record.ok === true && typeof record.message === 'string') {
        setStatus({ kind: 'sent', message: record.message })
        return
      }
      setStatus({
        kind: 'editing',
        error:
          typeof record.message === 'string'
            ? record.message
            : "I couldn't send that. You can reach the team at https://www.cadreai.com/contact.",
        ...(typeof record.field === 'string' ? { field: record.field } : {}),
      })
    } catch {
      setStatus({
        kind: 'editing',
        error: "I couldn't send that. You can reach the team at https://www.cadreai.com/contact.",
      })
    }
  }

  const error = status.kind === 'editing' ? status.error : undefined
  const errorId = `${ids}-error`

  return (
    <div className="handoff-card" style={cardStyle}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', margin: '0 0 4px' }}>
        Pass my details to the team
      </h2>
      <p style={{ color: 'var(--ink-subtle)', fontSize: '12px', margin: '0 0 14px' }}>
        Stored for Cadre&apos;s team to pick up. I can&apos;t book a meeting or promise a response time.
      </p>

      <form onSubmit={submit} noValidate>
        <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field id={`${ids}-name`} name="name" label="Name" autoComplete="name" />
          <Field id={`${ids}-email`} name="email" label="Work email" type="email" autoComplete="email" />
          <Field id={`${ids}-company`} name="company" label="Company" autoComplete="organization" />
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: '14px 0 0' }}>
          <legend style={{ fontSize: '13px', color: 'var(--ink-muted)', padding: 0 }}>This is about</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            {URGENCY_OPTIONS.map((option) => (
              <label
                key={option.value}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  minHeight: '44px',
                  padding: '0 12px',
                  borderRadius: 'var(--radius-pill)',
                  border: '1px solid var(--border)',
                  background: urgency === option.value ? 'var(--accent-soft)' : 'var(--raised)',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="urgency"
                  value={option.value}
                  checked={urgency === option.value}
                  onChange={() => setUrgency(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        {error ? (
          // Associated with the form and announced, not just coloured red.
          <p id={errorId} role="alert" style={{ color: 'var(--warn)', fontSize: '13px', margin: '12px 0 0' }}>
            {error}
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={status.kind === 'sending'}
            aria-describedby={error ? errorId : undefined}
            style={{
              minHeight: '44px',
              padding: '0 16px',
              borderRadius: 'var(--radius-input)',
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              font: 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {status.kind === 'sending' ? 'Sending…' : 'Send to the team'}
          </button>
          <button
            type="button"
            onClick={() => setStatus({ kind: 'dismissed' })}
            style={{
              minHeight: '44px',
              padding: '0 16px',
              borderRadius: 'var(--radius-input)',
              border: '1px solid var(--border)',
              background: 'var(--raised)',
              color: 'var(--ink-muted)',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            No thanks
          </button>
        </div>
      </form>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: 'var(--raised)',
  border: '1px solid var(--border)',
  borderLeft: '3px solid var(--accent)',
  borderRadius: 'var(--radius-bubble)',
  padding: '16px',
  margin: '4px 0',
}

function Field({
  id,
  name,
  label,
  type = 'text',
  autoComplete,
}: {
  id: string
  name: string
  label: string
  type?: string
  autoComplete?: string
}) {
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: '13px', color: 'var(--ink-muted)', marginBottom: '4px' }}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        style={{
          width: '100%',
          minHeight: '44px',
          padding: '0 10px',
          borderRadius: 'var(--radius-input)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--ink)',
          font: 'inherit',
        }}
      />
    </div>
  )
}
