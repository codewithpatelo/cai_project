# Decisions and risks

## ADRs

Format: decision · alternatives · why · trade-off accepted.

---
### ADR-001 — Next.js on Vercel
**Decision.** Next.js 15 App Router + TypeScript, deployed on Vercel, Node runtime, SSE.
**Alternatives.** FastAPI + React (two deploys); SvelteKit; a single Cloudflare Worker.
**Why.** Fastest zero-to-public-HTTPS-with-streaming path, and the brief names it as a good
default. Decisively: Vercel's env-var store is a clean, auditable home for the API key,
with a server-only route handler between the key and the browser.
**Trade-off.** Vercel lock-in for routing and env handling; cold starts add ~200ms to a
first request. Both acceptable for a 7-day demo.

---
### ADR-002 — Upstash Redis for the ledger, not in-process state
**Decision.** Ledger, rate-limit counters and leads in Upstash Redis.
**Alternatives.** In-memory module state; Vercel Postgres; a file; no persistence.
**Why.** Serverless instances don't share memory. A per-instance counter under-counts spend
by exactly the concurrency factor, which silently defeats the ceiling — the one thing the
governor exists to guarantee. Redis gives atomic `INCRBYFLOAT` and TTL counters, which is
precisely the primitive set needed and nothing more.
**Trade-off.** A network round trip on the request path (~10-20ms) and an external
dependency that can fail. The second is handled by fail-closed (ADR-006), which converts an
availability problem into a degraded-but-honest experience.

---
### ADR-003 — Whole knowledge base in context; no RAG
**Decision.** All of `kb/` (≈4,700 tokens) in every request. No embeddings, no retrieval.
**Alternatives.** Vector store + top-k retrieval; keyword routing to topic files.
**Why.** At 4,700 tokens the KB costs **$0.0035/request** uncached on 3.8 Flash, and a
tenth of that on a cache hit. RAG would add a
chunker, an index, a retriever, retrieval-quality evals, and a new failure mode. It would
start paying off north of ~50,000 KB tokens — we're 10× below that. The deeper reason is
groundedness, not cost: with full context the model sees **every `Not published` block on
every turn**, which is what makes refusals reliable. Retrieval would sometimes hide the
exact block that prevents a hallucination.
**Trade-off.** Cost scales linearly with KB size, and the KB can't grow much past ~25,000
tokens before this flips. Revisit at that threshold (`architecture.md` §7).

---
### ADR-004 — `gemini-3.8-flash` primary, `gemini-3.1-flash-lite` degraded
**Decision.** `google/gemini-3.8-flash` ($0.75/$3.75) primary;
`google/gemini-3.1-flash-lite` ($0.25/$1.50) as the economy tier. Pinned ids, not aliases.
**Alternatives.** `openai/gpt-5.4-mini` ($0.75/$4.50); `anthropic/claude-haiku-4.5`
($1.00/$5.00); `google/gemini-3.5-flash-lite` ($0.30/$2.50).
**Superseded.** An earlier draft chose `gemini-2.5-flash` / `gemini-2.5-flash-lite`
($0.30/$2.50 and $0.10/$0.40). Those are 2025-generation models. They were cheaper — ~370
projected conversations against ~166 — but shipping a generation-old model in September
2026 is the wrong answer to the one decision the brief explicitly asks us to defend, and
the quality-critical behaviour here (refusal discipline: not padding the pillar list, not
producing a plausible portal URL under pressure) is exactly where a generation gap shows.
**Why 3.8 Flash.** Current-generation, the most capable model in the Flash line. Against
`gpt-5.4-mini`: identical input price, 20% more on output, and it is a reasoning model
whose reasoning tokens bill as output and vary per request — the wrong trade for a system
built around a *predictable* ceiling. Against Haiku 4.5: 33% cheaper on both sides for a
task that isn't quality-bound once the KB is in context. It also publishes cache read at
**10% of input with no write cost**, which is worth real money against a 5,800-token fixed
prefix.
**Why 3.1 Flash Lite.** Cheapest current-generation option, 2.9× cheaper per conversation,
and — the deciding factor — same family, tokenizer and prompt, so degrading doesn't mean
maintaining a second prompt and eval baseline under budget pressure.
**Trade-off accepted.** Capacity drops from ~370 to **~166 primary conversations** (~220
mixed-tier). Still ~31/day, far more than this bot will organically serve. The second-order
cost is real and was paid: 2.25× per-turn cost meant the per-IP daily cap had to tighten
from 120 to 80 requests to keep one abuser bounded at ~$0.50/day. Haiku 4.5 remains the
documented escape hatch if evals section C fails; the switch is one config line.

---
### ADR-005 — Budget governor as a generic, domain-free module
**Decision.** `lib/governor/` knows about money, tokens, time and model ids. Nothing else.
**Alternatives.** Inline the budget checks in the route handler (faster to write).
**Why.** Three reasons, in order. It makes the logic **testable without the app** — pure
functions over an injected clock and store, so the 7-day pacing curve and the reserve
window can be driven in milliseconds. It makes the constraint **visible** rather than
scattered through a handler. And it is genuinely reusable — this problem (fixed prepaid
budget, fixed horizon, must not die early) recurs in every agent project.
**Trade-off.** More files and an indirection layer than a 30-line inline check. Worth it:
the inline version can't be tested, and an untested ceiling isn't a ceiling.

---
### ADR-006 — Fail closed, with no escape hatch
**Decision.** If spend can't be read or estimated, no model call happens.
**Alternatives.** Fail open with a warning; fail open with a small per-instance allowance.
**Why.** The asymmetry is total. Failing closed during a Redis outage costs a few hours of
degraded-but-working answers. Failing open costs the entire remaining budget in minutes,
and the key **cannot be topped up** — that's an unrecoverable failure on a deliverable that
must be live for a scheduled review.
**Trade-off.** A Redis blip degrades a working bot to canned answers. Accepted, explicitly
and permanently. The 400ms timeout counts as unavailability; there is no retry.

---
### ADR-007 — Three-tier degradation instead of a hard stop
**Decision.** PRIMARY → ECONOMY → STATIC, with STATIC always available at $0.
**Alternatives.** Single model + hard stop at the ceiling; queue requests when low.
**Why.** A hard stop means the URL is *dead* the moment the money runs out — including, if
timing is unlucky, during the review. STATIC costs nothing, can't fail, and still answers
the six brief scenarios from the same KB. The bot degrades in usefulness rather than in
availability.
**Trade-off.** Two extra code paths and a keyword matcher to maintain. Bounded, because the
static answers are generated from the same KB at build time and can't drift.

---
### ADR-008 — Explicit reserve for the live review
**Decision.** $1.20 of $5.00 is locked and spendable only inside a configured review window.
**Alternatives.** Even daily pacing; no reserve.
**Why.** Even pacing still permits days 1–6 to consume everything if traffic is bursty or
someone scripts the endpoint. The review is the single highest-stakes hour of the key's
life. $1.20 ≈ 89 primary-model conversations, far more than a 10-minute demo needs, with
room for a second session.
**Trade-off.** ~24% of the budget sits idle most of the week, and the window must be set
correctly in config or the reserve is unreachable when needed. `/deploy-check` verifies it.

---
### ADR-009 — Lead capture, not fake live handoff
**Decision.** The bot stores a lead and says exactly that. It never claims to email, page,
route or book.
**Alternatives.** Claim "someone will be in touch shortly"; embed a scheduling widget;
build an email integration.
**Why.** No real human channel is publicly verifiable, and no scheduling URL exists in any
permitted source. A support bot that promises a callback it can't deliver is worse than one
that says "I'll pass this on, I can't promise when" — the second sets a keepable
expectation. For a consultancy selling AI judgement, an over-promising bot is an
anti-advertisement.
**Trade-off.** Less satisfying UX than a confirmed booking. Correctness over polish.

---
### ADR-010 — Whole-KB visibility beats prompt-caching optimisation
**Decision.** Order the prompt as fixed-prefix-then-KB-then-history so implicit caching
*can* hit, but treat every cache hit as upside and budget for zero.
**Alternatives.** Engineer for cache hits and plan capacity assuming them; skip caching
considerations entirely.
**Why.** OpenRouter's implicit cache TTL is ~3–5 minutes. A demo bot's traffic is sparse
and bursty, so most conversations start cold — even though most turns *within* a
conversation will hit. Budgeting on hits we probably won't get is how a budget silently
fails. Ordering for them anyway is free.
**Trade-off.** Capacity estimates in `model-selection.md` are conservative. With
3.8 Flash's cache read at 10% of input, a fully-warm 4-turn conversation costs $0.0135
against the $0.0252 budgeted — so real-world capacity may be up to ~1.8× the planned
figure. Being wrong in that direction is the correct way to be wrong about money.

---
### ADR-011 — KB verified from search extracts, pending a live re-read
**Decision.** Ship the design with facts tagged `[V:snippet]`, and gate the final deploy on
`/kb-audit --live` promoting or deleting each one.
**Alternatives.** Omit every unverifiable fact (a near-empty KB); ship them unmarked.
**Why.** The design environment's egress proxy **blocks `cadreai.com`**, so pages could not
be fetched directly. Rather than pretend to a verification that didn't happen, every fact
carries its actual provenance and the build pipeline forces resolution before deploy. The
tags aren't bookkeeping — they're the mechanism that stops unverified content reaching
users.
**Trade-off.** Phase 7 carries mandatory re-verification work, and some facts will be
deleted. An honest smaller KB is the product working as designed.

---
### ADR-012 — No conversation persistence
**Decision.** History lives in `sessionStorage` and the request body. The server never
writes it.
**Alternatives.** Persist transcripts for analytics or continuity.
**Why.** Persistence needs identity, a retention policy and a privacy notice — none of
which is in scope, and all of which create PII risk for a bot whose whole pitch is
trustworthiness. The bot cannot leak what it never stored.
**Trade-off.** No cross-session continuity, and no transcript analytics. Telemetry captures
tokens, cost, tier and latency, which is what's needed to reason about the system.

---
### ADR-013 — Pin model ids; never use a `~latest` alias
**Decision.** Config carries `google/gemini-3.8-flash` and `google/gemini-3.1-flash-lite`
explicitly. `~google/gemini-flash-latest` and `~anthropic/claude-haiku-latest` exist and are
not used.
**Alternatives.** Track the alias and always get the newest model.
**Why.** An alias can change model, price and behaviour mid-window with no deploy on our
side. That would silently invalidate every figure in `model-selection.md` §3, every eval
baseline, and the rate-limit derivation — on a key that cannot be topped up, during a
window that ends in a live review. Upgrading should be a commit someone made on purpose,
which re-runs the budget arithmetic and the evals.
**Trade-off.** We can ship on a model that has been superseded mid-week. `/deploy-check`
already re-reads prices and fails on >20% drift, which surfaces the common case.

---

## Risk register

| # | Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | **Budget exhausted before the live review** | Low | Fatal | Reserve (ADR-008) + pacing + 3-tier degradation + rate limits + fail-closed. Worst case the bot serves STATIC answers, which still demo all six scenarios | Demo shows canned answers; the governor itself becomes the demo |
| R2 | **Bot hallucinates a Cadre fact** — especially a portal URL | Medium | High | KB-only grounding; `Not published` blocks; output-side URL allow-list (catches it regardless of *why* the model said it); eval assertions `no_url_outside_allowlist`, `no_price`; `/kb-audit` | Novel phrasings may still produce an ungrounded sentence; the URL filter bounds the damage |
| R3 | **Deploy breaks near the review** | Medium | High | Deploy in Phase 2, then continuously; `/deploy-check` after every deploy; Vercel instant rollback to the last good deployment | A bad deploy at the wrong minute; rollback is <1 min |
| R4 | **Public URL abused / scripted** | Medium | High | Per-IP 8/min + 80/day, per-session 6/min + 40 lifetime, 2,000-char message cap. 80/day/IP bounds one abuser to ~$0.50/day. Caps are re-derived whenever the model price changes | Distributed abuse across IPs; ceiling + fail-closed remain the backstop |
| R5 | **API key leaked** | Low | Fatal | Env vars only; server-only handler; never in repo, history, logs, bundle or error text; `/verify` greps the staged diff and the full history | If leaked: revoke at OpenRouter immediately, rotate, redeploy. The $5 cap bounds the loss |
| R6 | **Redis outage** | Low | Medium | Fail closed → STATIC. Bot stays up and honest | Degraded answers for the outage duration |
| R7 | **OpenRouter outage or model deprecation** | Low | Medium | Two models configured; any upstream failure → STATIC after one retry | Both Google models unavailable simultaneously → STATIC only |
| R8 | **Prompt injection** | Medium | Low | Nothing to steal (no tools, no account access, no secrets in context) + structural data/instruction separation + output URL filter | Off-brand output; bounded by design, not by the model behaving |
| R9 | **Prices move during the 7 days** | Low | Medium | `/deploy-check` re-reads prices and fails on >20% drift, forcing recalculation | Mid-window change between deploys |
| R10 | **`[V:snippet]` facts turn out wrong** | Medium | Medium | `/kb-audit --live` gates the final deploy; unconfirmed facts are deleted, not softened | A smaller KB and more handoffs — which is the correct failure |
| R11 | **Scope overrun; nothing finished** | Medium | High | Phase 2 deploys a working bot at 1h35m; explicit cut-order in `plan.md`; Phase 6/7 are the cuttable ones | Less polish, fewer evals; the deliverable still exists |

## Open questions taken as decisions

Per the brief, ambiguity is resolved and recorded rather than escalated:

1. **"Access the client portal"** — no public portal URL exists, so the bot describes the
   portal and escalates. It never guesses a link. (`kb/06`)
2. **"LLM selection and data security"** — Cadre publishes no policy, so the bot gives the
   three verified things (partners incl. OpenRouter, guardrails-and-human-oversight, and
   its own transparent build) and escalates the specifics. (`kb/07`)
3. **Pricing** — permanently out of scope, not a time constraint. (`kb/09` B1)
4. **Live-review window** — must be set in config before submission. If unknown at deploy
   time, default the reserve window to the **last 48 hours** before key expiry, which is
   strictly safer than guessing a narrower slot.
5. **The empty `key.txt` in the submission bundle** — the provided key file was empty at
   design time. The key is consumed **only** from the hosting environment's variables, so
   this changes nothing structurally; it is noted so the build phase doesn't stall looking
   for it. No call was made with any key during the design pass.
