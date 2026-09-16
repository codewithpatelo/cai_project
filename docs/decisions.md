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
### ADR-002 — Supabase Postgres for the ledger, not in-process state
**Decision.** Ledger, rate-limit counters and leads in **Supabase Postgres**, accessed over
the PostgREST API. Two tables and one `governor_incr()` function (`architecture.md` §5).
**Alternatives.** Upstash Redis (the original choice); in-memory module state; Vercel
Postgres; a file; no persistence.
**Why a shared store at all.** Serverless instances don't share memory. A per-instance
counter under-counts spend by exactly the concurrency factor, silently defeating the ceiling
the governor exists to guarantee.
**Why Supabase over Redis.** This one is mostly operational and that is fine: the Supabase
account already exists and the Upstash one did not. A store you must go create is not the
simpler store, whatever its primitives look like. On the technical merits it is a wash —
Postgres gives atomic increment-and-return in a single statement, which is the only
primitive the governor needs, and the TTL semantics Redis provides for free are a six-line
`on conflict` clause. Postgres pays some of that back: leads get real columns and
constraints instead of a hash, and **RLS with no public policy** means a leaked anon key
still cannot read the ledger or a single lead.
**Access pattern.** PostgREST, never a direct Postgres connection. Serverless opens many
short-lived connections; REST connections establish far faster and sidestep pool exhaustion.
**Trade-off.** A network round trip on the request path and an external dependency that can
fail — handled by fail-closed (ADR-006), which turns an availability problem into a
degraded-but-honest experience. Postgres also has no native TTL, so expiry is expressed in
the upsert rather than by the engine; an expired row resets in place, so there is no cleanup
job to forget. The account is on the Pro plan, so free-tier
inactivity pausing does not apply.
**What this validated.** The swap from Redis to Postgres touched the adapter and the config
and nothing else. That is `LedgerStore` being a real port rather than a decorative one
(ADR-005), and it is the cheapest possible evidence that the layering works.

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
**Why.** The asymmetry is total. Failing closed during a store outage costs a few hours of
degraded-but-working answers. Failing open costs the entire remaining budget in minutes,
and the key **cannot be topped up** — that's an unrecoverable failure on a deliverable that
must be live for a scheduled review.
**Trade-off.** A store blip degrades a working bot to canned answers. Accepted, explicitly
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
### ADR-014 — Two OpenRouter keys: dev for building, client for production only
**Decision.** Two keys and a `OPENROUTER_KEY_PROFILE` that selects between them.
`dev` (our own, top-uppable) runs local development, every preview deploy, and every eval
run. `client` (the $5 / 7-day key) is set **only** in Vercel's Production environment and is
spent only by real visitors and the live review. The profile also sets the governor's ledger
`namespace`, so the two budgets are separate rows in the database.
**Alternatives.** One key everywhere with discipline and a low eval cap — the original plan.
**Why.** The client key **cannot be regenerated**. Under a single-key plan, every ordinary
engineering act — a debugging loop, a mistyped prompt, a re-run eval, a preview deploy
someone forgot about — spends from the thing that has to survive until Wednesday 20:00Z. The
$0.40 eval cap existed to manage exactly that pressure, and it made the *verification*
weaker: 32 cases at $0.0063 is $0.20, so the cap allowed one run and one retry, and any real
prompt-tuning loop was unaffordable. With a dev key the eval set can be run as often as the
prompt changes, which is how it should have worked all along.
**Why namespacing rather than just two keys.** Two keys alone would still write to one
ledger, so dev spend would move the client's pacing curve and could push production into
ECONOMY or STATIC for reasons that have nothing to do with real traffic. Prefixing every
ledger and rate-limit key with the profile makes the isolation structural instead of a rule
someone has to remember.
**Trade-off.** One more environment variable, one more thing `/deploy-check` must verify
(production on `client`, preview on `dev` — a preview accidentally on `client` silently
drains the budget). Worth it: this removes the dev machine, the largest exposure surface,
from the blast radius of an unregenerable key.
**Consequence.** `EVAL_BUDGET_USD` rises from $0.40 to $2.00, because it now protects our
own wallet rather than the client's $5.

---

## Risk register

| # | Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | **Budget exhausted before the live review** | Low | Fatal | Reserve (ADR-008) + pacing + 3-tier degradation + rate limits + fail-closed. Worst case the bot serves STATIC answers, which still demo all six scenarios | Demo shows canned answers; the governor itself becomes the demo |
| R2 | **Bot hallucinates a Cadre fact** — especially a portal URL | Medium | High | KB-only grounding; `Not published` blocks; output-side URL allow-list (catches it regardless of *why* the model said it); eval assertions `no_url_outside_allowlist`, `no_price`; `/kb-audit` | Novel phrasings may still produce an ungrounded sentence; the URL filter bounds the damage |
| R3 | **Deploy breaks near the review** | Medium | High | Deploy in Phase 2, then continuously; `/deploy-check` after every deploy; Vercel instant rollback to the last good deployment | A bad deploy at the wrong minute; rollback is <1 min |
| R4 | **Public URL abused / scripted** | Medium | High | Per-IP 8/min + 80/day, per-session 6/min + 40 lifetime, 2,000-char message cap. 80/day/IP bounds one abuser to ~$0.50/day. Caps are re-derived whenever the model price changes | Distributed abuse across IPs; ceiling + fail-closed remain the backstop |
| R5 | **Client API key leaked or burned** | Low | Fatal | Env vars only; server-only handler; never in repo, history, logs, bundle or error text; `/verify` greps the staged diff and the full history. **The client key is never used in development** (ADR-014), which removes the largest exposure surface: a dev machine | Cannot be regenerated. If leaked, the $5 cap bounds the loss but the demo may have to run on STATIC |
| R6 | **Supabase outage** | Low | Medium | Fail closed → STATIC. Bot stays up and honest. Pro plan, so free-tier inactivity pausing does not apply | Degraded answers for the outage duration |
| R7 | **OpenRouter outage or model deprecation** | Low | Medium | Two models configured; any upstream failure → STATIC after one retry | Both Google models unavailable simultaneously → STATIC only |
| R8 | **Prompt injection** | Medium | Low | Nothing to steal (no tools, no account access, no secrets in context) + structural data/instruction separation + output URL filter | Off-brand output; bounded by design, not by the model behaving |
| R9 | **Prices move during the 7 days** | Low | Medium | `/deploy-check` re-reads prices and fails on >20% drift, forcing recalculation | Mid-window change between deploys |
| R10 | **`[V:snippet]` facts turn out wrong** | Medium | Medium | `/kb-audit --live` gates the final deploy; unconfirmed facts are deleted, not softened | A smaller KB and more handoffs — which is the correct failure |
| R11 | **Key expires on or before review day** | Medium | High | Pacing horizon capped at the review window; STATIC tier needs no key and still answers every brief scenario; reserve unlocked from 12:00Z on review day | If the key dies mid-demo the bot degrades visibly — which is a demonstrable design property, not an outage |
| R12 | **Scope overrun; nothing finished** | Medium | High | Phase 2 deploys a working bot at 1h35m; explicit cut-order in `plan.md`; Phase 6/7 are the cuttable ones | Less polish, fewer evals; the deliverable still exists |

## Open questions taken as decisions

Per the brief, ambiguity is resolved and recorded rather than escalated:

1. **"Access the client portal"** — no public portal URL exists, so the bot describes the
   portal and escalates. It never guesses a link. (`kb/06`)
2. **"LLM selection and data security"** — Cadre publishes no policy, so the bot gives the
   three verified things (partners incl. OpenRouter, guardrails-and-human-oversight, and
   its own transparent build) and escalates the specifics. (`kb/07`)
3. **Pricing** — permanently out of scope, not a time constraint. (`kb/09` B1)
4. **Live-review window** — **resolved: Wed 23 Sep 2026, 17:00–18:00 local.** Config is set
   to `2026-09-23T12:00:00Z → 2026-09-24T06:00:00Z`. The timezone was not stated, so the
   window is a deliberately wide 18 hours rather than a tight 1-hour slot: too narrow
   (wrong timezone guess) makes the reserve unreachable at exactly the moment it exists
   for; too wide only risks unlocking $1.20 a few hours early. The asymmetry is total, so
   the choice is easy. Narrow it if the timezone is confirmed.
5. **Key expiry collides with review day — the schedule is the tightest constraint, not
   the budget.** The review is Wed 23 Sep; a $5/7-day key issued on 16 Sep expires the
   *same day*. Two consequences, both already handled by the design rather than by luck:
   - **Pacing horizon = `min(real key expiry, end of review window)`**, not the key expiry
     alone. Pacing exists to keep the bot alive until the review; spreading money past it
     is spreading money over days that no longer matter.
   - **An expired key does not take the bot down.** The STATIC tier costs $0 and makes no
     provider call, so a dead or exhausted key still answers all six brief scenarios from
     the same KB and still captures leads. This is the strongest argument for ADR-007
     (degrade, don't hard-stop) and it should be said out loud in the demo.

   **Action for the implementer: confirm the exact expiry timestamp before deploying.** If
   it lands before the review window, the reserve is worthless and the honest plan is to
   demo the STATIC tier deliberately.

6. **Submission deadline is Mon 21 Sep, not review day.** The brief requires submitting
   "at least one full business day before your scheduled review". Review Wed 23 → Tue 22
   must be a full business day → submit by end of Mon 21. That is **5 days from the design
   pass, not 7**, and it is the date `plan.md` should be executed against.

7. **The empty `key.txt` in the submission bundle** — the provided key file was empty at
   design time. The key is consumed **only** from the hosting environment's variables, so
   this changes nothing structurally; it is noted so the build phase doesn't stall looking
   for it. No call was made with any key during the design pass.
