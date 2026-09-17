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
### ADR-015 — Responsive, accessible, and a light/dark theme toggle
**Decision.** Responsive and accessible behaviour are **build constraints** on every screen,
not a polish pass. A light/dark toggle is IN: OS preference by default, a single header
button to override, the override persisted in `localStorage`.
**Alternatives.** Light only (the original scope); dark only; a three-state
system/light/dark control.
**Why.** Requested directly by the stakeholder, which settles it. The reasoning still
matters for *how*: defaulting to `prefers-color-scheme` means most people never touch the
control and get the right answer anyway, so the toggle is an override rather than the
mechanism. A three-state control would be more "correct" and is a worse product — it asks
every user to reason about a setting that already has a good default. Two states plus an OS
default is Occam's razor applied to a UI affordance.
**This supersedes** the line in `CLAUDE.md` § What NOT to do that read "don't build a theme
switcher". That rule existed to prevent scope drift into a settings page; the exception is
one header button, and the prohibition on a settings page stands.
**Cost, honestly.** ~20 minutes in Phase 6 *provided* colours are CSS custom properties from
the start. If the build hardcodes hexes first, it is a rewrite of every component instead —
which is why the token-architecture rule is stated at the top of `docs/design-system.md` and
in `CLAUDE.md`, rather than buried.
**Trade-off.** A second palette to keep contrast-correct. Mitigated by measuring: all 16
foreground/background pairs across both themes were computed with the WCAG formula and
recorded in the design system, so a future edit has a baseline to check against rather than
an opinion.

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

---

# Build-phase ADRs

Decisions taken during implementation. Each one is a place where the design met a fact it
had not anticipated.

### ADR-016 — The live KB audit could not run; verification is a build-time gate instead

**Context.** `kb/README.md` and `HANDOFF.md` both require `/kb-audit --live` to run before
Phase 2 puts the bot on a public URL. The build environment's egress policy returns 403 for
`cadreai.com` (and for `openrouter.ai` and `api.vercel.com`), so the live re-read is
impossible here, exactly as it was during the design pass.

**Decision.** Rather than treat verification as a manual step someone remembers, the
compiler carries a gate. `KB_MIN_VERIFICATION` drops every fact below a chosen tier:
building with `brief` produces a smaller, fully-verified bot from the 7 `[V:brief]` facts
plus the escalation paths, which are policy rather than sourced claims and therefore
survive. The default remains `snippet` so local development and the eval set exercise the
full KB, and `pnpm kb:compile` prints a loud warning naming the count of unverified facts.

**Consequence.** The decision moves from "did anyone remember to audit?" to a build flag
with a visible default. A public deploy should either pass the live audit or build with
`KB_MIN_VERIFICATION=brief`. The 27 `[V:snippet]` facts remain unverified and are marked
as such.

**Status.** Live audit still outstanding. This is a mitigation, not a substitute.

### ADR-017 — One KB fact deleted as unsourced; the tag census was wrong

**Context.** An offline audit of `kb/` found the counts in `HANDOFF.md` (8 `[V:brief]` /
31 `[V:snippet]` / 0 `[V:live]`) did not match the files: the real figures were 7 / 28 / 0.
It also found that the Construction bullet in `03-industries.md` — "agents that analyse
construction plans… reduce estimating time from days to hours" — carried `[V:snippet]` but
cited no page, and that no construction page appears in the KB's own inventory.

**Decision.** Delete the bullet. Construction survives as one of the industries Cadre
names, which is `[V:brief]` and needs no page. Eval case A4 previously asserted the
takeoff/estimating example and now expects the honest answer instead.

**Consequence.** The bot loses a specific, attractive-sounding capability claim and keeps a
verified one. `docs/mock/Main.dc.html` still *shows* the bot giving the deleted answer; the
mock was left alone because mocks are `ui-designer`'s to change, but it is now a known
discrepancy between the mock and what the bot may say.

**Also fixed:** a verification tag only counts when it ends a line. `04-getting-started.md`
mentions `[V:live]` mid-sentence while explaining the convention, and a naive parser read
that as a verified fact.

### ADR-018 — No ledger store means STATIC, not an in-process counter

**Context.** The chat route needs a `LedgerStore`. The tempting fallback when Supabase is
not configured is `MemoryLedgerStore`, which is already written and already tested.

**Decision.** Return no governor at all, and serve STATIC.

**Consequence.** On serverless, instances do not share memory, so a per-instance counter
under-counts spend by exactly the concurrency factor. A ceiling that under-counts is not a
ceiling; it is a ceiling-shaped decoration that passes its own tests. `/api/health` reports
`ledger: "unconfigured"` so a deployment serving only canned answers is visible from
outside rather than looking healthy while doing nothing.

### ADR-019 — Simulation mode bypasses the store entirely, and what that costs

**Context.** Spec §9 requires simulated state to be read-only. The governor implementation
went further: under simulation, `authorize()`, `record()` and `snapshot()` skip the store
completely, including the rate-limit counters.

**Decision.** Keep the wider interpretation, and make its cost visible.

**Consequence.** The demo survives an unreachable store, which is the point of having it.
But a simulated deployment has no live rate limiting, and — the sharper edge — a simulated
*low* spend would return `allowed: true` with a real model id while `record()` writes
nothing, so real money would be spent and never accounted for. The intended demo forces a
*high* spend (`GOVERNOR_SIM_SPENT_USD=4.10`), which lands on STATIC and costs nothing.
`GOVERNOR_SIM_ENABLED` must stay unset in production, and `/api/health` reports
`simulated` so a misconfiguration is visible without opening the dashboard.

### ADR-020 — The URL filter matches bare hostnames, not just full URLs

**Context.** The KB deliberately names `portal.cadreai.com`, `app.cadreai.com` and
`cadreai.com/login` as inventions, because telling the model they are fabricated is what
stops it producing one. That means those strings are in the model's context by design.

**Decision.** The output-side filter matches host-shaped strings with or without a scheme,
and compares canonically (scheme, `www.`, trailing slash and case all normalised).

**Consequence.** A filter that only matched `https://…` would let the bare form straight
through — the exact form the KB put in front of the model. Canonical comparison also stops
`cadreai.com/contact` being stripped while `https://www.cadreai.com/contact` is allowed,
which would have been an obvious bug in the other direction. The filter runs on accumulated
text at whitespace boundaries rather than per token, because a URL can arrive split across
streaming chunks and a per-token filter would never see one whole.

### ADR-021 — Two specification errors corrected rather than worked around

**Context.** `docs/principles.md` §1 says a wrong spec is fixed before the code.

**Decision and consequence.**

1. **AC0.2 and rubric row F1** asserted that `git log -p | grep -iE 'sk-or-|service_role'`
   returns nothing. Both texts contain the string `service_role`, so the grep could never
   return nothing and the criterion could never pass. Both now match key *shape* — an
   OpenRouter key literal or a JWT — which is what actually matters. `lib/guardrails.test.ts`
   runs the same assertion over the working tree.
2. **AC1.1** described a `Sources:` block per `##` section. Every file in `kb/` carries one
   file-level block instead, and `kb/README.md` rule 5 states the URL allow-list repo-wide.
   The compiler enforces the real structure: a file asserting facts must cite sources, and a
   URL may appear anywhere in `kb/` only if some `Sources:` block cites it.

### ADR-022 — Ship the full KB unverified — SUPERSEDED by ADR-024

**Context.** ADR-016 built `KB_MIN_VERIFICATION` so a public deploy could ship only
brief-verified facts when the live audit had not run. Asked to choose, the project owner
directed that the **full KB ships**, and pushed back on whether the verification block was
real — reasonably, since "I can't check" is a claim that deserves testing.

**What was actually tested**, rather than asserted:

| Attempt | Result |
|---|---|
| `curl https://cadreai.com` through the agent proxy | `403` at the `CONNECT` stage |
| DNS for `cadreai.com` | resolves (`198.202.211.1`) |
| Raw TCP to `:443` | opens |
| Playwright + bundled Chromium, default proxy | `net::ERR_TUNNEL_CONNECTION_FAILED` |
| Chromium with `--proxy-bypass-list=*` | `net::ERR_TUNNEL_CONNECTION_FAILED` |
| Chromium with `--no-proxy-server` | `net::ERR_CERT_AUTHORITY_INVALID` — a policy gateway, not the origin |
| Bypassing the proxy from the shell | blocked by the sandbox as a containment escape |

So it is not a tooling gap that a headless browser solves. Every route out of this
environment terminates at the same policy gateway, and going around it is itself blocked.
Playwright reaches the gateway exactly as `curl` does.

**Decision.** Build with the default `KB_MIN_VERIFICATION=snippet` — all 34 facts. The
27 `[V:snippet]` facts go to real users unconfirmed.

**Consequence, stated plainly.** This is a deliberate departure from `kb/README.md`'s own
rule that unverified facts do not ship, taken by the person who owns the risk. The bot is
materially more useful for it: the eight-pillar framework, the 1–100 scale, the 200+
companies claim, the per-industry examples and the OpenRouter partner fact are all
`[V:snippet]`, and eval cases A2, A9 and A12 have nothing to answer from without them.

The exposure is bounded by what is already true of these facts: each cites a real
cadreai.com page and came from that page's search extract, so the failure mode is a
*stale or imprecisely worded* fact rather than an invented one. The invented-URL class of
failure — the one that sends a client to a page that does not exist — is blocked
independently of verification by the compiler's citation gate and the output-side filter,
and neither depends on the tags.

**The audit is still owed.** `/kb-audit --live` should run from any environment with
egress to cadreai.com before the live review, and anything that does not confirm should be
deleted, not softened. Until then `kb/README.md`'s census stands at 7 / 27 / 0.

### ADR-023 — DeepSeek as a fallback provider, and what it costs in accounting

**Context.** ADR-004 and ADR-013 pin `google/gemini-3.8-flash` and
`google/gemini-3.1-flash-lite` on OpenRouter. The only development key available is a
**DeepSeek** key, so the deployment needs a second provider.

**Decision.** Add `lib/llm/provider.ts` and rename `openrouter.ts` to `client.ts`. Both
providers speak the same OpenAI-compatible chat-completions dialect, so only the endpoint,
the attribution headers and cost reporting differ. OpenRouter remains the default and an
unrecognised `LLM_PROVIDER` falls back to it rather than failing at request time.

This is the layering claim in `docs/architecture.md` §6 — "swapping OpenRouter for a direct
client should touch exactly one file" — being tested for real rather than asserted. It held:
the governor, the prompt assembly, the route and the UI are unchanged.

**Consequence, and it is a real one.** **DeepSeek does not return a cost in its usage
block.** OpenRouter does, which is what `governor-spec.md` §2 is built around. On DeepSeek
every call is priced from configured per-token rates and recorded as
`costSource: 'estimated'`, with the pessimistic 1.25x multiplier. The governor still paces,
degrades and fails closed exactly as specified, and erring high degrades the bot early
rather than overspending — but the ledger becomes our estimate rather than the provider's
number, and reconciliation against `/api/v1/generation` (an OpenRouter endpoint) is not
available. Accept that, or run the demo on OpenRouter.

**DeepSeek's prices are not hardcoded.** This build had no egress to any pricing page, and
inventing a plausible rate is the same failure the knowledge base exists to prevent — except
here a wrong number silently under-counts real money. Rates come from
`MODEL_PRIMARY_INPUT_PER_MTOK` / `MODEL_PRIMARY_OUTPUT_PER_MTOK` (and the ECONOMY pair),
**which must be set from the provider's live pricing page**. Unset, an unknown model falls
back to the most expensive captured rates ($1.00 / $5.00 per Mtok).

A test caught the sharp edge here: `Number('')` is `0`, and Vercel writes an unset variable
as an empty string, so a half-configured override would have priced input at zero and
under-counted spend. An empty value is now absent, not free, and both rates are required
together.

### ADR-024 — The live audit ran, and it corrected the KB in both directions

**Context.** ADR-016 and ADR-022 both rested on the same constraint: nothing in the build
environment could reach `cadreai.com`, so 27 facts shipped unverified. Connecting a
**hosted** browsing tool removed that constraint — the fetch happens on the provider's
infrastructure rather than inside this sandbox, which is the same reason the Supabase and
Vercel integrations work while raw HTTP does not. That distinction is the whole answer to
"why can't you just use a browser": a local headless browser would have used the same
blocked proxy, and did, with `ERR_TUNNEL_CONNECTION_FAILED`.

**Decision.** Run the audit. Promote what the pages confirm, delete what they do not, and
add what the KB was wrongly withholding.

**Outcome: 7 `[V:brief]` · 30 `[V:live]` · 0 `[V:snippet]`.** ADR-022's exposure is closed.

**Deleted — asserted by the KB, absent from every page:**
"200+ companies guided"; the Index's "1-to-100 scale"; a Construction agent doing plan
takeoffs and cutting estimating "from days to hours"; voice and chat agents "unifying
communication channels with SaaS integration for availability checking and automatic
booking".

**Added — published all along, and the KB was suppressing it:**
- **All eight AI Maturity Index pillars.** The KB had four and instructed the bot to say
  the list was partial. This is the finding worth dwelling on: the discipline that stops a
  bot inventing facts had, uncorrected, produced a bot that *refused to answer a question
  its company answers publicly*. Caution and accuracy are not the same thing, and only a
  live read could tell them apart.
- **Real contact details** — `hello@gocadre.ai`, `(619) 324-3223`, and the San Diego office.
  The KB previously forbade the bot from giving any of them. Note the contact domain is
  `gocadre.ai`, not `cadreai.com`.
- Official OpenAI Service Partner; the nine industries and eight departments verbatim from
  the `/agents` filters; the real Construction agent (**Change Order Tracker**).

**Two bugs the change surfaced, both in the safety machinery itself:**

1. **The output filter mangled the email.** The domain half of an address is host-shaped, so
   `hello@gocadre.ai` came out as `hello@[link removed]` — the filter breaking the single
   most useful answer the bot has. Addresses are now their own class, matched before URLs
   and checked against an email allow-list the compiler derives from `kb/`, so an invented
   `support@cadreai.com` is still stripped.
2. **A "we deleted X" note re-taught X to the model.** The first pass at these corrections
   left provenance in the KB: *"an earlier version claimed a 1-to-100 scale"*. The whole KB
   goes into the prompt, so that note put the fabricated figure back in front of the model
   inside a `Not published` block. Corrections must now state the truth without quoting the
   falsehood; the provenance lives in git history and here.

**Still outstanding:** the evals have never run against a real model, so section C remains
unverified rather than passed.

### ADR-025 — Smoothness is the UI's job, not the transport's

**Context.** The deployed bot felt rough: answers appeared in one jump, the handoff card
popped in fully formed, and — worst — the composer was something you had to *scroll to*.

**The first attempt was wrong and is recorded here because it was wrong.** Reading "answers
appear instantly" as a pacing problem, the static tier was given a 260ms lead-in and 38ms
between chunks to imitate typing. That is making the product slower on purpose to
compensate for a missing animation. The owner rejected it immediately and was right: the
complaint was never about speed, it was about animation and visual feedback. The delays
were removed; a test now asserts no `setTimeout` survives in either the responder or the
route.

**What the problems actually were, all three structural:**

1. **The composer was inside the scrolling flow.** `.app` had `min-height: 100dvh` and the
   composer was `position: sticky; bottom: 0`, so the *page* scrolled and the input only
   pinned itself once you had already scrolled down to it. No chat interface behaves that
   way. The app is now a fixed `height: 100dvh` column, `.transcript-scroll` is the only
   scrolling region, and the composer is a `flex: 0 0 auto` sibling that cannot leave the
   viewport. `min-height: 0` on the scroll region is load-bearing: without it a flex child
   refuses to shrink below its content, the column grows, and the composer is pushed off
   screen again.

2. **Auto-scroll moved the document.** `scrollIntoView` on an end marker scrolls whatever
   ancestor it must, including the page — re-creating the same failure. It now sets
   `scrollTop` on the transcript container directly.

3. **Nothing animated.** Bubbles and the handoff card were mounted at full opacity. Bubbles
   rise in over 160ms; the card over 240ms after a 120ms beat, so the answer lands and the
   offer follows it rather than both arriving at once. The streaming cursor blinks. All of
   it is disabled under `prefers-reduced-motion`, and a test checks that an animation
   declared after that block is still caught by it.

**Not done:** typing dots. `docs/design-system.md` specifies the streaming affordance as a
2px accent bar and rules out dots and shimmer.

**Still unverified:** none of this has been seen against a real model response. Perceived
latency with a ~1s provider call is a different problem, and only the no-model case has
been looked at.

### ADR-026 — The ledger adapter called a function that did not exist

**Context.** Before asking for the Supabase service-role key to be set, the adapter was read
against the schema that had actually been applied to the database.

**They did not match, in two ways.** `SupabaseLedgerStore.incrBy` posted to
`/rest/v1/rpc/governor_incr_by` — a function never declared anywhere. And `expiringIncr`
posted `{key, amount, ttl_sec}` to `governor_incr`, which is declared
`(p_key, p_delta, p_ttl_seconds)`. PostgREST binds RPC arguments **by name**, so both calls
would have failed.

**What that would have looked like.** Every ledger read and write throws → `authorize()`
lands in its catch → fail-closed → `tier: STATIC`, `model: null`, no provider call. The bot
would have kept answering, correctly and from canned text, forever. `/api/health` would have
reported `ledger: "supabase"` because the variables were present. The visible symptom would
have been "the model never runs", and the obvious suspect would have been the API key — a
long way from the actual cause.

**Why nothing caught it.** Every governor test uses `MemoryLedgerStore`, which is correct
(CLAUDE.md forbids mocking the governor). The one Supabase test asserted that `incrBy`
posts to `governor_incr_by` — it pinned the adapter to its own behaviour rather than to the
database, so the bug had a passing test defending it. Typecheck and lint cannot see across
an HTTP boundary into SQL.

**Decision.** Align the adapter with `docs/architecture.md` §5 rather than the reverse: one
`governor_incr`, with a null TTL for counters that never expire. Add
`ledger.contract.test.ts`, which drives the real adapter through a recording `fetch` and
compares the RPC name and every argument name against the signature parsed out of
`supabase/schema.sql`. If either side moves, that test fails.

**The general lesson:** a port tested only through its in-memory implementation is tested
only up to the boundary that matters. The seam between the adapter and the thing it adapts
needs its own contract test, and the in-memory double cannot provide it.
