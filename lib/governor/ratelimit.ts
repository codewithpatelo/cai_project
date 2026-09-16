/**
 * The four fixed-window rate limits (spec §7). Every counter is namespaced so a dev and a
 * production deployment sharing one store can never bump each other's windows.
 */

import type { LedgerStore } from './ledger'
import type { DecisionReason, GovernorConfig } from './types'

export interface RateLimitResult {
  blocked: boolean
  reason?: Extract<DecisionReason, 'rate_limited_ip' | 'rate_limited_session'>
  retryAfterSec?: number
}

function ipKey60(namespace: string, ip: string): string {
  return `${namespace}:rl:ip:60:${ip}`
}
function ipKeyDaily(namespace: string, ip: string): string {
  return `${namespace}:rl:ip:daily:${ip}`
}
function sessionKey60(namespace: string, sessionId: string): string {
  return `${namespace}:rl:session:60:${sessionId}`
}
function sessionKeyLifetime(namespace: string, sessionId: string): string {
  return `${namespace}:rl:session:lifetime:${sessionId}`
}

/**
 * Increments all four counters for this request and reports the first breach, in the order
 * the spec table lists them. Every counter is incremented regardless of an earlier breach —
 * an already-blocked caller's request still counts against every window, otherwise a
 * determined abuser could burn one window for free by tripping another first.
 */
export async function checkRateLimits(
  store: LedgerStore,
  cfg: GovernorConfig,
  ctx: { ip: string; sessionId: string }
): Promise<RateLimitResult> {
  const [ip60, ipDaily, session60, sessionLifetime] = await Promise.all([
    store.expiringIncr(ipKey60(cfg.namespace, ctx.ip), cfg.rateLimits.perIp.windowSec),
    store.expiringIncr(ipKeyDaily(cfg.namespace, ctx.ip), cfg.rateLimits.perIpDaily.windowSec),
    store.expiringIncr(sessionKey60(cfg.namespace, ctx.sessionId), cfg.rateLimits.perSession.windowSec),
    store.incrBy(sessionKeyLifetime(cfg.namespace, ctx.sessionId), 1),
  ])

  if (ip60 > cfg.rateLimits.perIp.max) {
    return { blocked: true, reason: 'rate_limited_ip', retryAfterSec: cfg.rateLimits.perIp.windowSec }
  }
  if (ipDaily > cfg.rateLimits.perIpDaily.max) {
    return { blocked: true, reason: 'rate_limited_ip' }
  }
  if (session60 > cfg.rateLimits.perSession.max) {
    return {
      blocked: true,
      reason: 'rate_limited_session',
      retryAfterSec: cfg.rateLimits.perSession.windowSec,
    }
  }
  if (sessionLifetime > cfg.rateLimits.perSessionLifetime.max) {
    return { blocked: true, reason: 'rate_limited_session' }
  }

  return { blocked: false }
}
