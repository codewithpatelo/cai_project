# CLAUDE.md — Cadre AI support chatbot

Read this before touching anything. It is the contract, not a suggestion.

## What this is

A public support chatbot for **Cadre AI**, a B2B AI strategy and implementation
consultancy. It answers common inbound questions from a curated knowledge base and hands
off to a human when it can't. It runs on a **$5 OpenRouter key that expires in 7 days** and
must stay alive through a live review at the end of that window.

Two properties matter more than any feature:
1. **It never states a Cadre fact that isn't in `kb/`.**
2. **It never runs out of money.**

Everything below exists to protect those two.

## Stack

| | |
|---|---|
| Framework | Next.js 15, App Router, TypeScript strict |
| Host | Vercel (Node runtime, SSE streaming) |
| Store | Supabase Postgres (Pro), via the PostgREST API (never a direct connection) |
| LLM | OpenRouter → `google/gemini-3.8-flash` (primary) / `google/gemini-3.1-flash-lite` (degraded). Pinned ids, never `~latest` aliases |
| UI | Tailwind, no component library |
| Tests | Vitest |
| PM | pnpm |

## Commands

```bash
pnpm dev            # local dev, http://localhost:3000
pnpm test           # unit tests, mocked LLM, ZERO network, ZERO spend
pnpm test:watch
pnpm typecheck      # tsc --noEmit
pnpm lint
pnpm build          # includes kb compile step; fails on unsourced KB bullets
pnpm kb:compile     # kb/*.md -> lib/kb/kb.generated.ts + faq.generated.ts
pnpm eval           # COSTS REAL MONEY. See /eval. Never run unprompted.
```

Custom commands: `/verify` (before commit) · `/eval` (capped spend) · `/deploy-check`
(before/after deploy) · `/kb-audit` (unsourced facts) · `/rca` (root-cause a bug) ·
`/judge` (final score, run last).
Subagents: `kb-curator` · `governor-engineer` · `ui-designer` · `researcher` · `tester` ·
`eval-runner` · `simulated-user` · `reviewer` · `final-judge`. Definitions in `.claude/`.

## Structure

```
kb/*.md                  Facts about Cadre + their sources. THE ONLY place Cadre facts live.
lib/kb/compile.ts        Build-time compiler; fails build on an unsourced bullet.
lib/prompt/assemble.ts   Pure function: fixed prefix + <knowledge_base> + trimmed history.
lib/governor/            Budget/pacing/degradation. DOMAIN-AGNOSTIC. No Cadre strings.
lib/llm/openrouter.ts    The only file that knows OpenRouter exists.
app/api/chat/route.ts    SSE endpoint. Thin orchestration only.
app/api/handoff/route.ts Lead capture.
app/api/health/route.ts  Non-secret status.
app/(ui)/                Presentation.
docs/                    Design docs. principles · architecture · governor-spec ·
                         model-selection · system-prompt · design-system · eval-set ·
                         decisions · demo-script · rubric.
docs/mock/*.dc.html      Reference UI mocks. Build to these; don't reinterpret them.
```

## How we work

`docs/principles.md` is the long form. The short form:

- **Spec-driven.** Every phase in `plan.md` carries a user story, use cases, acceptance
  criteria and test cases. Build to them. **If a spec is wrong, fix the spec first** — never
  leave code and plan disagreeing.
- **No overengineering. Occam's razor.** Simplest thing that is *correct* — both tests.
  No abstraction until the second real caller. No dependency for a 20-line function.
- **Clarity over cleverness.** The reviewer will ask what a specific function does.
- **UX-focused.** Value lands on the user's side, or it isn't a feature.
- **Research before inventing.** Non-trivial problem → find how the industry solves it
  (`researcher` subagent), cite it with a URL and a date, then add judgement on top.
  Don't reinvent the wheel badly.
- **Root cause, not symptom** (`/rca`). No empty catch, no skipped test, no retry around
  a race.
- **UI needs a mock first.** `docs/mock/` and `docs/design-system.md` are the spec. A new
  screen or state gets a mock from `ui-designer` before it gets code.

## Hard rules — violating any of these means the change is wrong

1. **Keys live only in Vercel env vars and a local `.env.local`.**
   Never in the repo, never in git history, never in a log line, never in a client bundle,
   never in a `NEXT_PUBLIC_*` variable, never in an error message, never in a test fixture.
   `.env.local` is gitignored — verify before every commit, not after.
   **Two OpenRouter keys (ADR-014): dev and client.** The client's $5/7-day key
   **cannot be regenerated** and is set only in Vercel *Production*. Local and preview run
   the dev key. Never paste the client key into `.env.local`.
2. **Never invent a Cadre fact.** No URL, price, person, client, certification, SLA,
   pillar name, or capability that isn't in `kb/` with a source. If you find yourself
   writing a plausible cadreai.com URL, stop: that is the exact bug this product exists to
   prevent. When in doubt the answer is a handoff, and a handoff is a correct answer.
3. **Governor tests are mandatory and may not be skipped.** No `.skip`, no `.only`, no
   "I'll add tests after". The governor is the reason the demo still works on review day;
   an untested ceiling is not a ceiling. `pnpm test` green is a precondition for commit.
4. **`lib/governor/**` contains no domain knowledge.** No "Cadre", no "chatbot", no KB
   import. It is a reusable module that happens to live here. Grep before you commit.
5. **Never log user message text.** Not in telemetry, not in debug, not temporarily.
   `CallUsage` has no field that can hold it; don't add one.
6. **Small commits, imperative messages, one concern each.** A commit that touches the
   governor and the UI is two commits. The reviewer reads this history.
7. **Fail closed.** If the governor can't account for spend, it doesn't call the model.
   No timeout-and-proceed, no "probably fine", no in-process fallback counter.
8. **Real-model calls run on the dev key.** `pnpm eval` and any manual probing must have
   `OPENROUTER_KEY_PROFILE=dev`. Spending the client's $5 is reserved for real visitors and
   the live review — check the profile before you run, not after.
9. **Don't change scope on your own.** The IN/OUT/LATER table in `docs/architecture.md` is
   decided. If something seems missing, say so; don't build it.

## Conventions

- TypeScript strict. No `any`. No non-null `!` — narrow properly.
- Pure functions for anything testable; I/O only at the edges (route handlers, adapters).
- Ports and adapters for external state: `LedgerStore` is an interface, Supabase is one
  implementation, memory is another. Tests use memory. Swapping the store must touch the
  adapter and config only — if it reaches into `lib/governor/`, the port is leaking.
- Errors: typed result objects across module boundaries, not thrown strings.
  **The user never sees a raw error** — everything degrades to the STATIC tier.
- Named exports. No default exports except Next.js pages/routes.
- Tests colocated: `foo.ts` → `foo.test.ts`.
- Comments explain *why*. Don't narrate what the code already says.

## How to verify your own work

Before you say something is done:

1. `pnpm typecheck && pnpm lint && pnpm test` — all green.
2. Read the diff yourself. If you can't explain a line, it doesn't ship.
3. Touched prompt assembly? Re-read the snapshot by eye. Don't `-u` your way past it.
4. Touched `kb/`? Run `/kb-audit`.
5. Touched the governor? Walk the §5 state table in `docs/governor-spec.md` and confirm a
   test covers each row you affected.
6. Run `/verify` and complete the checklist in `docs/eval-set.md`. Actually complete it.

**Before submission, run `/judge`.** It scores the project against Cadre's own five weighted
dimensions with observable criteria (`docs/rubric.md`), reports the gate failures first, and
names the three things costing the most points. It grades what exists, not what's planned —
so run it once everything is deployed, not while a phase is half-built.

## What NOT to do

- Don't add a dependency to solve something a 20-line function solves.
- Don't introduce RAG, a vector store, or embeddings. Decided against with numbers in
  `docs/model-selection.md` §6.
- Don't add auth, user accounts, or conversation persistence. Explicitly OUT.
- Don't store transcripts, IPs, or any PII beyond a lead the user deliberately submitted.
- Don't "improve" the system prompt ad hoc. It is specified in `docs/system-prompt.md`;
  change that file and the evals together, in one commit.
- Don't refactor across phase boundaries. Finish the phase, commit, then refactor.
- Don't make the bot apologise more. Terse and honest beats deferential.
- Don't build an admin dashboard, a settings page, or a theme switcher.
- Don't mock the governor in integration tests — use `MemoryLedgerStore`. Mocking the thing
  under test is how a broken ceiling passes CI.

## Context management

- **Always loaded:** this file. Keep it under ~250 lines; it is read on every turn.
- **Load on demand, never preemptively:**
  `docs/governor-spec.md` when working in `lib/governor/` ·
  `docs/system-prompt.md` when working on prompt assembly ·
  `docs/eval-set.md` when writing or running tests ·
  `docs/model-selection.md` only when budget numbers change ·
  `docs/design-system.md` + `docs/mock/*` when building UI ·
  `docs/principles.md` when a judgement call isn't covered by the rules ·
  `kb/*.md` only when editing the KB.
- **Never load the whole `docs/` directory.** It is ~40k tokens and you need one file.
- `/clear` between phases in `plan.md`. Phases are designed to be independent for exactly
  this reason — a fresh context per phase is cheaper and more accurate than a long one.
- `/compact` only mid-phase, when a debugging loop has filled context with tool output.
- Handing work to a subagent? Give it the phase goal, its file list, and its done-criteria
  from `plan.md`. Never paste the whole plan — subagents are for *narrowing* context, and a
  subagent with full context is just a slower main agent.

## Known AI failure modes on this project

Things Claude has gotten wrong here before. Check these specifically:

- **Inventing cadreai.com URLs** — `portal.cadreai.com`, `/login`, `/book`, `/maturity-index`.
  All fabricated. Only URLs with a `Sources:` line exist.
- **Padding the AI Maturity Index to eight pillars.** We have four names. Four.
- **Inventing OpenRouter API field names.** Verify against the docs cited in
  `docs/governor-spec.md` §2 before relying on a field.
- **Quietly weakening fail-closed** into "log a warning and continue" because it's more
  ergonomic. It isn't a bug to be fixed; it's the requirement.
- **Adding a helpful price range** because the answer felt unhelpful without one.
- **Announcing every streamed token to the live region.** The intuitive approach floods a
  screen reader. Stream silently, announce the finished message once
  (`docs/design-system.md`).
- **Building a UI state that has no mock**, then calling the mock wrong when they differ.
