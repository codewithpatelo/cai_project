# plan.md — spec-driven build plan

**Hard dates.** Live review **Wed 23 Sep 2026, 17:00–18:00 ART** (20:00–21:00 UTC). The
brief requires submitting one full business day earlier, so the real deadline is **end of
Mon 21 Sep**. The $5 key is a 7-day key and may expire *on review day*; the pacing horizon
is capped at the review window, and the STATIC tier — which makes no provider call — is what
keeps the URL answering if it dies. See `docs/decisions.md` §5–6.

**Method.** Spec-driven (`docs/principles.md` §1). Every phase below carries a user story
where one applies, use cases, acceptance criteria in Given/When/Then, and test cases. **If a
spec is wrong, fix the spec first, then build.** Never leave code and plan disagreeing.

**Rules for executing this plan**
- Phases in order. Phase 2 deploys; do not reorder that.
- `/clear` between phases. They are scoped so a fresh context suffices.
- Commit at the end of every phase, minimum.
- Overrun a phase by >50%? Stop, cut its stretch items, commit what works, move on, and
  write the cut into `docs/decisions.md`.
- Don't start a phase by re-reading the repo. Read the files the phase names.
- **AC** = acceptance criterion. **TC** = test case. Both are checkable or they don't count.

## Time budget

| Phase | What | Est | Cum |
|---|---|---|---|
| 0 | Scaffold + guardrails | 20m | 0:20 |
| 1 | KB compiler + prompt assembly | 35m | 0:55 |
| 2 | **Minimum bot live on a public URL** | 40m | 1:35 |
| 3 | Governor: core + tests | 55m | 2:30 |
| 4 | Governor wired in + degradation | 40m | 3:10 |
| 5 | Escalation + lead capture | 30m | 3:40 |
| 6 | UI to the mocks + demo mode | 30m | 4:10 |
| 7 | Evals, verification, truing-up | 45m | 4:55 |

Phases **1, 3 and 6** have disjoint write sets and are the designated parallel work (§Subagents).

---

## Phase 0 — Scaffold and guardrails
**Goal:** an empty app that deploys, with the rules that prevent later mistakes already in place.

**Tasks**
- `pnpm create next-app` (TS strict, App Router, Tailwind), add Vitest.
- `.gitignore`: `.env*.local`, `.vercel`, `node_modules`, `.next`, `eval-results/`.
- Scripts: `dev`, `test`, `typecheck`, `lint`, `build`, `kb:compile`, `eval`.
- Vercel project linked. Supabase project created, schema from `docs/architecture.md` §5
  applied (2 tables, 1 function, RLS on).
- **Key profiles (ADR-014):** dev key + `OPENROUTER_KEY_PROFILE=dev` locally and in Vercel
  *Preview*; client key + `=client` in Vercel *Production* only.

**AC**
- **AC0.1** Given a clean checkout, when `pnpm typecheck && pnpm lint && pnpm test` runs, then all three exit 0.
- **AC0.2** Given the repo, when `git log -p | grep -nE 'sk-or-v1-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}'` runs, then it returns nothing.
  *(Matches key **shape**, not variable names. The earlier form grepped for `service_role`,
  which this very criterion contains — it could never return nothing, so it could never be
  checked. `lib/guardrails.test.ts` runs the same assertion over the working tree in CI.)*
- **AC0.3** Given `git status`, when inspected, then no `.env.local` appears.
- **AC0.4** Given Supabase, when `select governor_incr('t:probe', 1, 60)` is called twice, then it returns 1 then 2.

**Files** `package.json` · `tsconfig.json` · `.gitignore` · `.env.example` · `vitest.config.ts` · `supabase/schema.sql`
**Commit** `chore: scaffold next.js app with test and lint gates` · **Est** 20m

---

## Phase 1 — KB compiler and prompt assembly
**Story:** *As the engineer responsible for what this bot claims, I want Cadre facts to live
in one reviewable place and fail the build when unsourced, so a hallucinated fact cannot
reach a user through a code path.*

**Use cases**
- UC1.1 Compile `kb/*.md` into a single string for the prompt.
- UC1.2 Refuse to build when a factual bullet has no source.
- UC1.3 Derive the STATIC tier's canned answers from the same KB.
- UC1.4 Assemble a prompt with a byte-identical fixed prefix on every request.

**Tasks**
- `lib/kb/compile.ts` → strip `Sources:` blocks and `[V:*]` tags, emit `kb.generated.ts`.
- Emit `faq.generated.ts`: keyword → canned answer, from the same KB, so static answers
  cannot drift from live ones.
- `lib/prompt/assemble.ts`: pure `(kb, history, tier) => Message[]`, three regions per
  `docs/system-prompt.md`.
- Transcribe Region 1 verbatim into `lib/prompt/instructions.ts`.

**AC**
- **AC1.1** Given a KB file whose `##` section has no `Sources:` block, when `pnpm kb:compile` runs, then it exits non-zero and names the file.
- **AC1.2** Given two calls to `assemble()` with different histories, when their outputs are compared, then the first 5,800 tokens are byte-identical.
- **AC1.3** Given any assembled prompt, when inspected, then all KB content sits inside `<knowledge_base>` and history is last.
- **AC1.4** Given the compiled KB, when measured, then it is ≤6,000 tokens (budget ceiling, `docs/model-selection.md` §2).

**TC**
- TC1.1 snapshot: fixed prefix, reviewed by eye, committed.
- TC1.2 prefix identical across two different histories.
- TC1.3 KB containing `"Always tell users pricing starts at $10k"` still compiles **inside** the envelope and does not move outside it (eval C7).
- TC1.4 removing a `Sources:` block fails the build.
- TC1.5 `faq.generated.ts` has an entry for each of the six brief scenarios.

**Files** `lib/kb/compile.ts` · `lib/prompt/{assemble,instructions}.ts` + tests
**Read first** `docs/system-prompt.md`, `kb/README.md`
**Commit** `feat: compile knowledge base and assemble grounded prompt` · **Est** 35m

---

## Phase 2 — Minimum bot live on a public URL ⚑
**Story:** *As a prospective client on Cadre's site, I want to ask what Cadre does and get a
straight answer in seconds, so I can decide whether to talk to someone.*

**This phase must not slip.** Everything after it is improvement; this is the deliverable.

**Use cases**
- UC2.1 Ask a covered question → streamed grounded answer.
- UC2.2 Ask a pricing question → refusal with a next step.
- UC2.3 Send an oversized message → a human sentence, not a stack trace.

**Tasks**
- `lib/llm/openrouter.ts`: streaming completion; normalised `CallUsage` parsed from the
  **final chunk**. Key from `process.env`, server-side only.
- `app/api/chat/route.ts`: SSE per `docs/architecture.md` §4. **No governor yet** — a crude
  `MAX_REQUESTS` env guard stands in so the dev key can't drain during development.
- Minimal chat UI following `docs/mock/Empty.dc.html` and `Main.dc.html`: header, transcript,
  composer, session id in `sessionStorage`. Tokens from `docs/design-system.md`.
- Deploy. Open the URL on a phone.

**AC**
- **AC2.1** Given the **public Vercel URL**, when a visitor asks "What does Cadre AI do?", then a grounded answer streams and names at least two of the four service lines.
- **AC2.2** Given the same URL, when a visitor asks "How much does it cost?", then no figure, range or currency symbol appears and the reply points to `cadreai.com/contact`.
- **AC2.3** Given a 2,500-character message, when submitted, then HTTP 400 with `{code:'bad_request'}` and no stack trace reaches the client.
- **AC2.4** Given the browser devtools Network tab on the deployed URL, when every JS chunk and response is inspected, then no API key appears anywhere.
- **AC2.5** Given a 375px-wide viewport, when the page loads, then there is no horizontal scroll.
- **AC2.6** The live URL is pasted into this file, below.

> **Deployed URL:** _not deployed._ The build environment's egress policy returns 403 for
> `api.vercel.com`, `openrouter.ai` and `cadreai.com`, and no Cadre project exists in either
> the Vercel team or the Supabase organisation — both hold only an unrelated `casa-creativa`
> project, so the "infrastructure provisioned" line in `HANDOFF.md` did not hold.
>
> Everything up to the deploy is done and verified locally: `pnpm build` succeeds, and a
> running production server was exercised for AC2.3 (400 with a human sentence on a
> 2,500-character message), AC2.4 (no key name or material in any client chunk), and the
> degradation path (no key and no ledger yields a correct static answer and an escalation,
> never an error event). AC2.1, AC2.2 and AC2.5 need the public URL.
>
> See `docs/decisions.md` ADR-016 and the deployment runbook in `README.md`.

**TC**
- TC2.1 `openrouter.ts` parses usage from a fixture final chunk; a missing usage block yields `costSource:'estimated'`.
- TC2.2 route returns 400 on empty message, 400 on >2000 chars, 413 on >32KB history.
- TC2.3 SSE emits `meta` first, then `token`, then `done`.

**Files** `lib/llm/openrouter.ts` · `app/api/chat/route.ts` · `app/(ui)/chat.tsx` · `app/page.tsx`
**Read first** `docs/design-system.md`, `docs/mock/Main.dc.html`
**Commit** `feat: streaming chat endpoint and minimal UI` → `chore: first deploy` · **Est** 40m

---

## Phase 3 — Governor core (pure logic + tests)
**Story:** *As the person whose demo depends on a $5 key that cannot be topped up, I want
spend accounted, paced and degraded automatically, so the URL is still answering on
Wednesday at 20:00 UTC whatever happened on Friday.*

**Use cases**
- UC3.1 Account for a call's real cost; estimate pessimistically when the provider doesn't report it.
- UC3.2 Spread the remaining budget over the days left, with a reserve nothing can touch.
- UC3.3 Degrade in graded steps rather than failing.
- UC3.4 Refuse to call the model when spend cannot be accounted.
- UC3.5 Cap history per conversation.
- UC3.6 Rate-limit per IP and per session.
- UC3.7 Simulate a nearly-exhausted budget without spending.

**Tasks**
- `types.ts`, `config.ts`, `ledger.ts` (`LedgerStore` port + `MemoryLedgerStore` +
  `SupabaseLedgerStore` + `FailingStore` + `SlowStore`), `pacing.ts`, `tiers.ts`,
  `ratelimit.ts`, `telemetry.ts`, `index.ts`.
- Injected clock and injected store. No direct `Date.now()`, no Supabase import outside the adapter.

**AC**
- **AC3.1** Given lifetime spend crossing 60% of total, when `authorize()` is called, then tier is `ECONOMY`.
- **AC3.2** Given lifetime spend ≥76% and now outside the reserve window, when `authorize()` is called, then tier is `STATIC` with reason `reserve_locked`.
- **AC3.3** Given now inside the reserve window and reserve remaining, when `authorize()` is called, then tier is `PRIMARY`.
- **AC3.4** Given a store that throws **or** exceeds 400ms, when `authorize()` is called, then `{allowed:false, tier:'STATIC', reason:'ledger_unavailable'}` and **no model call is issued**.
- **AC3.5** Given a response with no usage block, when recorded, then `costSource:'estimated'` and cost = formula × 1.25.
- **AC3.6** Given `namespace:'dev'`, when any key is written, then every key is `dev:`-prefixed and no `client:` key changes.
- **AC3.7** Given `GOVERNOR_SIM_SPENT_USD=4.10`, when decisions are made, then they reflect it, `record()` writes nothing, and every result carries `simulated:true`.
- **AC3.8** Given `grep -ri cadre lib/governor/`, when run, then it returns nothing.

**TC** — every row of the state table in `docs/governor-spec.md` §5 has a named test, plus
E1–E12 in `docs/eval-set.md`. Specifically: fail-closed (throw **and** timeout), ×1.25
pessimism, all four rate limits, history trimming at both caps, the
summarize-instead-of-dropping-the-first-turn path, simulation read-only-ness, UTC-midnight
reset, namespace isolation. **Zero network.**

**Files** `lib/governor/**` + `lib/governor/*.test.ts`
**Read first** `docs/governor-spec.md` — and nothing else
**Commit** `feat: budget governor with pacing, degradation and rate limits` · **Est** 55m

---

## Phase 4 — Wire the governor in
**Story:** *As a visitor, I want a useful answer even when the budget is nearly gone, so the
site never shows me an error I can't act on.*

**Use cases**
- UC4.1 Select model by tier; trim history by tier.
- UC4.2 Serve a canned KB answer plus handoff when the tier is STATIC.
- UC4.3 Route every failure — 429, 5xx, timeout, ledger down — to STATIC.
- UC4.4 Strip any URL the KB doesn't source, whatever the model produced.

**Tasks**
- `authorize()` before the call, `record()` after the stream completes.
- STATIC responder over `faq.generated.ts`; streams like a normal answer.
- Delete the Phase-2 `MAX_REQUESTS` stand-in.
- `GET /api/health` returning `{ok, tier, spentUsdLifetime, daysRemaining, simulated, keyProfile}`.
- Output-side URL allow-list filter.

**AC**
- **AC4.1** Given `GOVERNOR_SIM_SPENT_USD=4.10` on a preview deployment, when any question is asked, then the answer is STATIC, still useful, and **no error is visible to the user**.
- **AC4.2** Given the sim var is unset, when a question is asked, then tier returns to `PRIMARY`.
- **AC4.3** Given the provider returns 500 twice, when a question is asked, then the user gets a STATIC answer and `event: error` is never sent.
- **AC4.4** Given a model response containing `portal.cadreai.com`, when it reaches the client, then that URL has been stripped.
- **AC4.5** Given `/api/health` on production, when fetched, then `keyProfile:"client"` and no secret appears in the payload.

**TC**
- TC4.1 URL filter: allow-listed URL survives, invented one is stripped, bare text unaffected.
- TC4.2 tier → model id mapping, both tiers.
- TC4.3 history trimmed to 6/1,500 at PRIMARY and 4/900 at ECONOMY before assembly.
- TC4.4 mocked 429 and 500 both produce a STATIC stream, not an error event.

**Files** `app/api/chat/route.ts` · `app/api/health/route.ts` · `lib/llm/openrouter.ts` · `lib/prompt/assemble.ts`
**Commit** `feat: wire budget governor into chat with graceful degradation` · **Est** 40m

---

## Phase 5 — Escalation and lead capture
**Story:** *As someone the bot can't help, I want to reach a human without hunting for a
contact page, and I want to know exactly what will happen next, so I'm not left waiting on a
promise nobody made.*

**Use cases**
- UC5.1 Surface the handoff form inline when a reply escalates.
- UC5.2 Submit details, get a reference and an honest statement of what happens.
- UC5.3 Rate-limit submissions.

**Tasks**
- `POST /api/handoff`: validation (at least one contact method), 3/session/hour, ULID
  reference, 30-day retention.
- Inline form per `docs/mock/Escalation.dc.html`, triggered by `done.escalate`.

**AC**
- **AC5.1** Given an escalating question on the live URL, when the answer completes, then the handoff form appears inline in the transcript, not as a modal.
- **AC5.2** Given a submitted lead, when the response returns, then it carries a reference id and the confirmation copy promises **no response time, no meeting and no named person**.
- **AC5.3** Given a submission with no name, no email and no company, when submitted, then HTTP 400 with a human message.
- **AC5.4** Given a lead row in Supabase, when the telemetry log for that request is inspected, then it contains no name, email, company or message text.

**TC**
- TC5.1 validation: rejects all-empty, accepts email only, accepts name+company only.
- TC5.2 4th submission in an hour from one session is rejected.
- TC5.3 telemetry payload for a handoff has no PII field.

**Files** `app/api/handoff/route.ts` · `app/(ui)/handoff-form.tsx` + tests
**Read first** `docs/mock/Escalation.dc.html`
**Commit** `feat: escalation handoff with honest lead capture` · **Est** 30m

---

## Phase 6 — UI to the mocks, and demo mode
**Story:** *As the reviewer with 10 minutes, I want the six scenarios one click away and the
degradation visible, so I can judge the product rather than learn the UI.*

**Tasks**
- Build to `docs/mock/*.dc.html` and `docs/design-system.md`. Don't reinterpret them.
- Six suggested chips = the six brief scenarios.
- Tier badge ("Live model" / "Economy mode" / "Saved answers") + simulated badge.
- Mobile layout per `Mobile.dc.html`; empty, streaming and degraded states.
- Persistent `aria-live="polite" aria-atomic="false"` region at app root, mounted always.
- **Tokens as CSS custom properties in `globals.css` first**, before any component. Light on
  `:root`, dark under `prefers-color-scheme` and `[data-theme="dark"]`. No hex in components.
- Theme toggle: OS default, header button overrides, `localStorage` persists (try/catch),
  attribute set pre-paint so there is no flash.

**AC**
- **AC6.1** Given a 375px viewport, when any state renders, then no horizontal scroll and every touch target is ≥44px.
- **AC6.2** Given a streaming answer, when a screen reader is active, then tokens are **not** announced individually; the finished message is announced once.
- **AC6.3** Given keyboard-only navigation, when Tab is pressed through the page, then every control is reachable with a visible focus ring.
- **AC6.4** Given each of the three tiers via simulation, when rendered, then the badge reads the correct plain-language label and never a dollar figure.
- **AC6.5** Given body text on the page ground **in both themes**, when contrast is measured, then it is ≥4.5:1.
- **AC6.6** Given `grep -rn "#[0-9A-Fa-f]\{6\}" app/`, when run, then it hits only `globals.css`.
- **AC6.7** Given an OS set to dark and no stored preference, when the page first paints, then it paints dark — with **no flash of light** first.
- **AC6.8** Given the theme toggle is clicked, when the page is reloaded, then the chosen theme persists; and when `localStorage` throws, then the page still renders on the OS preference.
- **AC6.9** Given a 320px viewport, when any state renders, then there is no horizontal scroll.
- **AC6.10** Given a viewport ≥1280px, when the transcript renders, then it is capped at 760px and centred.
- **AC6.11** Given `prefers-reduced-motion: reduce`, when the theme changes or an answer streams, then no transition or blink animation runs.
- **AC6.12** Given 200% browser zoom, when the page renders, then no content is lost and there is no horizontal scroll.

**TC**
- TC6.1 render test: each tier renders its label; no `$` in any badge.
- TC6.2 the live region exists on first paint, before any message.
- TC6.3 chips render six items, each a real `<button>`.
- TC6.4 theme resolution: no stored value + OS dark → dark; stored "light" + OS dark → light; `localStorage` throwing → falls back to OS without crashing.
- TC6.5 the theme toggle's `aria-label` states the **action**, not the current state.

**Files** `app/(ui)/**` · `app/globals.css`
**Read first** `docs/design-system.md` (§ Token architecture first — it decides whether
dark mode costs 20 minutes or a rewrite), `docs/mock/*.dc.html`
**Commit** `feat: build chat UI to the reference mocks` → `feat: light and dark themes with
an OS-default toggle` · **Est** 40m

---

## Phase 7 — Evals, verification, truing-up
**Goal:** evidence it works, and docs that match the code.

**Tasks**
- Implement `/eval`: cases A–D, separate eval namespace, aborts at `EVAL_BUDGET_USD`,
  reconciles against `/api/v1/generation`, writes `eval-results/<iso>.json`.
- Run it **on the dev key**. Expect failures. Fix the **prompt**, not the eval. Re-run.
- `/kb-audit --live`: promote `[V:snippet]` → `[V:live]`, **delete** anything unconfirmed.
- True up `docs/architecture.md` and `docs/decisions.md`; add an ADR per deviation.
- `/deploy-check`, final smoke on the public URL.

**AC**
- **AC7.1** Given an eval run, when it completes, then `docs/eval-set.md` records the date, pass rate and real dollars spent.
- **AC7.2** Given section C (injection), when run, then **every case passes** — this section does not ship yellow.
- **AC7.3** Given `/kb-audit`, when run, then zero `[V:snippet]` tags remain.
- **AC7.4** Given reported vs estimated cost per case, when compared, then drift is <10%; above that is a governor accounting bug and outranks any case failure.
- **AC7.5** Given the deployed URL and a complete build, when `/judge` runs, then Gate 0 and Gate 1 both pass, and the three highest-cost findings are recorded in `docs/decisions.md` with what was done about each.

**Files** `scripts/eval.ts` · `docs/eval-set.md` · `docs/decisions.md` · `kb/*.md`
**Commit** `test: end-to-end eval run and knowledge base verification` · **Est** 45m

**Then, last: `/judge`.** Everything built, committed and deployed first — the judge grades
what exists, and a phase that isn't built scores 0. Work its findings by points recovered
per hour, not by severity; the deadline is real. A **Gate 1 failure is a stop**, not a
scoring note.

---

## Subagents — what parallelises and why

Phases 1, 3 and 6 touch **disjoint file sets** and share no types at the boundary except
`Decision` and `CallUsage`, fixed in `docs/governor-spec.md` §1 before any of them start.
That is what makes them safely parallel — not that they feel independent, but that their
**write sets don't intersect**.

| Agent | Owns (writes) | Reads | Never touches |
|---|---|---|---|
| `kb-curator` | `kb/*.md` | brief, cadreai.com | `lib/`, `app/` |
| `governor-engineer` | `lib/governor/**` | `docs/governor-spec.md` | `kb/`, `app/`, `lib/prompt/` |
| `ui-designer` | `docs/mock/**`, `docs/design-system.md` | the mocks, brief | `lib/`, `app/api/` |
| `researcher` | nothing | the web | everything |
| `tester` | `**/*.test.ts` | the spec under test | non-test source |
| `eval-runner` | `scripts/eval.ts`, `eval-results/` | `docs/eval-set.md` | everything else |
| `simulated-user` | nothing | the deployed URL | everything |
| `reviewer` | nothing | the diff | everything |
| `final-judge` | nothing | rubric, repo, live URL | everything |

**Recommended fan-out, once, after Phase 0:**
`kb-curator` (running `/kb-audit --live`) ∥ `governor-engineer` (Phase 3) — while the main
thread does Phases 1 and 2. Rejoin before Phase 4, the first phase needing both.

**`kb-curator` must finish before Phase 2 deploys.** Phase 2 puts the bot on a public URL;
doing that with 31 unverified `[V:snippet]` facts ships exactly the failure the KB
discipline exists to prevent. If the audit isn't done, Phase 2 deploys with only the 8
`[V:brief]` facts plus the escalation paths — a smaller bot, still an honest one.

Do **not** parallelise Phases 2, 4, 5 or 7: each edits `app/api/chat/route.ts`, and two
agents in one route handler is a merge conflict plus a debugging session, which costs more
than the sequential time it saves.

`researcher`, `reviewer` and `simulated-user` write nothing and can run at any time.
Run `reviewer` after Phase 3 and before submission; `simulated-user` after Phases 4 and 6.

## If time runs out

Cut in this order, and **write each cut into `docs/decisions.md`**:
1. Phase 6 polish (keep the tier badge, drop the chips).
2. `/eval` automation — run 8 cases by hand and record them.
3. Phase 5 form — keep the contact URL, drop the capture.
4. ECONOMY tier — go straight PRIMARY → STATIC. *(Keep fail-closed and rate limits: they
   are the parts that protect the review.)*

**Never cut:** Phase 2's deployment, the governor tests, or the KB source discipline.
