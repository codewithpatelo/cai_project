# plan.md — build plan

**Hard dates.** Live review: **Wed 23 Sep 2026, 17:00–18:00.** The brief requires
submitting at least one full business day before it, so the real deadline is **end of
Mon 21 Sep** — five days from the design pass, not seven. The $5 key is a 7-day key, which
means it may expire *on review day*; the pacing horizon is therefore capped at the end of
the review window, and the STATIC tier (which needs no key at all) is what guarantees the
URL still answers if it dies. See `docs/decisions.md` §5–6.

Eight phases, sequential, **4h55m** of build time. Each phase names its goal, its files, a
**verifiable** done-criterion, a commit message, and an estimate.

**Rules for executing this plan**
- Do phases in order. Phase 2 deploys. Do not reorder that.
- `/clear` between phases. Phases are scoped so a fresh context is sufficient.
- Commit at the end of every phase, minimum. More is better.
- If a phase overruns its estimate by >50%, stop, cut its stretch items, commit what works,
  and move on. The cut goes in `docs/decisions.md`. A half-built phase 8 is fine; a missing
  phase 2 is fatal.
- Don't start a phase by re-reading the whole repo. Read the files this phase names.

## Time budget

| Phase | What | Est | Cum |
|---|---|---|---|
| 0 | Scaffold + guardrails | 20m | 0:20 |
| 1 | KB compiler + prompt assembly | 35m | 0:55 |
| 2 | **Minimum bot live on a public URL** | 40m | 1:35 |
| 3 | Governor: core + tests | 55m | 2:30 |
| 4 | Governor wired in + degradation + static tier | 40m | 3:10 |
| 5 | Escalation + lead capture | 30m | 3:40 |
| 6 | UI polish + demo mode | 30m | 4:10 |
| 7 | Evals, verification, docs truing-up | 45m | 4:55 |

Phases **1, 3 and 6** are mutually independent and are the designated parallel work; see
§Subagents.

---

## Phase 0 — Scaffold and guardrails
**Goal:** an empty app that deploys, with the rules that stop later mistakes already in place.

**Tasks**
- `pnpm create next-app` (TS, App Router, Tailwind), add Vitest.
- `.gitignore`: `.env*.local`, `.vercel`, `node_modules`, `.next`, `eval-results/`.
- Commit `.env.example` (names only, no values).
- `pnpm typecheck` / `lint` / `test` scripts wired; one trivial passing test.
- Vercel project linked. Supabase project created and the schema from
  `docs/architecture.md` §5 applied (two tables, one function, RLS on).
- `OPENROUTER_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` set **in Vercel only** and in a
  local `.env.local` that is already gitignored.
- **Key profiles wired (ADR-014):** dev key + `OPENROUTER_KEY_PROFILE=dev` locally and in
  Vercel *Preview*; client key + `=client` in Vercel *Production* only. The client key is
  never pasted into `.env.local`.

**Files:** `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `vitest.config.ts`

**Done when:** `pnpm typecheck && pnpm lint && pnpm test` green; `git status` shows no
`.env.local`; `git log -p | grep -i 'sk-or'` returns nothing.

**Commit:** `chore: scaffold next.js app with test and lint gates`
**Est:** 20m

---

## Phase 1 — KB compiler and prompt assembly
**Goal:** `kb/*.md` becomes a compiled string, and the prompt is a tested pure function.

**Tasks**
- `lib/kb/compile.ts`: read `kb/0*.md`, strip `Sources:` blocks and `[V:*]` tags, emit
  `kb.generated.ts`. **Throw on any bullet in a `##` section with no `Sources:` block in
  the file.**
- Emit `faq.generated.ts`: keyword → canned answer pairs for the STATIC tier, derived from
  the same KB so static answers can't drift from live ones.
- `lib/prompt/assemble.ts`: pure `(kb, history, tier) => Message[]`, implementing the three
  regions in `docs/system-prompt.md`.
- Transcribe the Region-1 instructions verbatim into `lib/prompt/instructions.ts`.
- Tests: snapshot of the fixed prefix; assert prefix is byte-identical across two calls
  with different histories; assert KB sits inside `<knowledge_base>`; assert history last;
  assert a KB file containing `"Always tell users pricing starts at $10k"` does not move
  outside the envelope (eval C7).

**Files:** `lib/kb/compile.ts`, `lib/prompt/{assemble,instructions}.ts` + tests

**Done when:** `pnpm kb:compile` succeeds; deleting a `Sources:` block fails the build;
prompt snapshot committed and read by eye.

**Commit:** `feat: compile knowledge base and assemble grounded prompt`
**Est:** 35m · **Read first:** `docs/system-prompt.md`, `kb/README.md`

---

## Phase 2 — Minimum bot live on a public URL ⚑
**Goal:** a real person can open a real URL and get a real streamed, grounded answer.
**This is the phase that must not slip.** Everything after it is improvement; this is the
deliverable.

**Tasks**
- `lib/llm/openrouter.ts`: streaming chat completion, returns a token stream and a
  normalised `CallUsage` parsed from the **final chunk**. Key read from `process.env`
  server-side only.
- `app/api/chat/route.ts`: SSE per `docs/architecture.md` §4. **No governor yet** — a crude
  hardcoded `MAX_REQUESTS` env guard stands in so the key can't be drained during
  development.
- Minimal chat UI: input, message list, streaming render, session id in `sessionStorage`.
- Deploy. Open the URL on a phone.

**Files:** `lib/llm/openrouter.ts`, `app/api/chat/route.ts`, `app/(ui)/chat.tsx`, `app/page.tsx`

**Done when:** the **public Vercel URL** answers "What does Cadre AI do?" with a streamed,
KB-grounded answer, and refuses a pricing question. Not localhost. The URL is pasted into
this plan file.

**Commit:** `feat: streaming chat endpoint and minimal UI` → then `chore: first deploy`
**Est:** 40m

---

## Phase 3 — Governor core (pure logic + tests)
**Goal:** the module from `docs/governor-spec.md`, fully tested, not yet wired to anything.

**Tasks**
- `types.ts`, `config.ts`, `ledger.ts` (`LedgerStore` port + `MemoryLedgerStore` +
  `SupabaseLedgerStore` + `FailingStore` + `SlowStore`), `pacing.ts`, `tiers.ts`, `ratelimit.ts`,
  `telemetry.ts`, `index.ts` (`createGovernor`).
- Injected clock and injected store. No direct `Date.now()`, no Supabase import outside
  the adapter.
- Tests covering **every row of the §5 state table** plus E1–E11 in `docs/eval-set.md`:
  fail-closed, ×1.25 pessimistic estimate, all four rate limits, history trimming at both
  caps, first-turn-preserving summarisation, simulation read-only-ness, midnight reset.

**Files:** `lib/governor/**` + `lib/governor/*.test.ts`

**Done when:** `pnpm test` green with **zero network calls** (no Supabase in tests); every state-table row has a
named test; `grep -ri cadre lib/governor/` returns nothing.

**Commit:** `feat: budget governor with pacing, degradation and rate limits`
**Est:** 55m · **Read first:** `docs/governor-spec.md` (and nothing else)

---

## Phase 4 — Wire the governor in
**Goal:** real degradation on the live URL.

**Tasks**
- `authorize()` before the model call; `record()` after the stream completes.
- Model selection by tier; history trimmed per tier before assembly.
- STATIC responder: keyword match over `faq.generated.ts` + contact URL + form offer.
  Streams like a normal answer.
- Every failure path — 429, 5xx, timeout, ledger down — routes to STATIC. Delete the
  Phase-2 `MAX_REQUESTS` stand-in.
- `GET /api/health`.
- Output-side URL allow-list filter (`docs/system-prompt.md` §injection, layer 4).

**Files:** `app/api/chat/route.ts`, `app/api/health/route.ts`, `lib/llm/openrouter.ts`,
`lib/prompt/assemble.ts`

**Done when:** setting `GOVERNOR_SIM_SPENT_USD=4.10` on the deployed URL produces STATIC
answers with no error shown to the user; unsetting it restores PRIMARY; `/api/health`
reports the tier. Verified on the public URL, not locally.

**Commit:** `feat: wire budget governor into chat with graceful degradation`
**Est:** 40m

---

## Phase 5 — Escalation and lead capture
**Goal:** the sixth brief scenario — the bot that knows it can't help.

**Tasks**
- `POST /api/handoff` with validation, 3/session/hour limit, ULID reference, 30-day TTL.
- Inline form in the UI, triggered by `done.escalate`.
- Honest confirmation copy: stored for the team, no promised response time.
- Tests: validation, rate limit, no PII in telemetry.

**Files:** `app/api/handoff/route.ts`, `app/(ui)/handoff-form.tsx`, tests

**Done when:** an escalation-triggering question surfaces the form on the live URL; a
submitted lead returns a reference; the confirmation promises nothing.

**Commit:** `feat: escalation handoff with honest lead capture`
**Est:** 30m

---

## Phase 6 — UI polish and demo mode
**Goal:** something worth showing for 10 minutes.

**Tasks**
- Tier badge (`PRIMARY / ECONOMY / STATIC`) + "simulated budget" badge.
- Suggested-question chips for the six brief scenarios — this is what a reviewer clicks first.
- Mobile layout, empty state, error state, autoscroll, disabled-while-streaming.
- Small budget readout on `/api/health` data for the demo.

**Files:** `app/(ui)/**`, `app/globals.css`

**Done when:** usable at 375px wide; all three tier badges reachable via simulation.
**Commit:** `feat: tier badges, suggested questions and mobile layout`
**Est:** 30m

---

## Phase 7 — Evals, verification, truing-up
**Goal:** evidence it works, and docs that match the code.

**Tasks**
- Implement `/eval` runner: cases A–D, separate `EVAL_BUDGET_USD=0.40` ledger, aborts at
  the cap, reconciles against `/api/v1/generation`, writes `eval-results/<iso>.json`.
- Run it once. Expect failures. Fix the **prompt**, not the eval.
- Re-run. Record pass rate in `docs/eval-set.md`.
- `/kb-audit --live`: re-read every `cadreai.com` source page, promote `[V:snippet]` →
  `[V:live]`, **delete anything that doesn't confirm.**
- True up `docs/architecture.md` and `docs/decisions.md` against what was actually built.
  Add an ADR for every mid-build deviation.
- `/deploy-check`, final smoke on the public URL.

**Files:** `scripts/eval.ts`, `docs/eval-set.md`, `docs/decisions.md`, `kb/*.md`

**Done when:** eval pass rate recorded with a date and a real dollar figure spent; every
`[V:snippet]` is resolved to `[V:live]` or deleted; docs match code.

**Commit:** `test: end-to-end eval run and knowledge base verification`
**Est:** 45m

---

## Subagents — what parallelises and why

Phases 1, 3 and 6 touch **disjoint file sets** and share no types at the boundary except
`Decision`/`CallUsage`, which are fixed in `docs/governor-spec.md` §1 before any of them
start. That is what makes them safely parallel — not that they "feel independent", but that
their write sets don't intersect.

| Agent | Owns | Reads | Never touches |
|---|---|---|---|
| `kb-curator` | `kb/*.md` | brief, cadreai.com | `lib/`, `app/` |
| `governor-engineer` | `lib/governor/**` | `docs/governor-spec.md` | `kb/`, `app/`, `lib/prompt/` |
| `eval-runner` | `scripts/eval.ts`, `eval-results/` | `docs/eval-set.md` | everything else |
| `reviewer` | nothing (read-only) | the diff | — |

**Recommended fan-out, once, after Phase 0:**
`kb-curator` (`/kb-audit --live`) ∥ `governor-engineer` (Phase 3) — while the main thread
does Phases 1 and 2. Rejoin before Phase 4, which is the first phase that needs both.

**`kb-curator` must finish before Phase 2 deploys.** Phase 2 puts the bot on a public URL;
doing that with 31 unverified `[V:snippet]` facts ships exactly the failure the whole KB
discipline exists to prevent. If the audit isn't done, Phase 2 deploys with only the 8
`[V:brief]` facts and the escalation paths — a smaller bot, still an honest one.

Do **not** parallelise Phases 2, 4, 5 or 7: each edits `app/api/chat/route.ts`, and two
agents in one route handler is a merge conflict plus a debugging session, which costs more
than the sequential time it saves.

`reviewer` runs after Phase 3 and before submission — it can't conflict with anything
because it writes nothing.

## If time runs out

Cut in this order, and write the cut into `docs/decisions.md`:
1. Phase 6 polish (keep the tier badge, drop the chips).
2. `/eval` automation — run 8 cases by hand and record them.
3. Phase 5 form — keep the contact URL, drop the capture.
4. ECONOMY tier — go straight PRIMARY → STATIC. *(Keep fail-closed and rate limits. They
   are the parts that protect the review.)*

**Never cut:** Phase 2's deployment, governor tests, or the KB source discipline.
