/**
 * Prompt assembly -- a pure function, the only place a request's messages are built.
 *
 * Three regions, always in this order (docs/system-prompt.md § Assembly contract):
 *   [1] fixed instructions    never varies, never trimmed
 *   [2] <knowledge_base>      compiled from kb/*.md, never trimmed
 *   [3] conversation history  already trimmed by the governor
 *
 * Regions 1 and 2 are one system message so the prefix is byte-identical on every
 * request; that is what the provider's prompt cache keys on. Region 3 is separate
 * user/assistant turns.
 *
 * Nothing here does I/O, reads the clock, or knows a model name. Given the same
 * arguments it returns the same messages, which is what makes it snapshot-testable.
 */

import { FIXED_INSTRUCTIONS, KB_ENVELOPE_OPEN, KB_ENVELOPE_CLOSE } from './instructions'

export type Role = 'system' | 'user' | 'assistant'

export interface Message {
  role: Role
  content: string
}

export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Build the fixed prefix: instructions, then the knowledge base framed as data.
 *
 * Exported separately because the caching property is worth asserting directly:
 * a test compares this across two different conversations and requires byte
 * equality. If someone interpolates a session id in here, that test fails rather
 * than the cache silently missing on every request.
 */
export function buildSystemPrompt(compiledKb: string): string {
  return `${FIXED_INSTRUCTIONS}\n\n${KB_ENVELOPE_OPEN}${compiledKb}${KB_ENVELOPE_CLOSE}`
}

/**
 * Assemble the full message list for one turn.
 *
 * `history` must already be trimmed -- trimming is the governor's job and depends
 * on the tier, which this function deliberately does not know about. Keeping the
 * two apart is what lets the prompt be tested without a budget and the budget
 * without a prompt.
 */
export function assemble(args: {
  compiledKb: string
  history: HistoryTurn[]
  message: string
}): Message[] {
  const { compiledKb, history, message } = args

  return [
    { role: 'system', content: buildSystemPrompt(compiledKb) },
    ...history.map((turn): Message => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: message },
  ]
}
