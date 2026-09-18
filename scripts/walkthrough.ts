/**
 * A scripted conversation, run against the deployment as one visitor.
 *
 * The eval checks 37 questions in isolation. That is not what using the thing
 * feels like, and it is why a conversation that dead-ends at turn one passed 35 of
 * 37 cases. This walks one prospect through a real multi-turn exchange, carries the
 * history forward the way the browser does, and prints what a person would see --
 * including whether the lead form would appear under each answer.
 *
 * Charged to the eval ledger (EVAL_TOKEN), not the visitor's budget.
 */

import { shouldEscalate } from '../lib/chat/protocol'
import { followUpsFor, invitesReply } from '../lib/chat/followups'

const TURNS = [
  'What is the AI Maturity Index?',
  'What are the pillars?',
  'Do you work with private equity firms?',
  'How does Cadre pick which LLM to use?',
  'How much would something like this cost?',
]

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

async function ask(target: string, message: string, history: Turn[]): Promise<string> {
  const token = process.env.EVAL_TOKEN?.trim()
  const res = await fetch(new URL('/api/chat', target), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token === undefined || token === '' ? {} : { 'x-eval-token': token }),
    },
    body: JSON.stringify({ sessionId: 'walkthrough', message, history }),
  })
  const text = await res.text()
  let answer = ''
  for (const frame of text.split('\n\n')) {
    let event = ''
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (data.length === 0) continue
    try {
      const parsed: unknown = JSON.parse(data.join('\n'))
      if (typeof parsed !== 'object' || parsed === null) continue
      const record = parsed as Record<string, unknown>
      if (event === 'token' && typeof record.t === 'string') answer += record.t
    } catch {
      continue
    }
  }
  return answer
}

async function main(): Promise<number> {
  const target = process.argv[2]
  if (target === undefined) {
    console.error('usage: tsx scripts/walkthrough.ts <deployed-url>')
    return 1
  }

  const history: Turn[] = []
  let formShownOnAnswerable = 0
  let deadEnds = 0

  for (const [i, message] of TURNS.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 8000))
    const answer = await ask(target, message, [...history])
    history.push({ role: 'user', content: message }, { role: 'assistant', content: answer })

    const form = shouldEscalate(answer)
    const asked = history.filter((t) => t.role === 'user').map((t) => t.content)
    const chips = form ? [] : followUpsFor(message, answer, asked)
    const botAsked = invitesReply(answer)

    // Only the last turn (pricing) is a question the bot genuinely cannot answer.
    const answerable = i < TURNS.length - 1
    if (form && answerable) formShownOnAnswerable += 1

    // A turn is a dead end when there is nothing to do next: no chip to click, no
    // question from the bot to answer, and no offer on the table.
    const wayForward = chips.length > 0 || botAsked || form
    if (!wayForward) deadEnds += 1

    console.log(`\n── turn ${i + 1} ──`)
    console.log(`you:  ${message}`)
    console.log(`bot:  ${answer.trim()}`)
    if (chips.length > 0) console.log(`      [chips] ${chips.map((c) => c.label).join('  ·  ')}`)
    if (botAsked) console.log('      [the bot asked something -- no chips, so the visitor just answers]')
    if (form) console.log('      [button: Pass my details to the team]')
    if (!wayForward) console.log('      *** DEAD END: nothing to click, nothing asked, no offer ***')
  }

  console.log(`\n${formShownOnAnswerable} of ${TURNS.length - 1} answerable turns ended in a lead form.`)
  console.log(`${deadEnds} of ${TURNS.length} turns were dead ends.`)
  return formShownOnAnswerable === 0 && deadEnds === 0 ? 0 : 1
}

main().then((code) => process.exit(code))
