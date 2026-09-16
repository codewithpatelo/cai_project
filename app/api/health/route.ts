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
import { governorConfigFromEnv, keyProfile, supabaseConfigFromEnv } from '@/lib/chat/governor-config'
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
    modelConfigured: process.env.OPENROUTER_API_KEY ? true : false,
    kbTokens: COMPILED_KB_TOKENS,
  }

  // No store means the governor fails closed to STATIC on every request. That is
  // correct behaviour, not an outage, so `ok` stays true -- but it is reported,
  // because a deployment serving only canned answers should be obvious.
  if (supabase === null) {
    return Response.json({
      ...base,
      tier: 'STATIC',
      spentUsdLifetime: null,
      daysRemaining: null,
      simulated: cfg.simulation !== undefined,
      note: 'No ledger store configured: the governor fails closed and every answer is served from the static tier.',
    })
  }

  const governor = createGovernor(cfg, new SupabaseLedgerStore(supabase))
  const snapshot = await governor.snapshot()
  const decision = await governor.authorize({ ip: 'health-check', sessionId: 'health-check' })

  return Response.json({
    ...base,
    tier: decision.tier,
    spentUsdLifetime: Number(snapshot.spentUsdLifetime.toFixed(4)),
    daysRemaining: snapshot.daysRemaining,
    simulated: snapshot.simulated,
    reserveRemainingUsd: Number(snapshot.reserveRemainingUsd.toFixed(4)),
    isReserveWindow: snapshot.isReserveWindow,
  })
}
