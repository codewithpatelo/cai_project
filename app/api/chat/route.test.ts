import { describe, it, expect } from 'vitest'
import { POST } from './route'
import { validate, sseFrame, shouldEscalate } from '@/lib/chat/protocol'

/**
 * Validation and SSE framing are tested directly. There is no mocked provider
 * here: the handler's job at this phase is to reject bad input safely and to
 * frame a stream correctly, and both are checkable with zero network.
 */

function body(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ sessionId: 's-1', message: 'What does Cadre AI do?', history: [], ...over })
}

describe('TC2.2 — input validation', () => {
  it('accepts a well-formed request', () => {
    const result = validate(body())
    expect(result.ok).toBe(true)
  })

  it('rejects an empty message with 400 bad_request', () => {
    const result = validate(body({ message: '   ' }))
    expect(result).toMatchObject({ ok: false, status: 400, code: 'bad_request' })
  })

  it('rejects a message over 2,000 characters', () => {
    const result = validate(body({ message: 'a'.repeat(2001) }))
    expect(result).toMatchObject({ ok: false, status: 400, code: 'bad_request' })
  })

  it('accepts a message of exactly 2,000 characters', () => {
    expect(validate(body({ message: 'a'.repeat(2000) })).ok).toBe(true)
  })

  it('rejects a history payload over 32KB with 413', () => {
    const huge = [{ role: 'user', content: 'x'.repeat(40_000) }]
    expect(validate(body({ history: huge }))).toMatchObject({ ok: false, status: 413, code: 'payload_too_large' })
  })

  it('measures the size cap in bytes, not UTF-16 length', () => {
    // 20,000 multi-byte characters is well under 32,768 UTF-16 units but well
    // over 32KB on the wire. Measuring length would let it through at ~3x.
    const multibyte = [{ role: 'user', content: '你'.repeat(20_000) }]
    expect(validate(body({ history: multibyte }))).toMatchObject({ status: 413 })
  })

  it('rejects malformed JSON without leaking a parser message', () => {
    const result = validate('{not json')
    expect(result).toMatchObject({ ok: false, status: 400 })
    if (!result.ok) expect(result.message).not.toMatch(/JSON|token|position|SyntaxError/i)
  })

  it('rejects a missing or empty sessionId', () => {
    expect(validate(body({ sessionId: '' })).ok).toBe(false)
    expect(validate(JSON.stringify({ message: 'hi' })).ok).toBe(false)
  })

  it('trims over-long history rather than rejecting it', () => {
    // The user did nothing wrong by having a long conversation.
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${i}`,
    }))
    const result = validate(body({ history }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.history).toHaveLength(12)
  })

  it('drops malformed history turns instead of failing the request', () => {
    const history = [{ role: 'user', content: 'ok' }, { role: 'system', content: 'nope' }, 'junk', null]
    const result = validate(body({ history }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.history).toEqual([{ role: 'user', content: 'ok' }])
  })

  it('never returns a message containing a stack trace', () => {
    for (const bad of ['{not json', body({ message: '' }), body({ message: 'a'.repeat(2001) })]) {
      const result = validate(bad)
      if (!result.ok) {
        expect(result.message).not.toMatch(/\bat\s+\w+\s+\(/)
        expect(result.message.length).toBeLessThan(200)
      }
    }
  })
})

describe('TC2.3 — SSE framing', () => {
  it('emits a well-formed event frame', () => {
    expect(sseFrame('meta', { tier: 'PRIMARY' })).toBe('event: meta\ndata: {"tier":"PRIMARY"}\n\n')
  })

  it('escapes newlines in token text so one token cannot split a frame', () => {
    const frame = sseFrame('token', { t: 'line one\nline two' })
    expect(frame.split('\n\n')).toHaveLength(2)
    expect(frame).toContain('\\n')
  })
})

describe('the handler rejects bad input over HTTP without streaming', () => {
  async function post(raw: string): Promise<Response> {
    return POST(new Request('http://localhost/api/chat', { method: 'POST', body: raw }))
  }

  it('returns 400 and a JSON code for an oversized message', async () => {
    const res = await post(body({ message: 'a'.repeat(2500) }))
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(await res.json()).toMatchObject({ code: 'bad_request' })
  })

  it('returns 413 for an oversized history', async () => {
    const res = await post(body({ history: [{ role: 'user', content: 'x'.repeat(40_000) }] }))
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ code: 'payload_too_large' })
  })

  it('leaks no stack trace in an error body', async () => {
    const res = await post('{not json')
    const payload = await res.json()
    expect(JSON.stringify(payload)).not.toMatch(/\bat\s+\w+\s+\(|node_modules|\.ts:\d+/)
  })
})

describe('escalation detection', () => {
  it('escalates when the answer offers the contact page', () => {
    expect(shouldEscalate('Pricing is not published. https://www.cadreai.com/contact')).toBe(true)
  })

  it('does not escalate on an ordinary grounded answer', () => {
    expect(shouldEscalate('Cadre AI has four service lines: strategy, leadership, engineering and agents.')).toBe(false)
  })
})
