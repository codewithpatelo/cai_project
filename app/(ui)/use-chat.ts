'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Chat state and the SSE read loop.
 *
 * Split out of the component because the interesting behaviour here -- parsing a
 * stream, never surfacing a raw error, keeping the live region quiet until a
 * message finishes -- is worth reading on its own.
 */

export type Tier = 'PRIMARY' | 'ECONOMY' | 'STATIC'

export interface Turn {
  role: 'user' | 'assistant'
  content: string
  /**
   * Proof the server produced this answer, echoed back on the next request.
   * Without it the server drops the turn rather than letting a forged line
   * speak with the bot's authority (lib/chat/history-integrity.ts).
   */
  sig?: string
}

export interface ChatState {
  turns: Turn[]
  streaming: boolean
  tier: Tier
  simulated: boolean
  escalated: boolean
  /** Announced once, when a message completes. Never per token. */
  announcement: string
}

const SESSION_KEY = 'cadre-chat-session'

/**
 * A session id, kept in sessionStorage so a reload starts a new conversation.
 * No conversation is persisted anywhere (ADR-012); this only groups rate limits.
 */
export function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, fresh)
    return fresh
  } catch {
    // Private modes throw on storage access. A session id is never worth a crash.
    return crypto.randomUUID()
  }
}

/** Parse one SSE frame into an event name and its JSON payload. */
export function parseFrame(frame: string): { event: string; data: unknown } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function useChat() {
  const [state, setState] = useState<ChatState>({
    turns: [],
    streaming: false,
    tier: 'PRIMARY',
    simulated: false,
    escalated: false,
    announcement: '',
  })
  const inFlight = useRef(false)

  const send = useCallback(async (message: string) => {
    const text = message.trim()
    if (text.length === 0 || inFlight.current) return
    inFlight.current = true

    let history: Turn[] = []
    setState((prev) => {
      history = prev.turns
      return {
        ...prev,
        turns: [...prev.turns, { role: 'user', content: text }, { role: 'assistant', content: '' }],
        streaming: true,
        escalated: false,
        announcement: 'Generating an answer.',
      }
    })

    /** Replace the trailing assistant turn as tokens arrive. */
    const appendToAssistant = (chunk: string) => {
      setState((prev) => {
        const turns = [...prev.turns]
        const last = turns[turns.length - 1]
        if (last && last.role === 'assistant') {
          turns[turns.length - 1] = { role: 'assistant', content: last.content + chunk }
        }
        return { ...prev, turns }
      })
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: getSessionId(), message: text, history }),
      })

      if (!response.ok || response.body === null) {
        // A 400/413 carries a human sentence. The user never sees a status code.
        const fallback = await response
          .json()
          .then((b: unknown) => (isRecord(b) && typeof b.message === 'string' ? b.message : null))
          .catch(() => null)
        appendToAssistant(fallback ?? 'Something went wrong on my side. Try again in a moment.')
        setState((prev) => ({ ...prev, streaming: false, announcement: 'Answer complete.' }))
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let split: number
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, split)
          buffer = buffer.slice(split + 2)
          const parsed = parseFrame(frame)
          if (parsed === null) continue

          if (parsed.event === 'meta' && isRecord(parsed.data)) {
            const tier = parsed.data.tier
            setState((prev) => ({
              ...prev,
              tier: tier === 'ECONOMY' || tier === 'STATIC' ? tier : 'PRIMARY',
              simulated: parsed.data && isRecord(parsed.data) ? parsed.data.simulated === true : false,
            }))
          } else if (parsed.event === 'token' && isRecord(parsed.data)) {
            const t = parsed.data.t
            if (typeof t === 'string') appendToAssistant(t)
          } else if (parsed.event === 'done' && isRecord(parsed.data)) {
            const escalate = parsed.data.escalate === true
            // `meta` is emitted before the call so the badge can appear with the
            // first token, which means it states an INTENDED tier. If the call
            // then fell back, `done` carries the tier that actually served the
            // answer -- so the badge follows `done`, or it would read
            // "Live model" over a saved answer.
            const finalTier = parsed.data.tier
            const sig = parsed.data.sig
            setState((prev) => {
              // Attach the signature to the answer it belongs to.
              const turns = [...prev.turns]
              const last = turns[turns.length - 1]
              if (last && last.role === 'assistant' && typeof sig === 'string') {
                turns[turns.length - 1] = { ...last, sig }
              }
              return {
                ...prev,
                turns,
                tier:
                  finalTier === 'ECONOMY' || finalTier === 'STATIC' || finalTier === 'PRIMARY'
                    ? finalTier
                    : prev.tier,
                streaming: false,
                escalated: escalate,
                // The finished message is announced once. Announcing tokens as they
                // arrive floods a screen reader -- docs/design-system.md.
                announcement: turns[turns.length - 1]?.content ?? 'Answer complete.',
              }
            })
          }
        }
      }
    } catch {
      appendToAssistant(
        'I could not reach the assistant just now. You can contact the Cadre team at https://www.cadreai.com/contact.',
      )
      setState((prev) => ({ ...prev, streaming: false, escalated: true, announcement: 'Answer complete.' }))
    } finally {
      inFlight.current = false
      setState((prev) => (prev.streaming ? { ...prev, streaming: false } : prev))
    }
  }, [])

  return { state, send }
}
