/**
 * POST /api/handoff -- lead capture.
 *
 * The one place this product stores PII, because the user deliberately typed it
 * and asked for it to be passed on. Minimal fields, 30-day retention, no tracking
 * identifiers, and the UI says so before they type.
 *
 * Nothing the user wrote is ever logged (hard rule 5). The telemetry line for a
 * handoff carries a hashed session and an outcome, and has no field that could
 * hold a name, an email or the topic text.
 */

import { SupabaseLedgerStore, hashSession } from '@/lib/governor'
import { governorConfigFromEnv, supabaseConfigFromEnv } from '@/lib/chat/governor-config'
import { validateLead, confirmationCopy, makeReference } from '@/lib/chat/lead'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Spec: 3 submissions per session per hour. */
const SUBMISSIONS_PER_HOUR = 3
const HOUR_SECONDS = 3600

export async function POST(request: Request): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ ok: false, message: 'That form could not be read. Try again.' }, { status: 400 })
  }

  const validated = validateLead(payload)
  if (!validated.ok) {
    return Response.json(
      { ok: false, message: validated.message, ...(validated.field ? { field: validated.field } : {}) },
      { status: 400 },
    )
  }

  const lead = validated.value
  const cfg = governorConfigFromEnv()
  const supabase = supabaseConfigFromEnv()

  // No store means the lead cannot be persisted. Saying "passed along" would be
  // the exact dishonesty this feature exists to avoid, so say what is true and
  // give the contact page, which always works.
  if (supabase === null) {
    return Response.json(
      {
        ok: false,
        message:
          "I can't store your details right now. You can reach the team directly at https://www.cadreai.com/contact.",
      },
      { status: 503 },
    )
  }

  const store = new SupabaseLedgerStore(supabase)
  const sessionHash = hashSession(lead.sessionId, cfg.telemetrySalt)
  const rateKey = `${cfg.namespace}:rl:handoff:${sessionHash}`

  let submissions: number
  try {
    submissions = await store.expiringIncr(rateKey, HOUR_SECONDS)
  } catch {
    // Fail closed, consistent with the governor: if we cannot count submissions
    // we do not accept an unbounded number of them.
    return Response.json(
      {
        ok: false,
        message:
          "I can't store your details right now. You can reach the team directly at https://www.cadreai.com/contact.",
      },
      { status: 503 },
    )
  }

  if (submissions > SUBMISSIONS_PER_HOUR) {
    return Response.json(
      {
        ok: false,
        message:
          "You've already sent your details a few times — they're with the team. You can also reach them at https://www.cadreai.com/contact.",
      },
      { status: 429 },
    )
  }

  const reference = makeReference(cfg.now())

  const response = await fetch(`${supabase.url}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      apikey: supabase.serviceRoleKey,
      Authorization: `Bearer ${supabase.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      id: reference,
      name: lead.name ?? null,
      email: lead.email ?? null,
      company: lead.company ?? null,
      topic: lead.topic,
      urgency: lead.urgency,
    }),
  }).catch(() => null)

  if (response === null || !response.ok) {
    return Response.json(
      {
        ok: false,
        message:
          "I couldn't store your details just now. You can reach the team directly at https://www.cadreai.com/contact.",
      },
      { status: 503 },
    )
  }

  // Telemetry: an outcome and a hashed session. No name, email, company or topic.
  console.log(
    JSON.stringify({
      event: 'handoff_submitted',
      sessionHash,
      urgency: lead.urgency,
      hasEmail: lead.email !== undefined,
      namespace: cfg.namespace,
      at: cfg.now().toISOString(),
    }),
  )

  return Response.json({ ok: true, reference, message: confirmationCopy(reference) })
}
