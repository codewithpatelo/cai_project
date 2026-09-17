/**
 * GET /api/health -- non-secret status.
 *
 * Exists so a misconfigured deployment is visible from outside without opening
 * the Vercel dashboard. `keyProfile` is the one that matters: a preview left on
 * the client's key would drain a $5 budget that cannot be regenerated, and this
 * is how /deploy-check catches it.
 *
 * Nothing here is a secret and nothing here is PII. If a field would need
 * redacting, it does not belong in this response.
 */

import { createGovernor, SupabaseLedgerStore } from '@/lib/governor'
import {
  governorConfigFromEnv,
  keyProfile,
  supabaseConfigFromEnv,
  supabaseKeySource,
} from '@/lib/chat/governor-config'
import { COMPILED_KB_TOKENS } from '@/lib/kb/kb.generated'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const cfg = governorConfigFromEnv()
  const supabase = supabaseConfigFromEnv()

  const base = {
    ok: true,
    keyProfile: keyProfile(),
    ledger: supabase === null ? ('unconfigured' as const) : ('supabase' as const),
    // The variable NAME that supplied the key, never its value. Configuration is
    // the thing that goes wrong here, and it is not a secret.
    ledgerKeySource: supabaseKeySource(),
    modelConfigured: process.env.OPENROUTER_API_KEY ? true : false,
    kbTokens: COMPILED_KB_TOKENS,
  }

  // No store means the governor fails closed to STATIC on every request. That is
  // correct behaviour, not an outage, so `ok` stays true -- but it is reported,
  // because a deployment serving only canned answers should be obvious.
  if (supabase === null) {
    // Name which half is missing. "Unconfigured" on its own sends whoever is
    // debugging to look at the key when the URL is absent, or at the URL when the
    // key is under a variable name this build does not read.
    const missing = [
      process.env.SUPABASE_URL ? null : 'SUPABASE_URL',
      supabaseKeySource() === null
        ? 'a server-side key (SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE)'
        : null,
    ].filter((m): m is string => m !== null)

    return Response.json({
      ...base,
      tier: 'STATIC',
      spentUsdLifetime: null,
      daysRemaining: null,
      simulated: cfg.simulation !== undefined,
      missing,
      note:
        'No ledger store configured: the governor fails closed and every answer is served from the static tier.',
    })
  }

  const store = new SupabaseLedgerStore(supabase)

  /**
   * Probe the store directly and report why it failed.
   *
   * The governor catches store errors and fails closed, which is the required
   * behaviour -- but it means a misconfigured or unreachable ledger looks
   * identical to a healthy one that has simply spent nothing. Fail closed is not
   * the same as fail silent, and this endpoint exists to tell them apart.
   *
   * The message carries an HTTP status and a path. It cannot carry the key.
   */
  const probeStartedAt = Date.now()
  let probe: { ok: boolean; ms: number; detail?: string }
  try {
    await store.getMany([`${cfg.namespace}:health:probe`])
    probe = { ok: true, ms: Date.now() - probeStartedAt }
  } catch (error) {
    probe = {
      ok: false,
      ms: Date.now() - probeStartedAt,
      detail: error instanceof Error ? error.message : 'unknown error',
    }
  }

  const governor = createGovernor(cfg, store)
  const snapshot = await governor.snapshot()
  const decision = await governor.authorize({ ip: 'health-check', sessionId: 'health-check' })

  return Response.json({
    ...base,
    tier: decision.tier,
    spentUsdLifetime: Number(snapshot.spentUsdLifetime.toFixed(4)),
    // NaN serialises as null, which reads as "not applicable" rather than
    // "the budget maths is broken". Say so instead.
    daysRemaining: Number.isFinite(snapshot.daysRemaining) ? snapshot.daysRemaining : 'INVALID',
    simulated: snapshot.simulated,
    reserveRemainingUsd: Number(snapshot.reserveRemainingUsd.toFixed(4)),
    isReserveWindow: snapshot.isReserveWindow,
    ledgerProbe: probe,
    /** The ceiling the governor races the store against, for comparison with probe.ms. */
    ledgerTimeoutMs: 400,
  })
}
