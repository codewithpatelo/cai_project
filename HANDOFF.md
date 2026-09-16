# HANDOFF — design → build

You are picking up a **completed, spec-driven design package** with **zero application code
written**. Your job is to execute `plan.md`. This file says where things stand, how we work,
and the three things that will bite you. It is short on purpose.

**Read in this order:** `CLAUDE.md` → `docs/principles.md` → `plan.md` → this file → then the
one doc your current phase names. Do **not** read all of `docs/` up front; it is ~55k tokens
and each phase needs one or two files. The loading policy in `CLAUDE.md` § Context management
is real advice, not decoration.

---

## Hard dates — the tightest constraint on the project

| | |
|---|---|
| Live review | **Wed 23 Sep 2026, 17:00–18:00 ART** (= 20:00–21:00 UTC) |
| **Submission deadline** | **end of Mon 21 Sep 2026** — the brief requires one full business day before the review |
| Client key lifetime | $5, 7 days, **cannot be regenerated** |
| Build budget | ~5 hours across 8 phases |

The deadline is the 21st, not the 23rd.

A $5/7-day key issued around 16 Sep **expires on or near review day**. Confirm the real
expiry before deploying. If it lands before the review window the $1.20 reserve is worthless,
and the honest plan is to demo the STATIC tier deliberately — which still answers all six
brief scenarios, because STATIC makes no provider call at all.

---

## How we work

`docs/principles.md` in full. What it changes about your day:

- **Spec-driven.** Every phase in `plan.md` has a **user story**, **use cases**,
  **acceptance criteria** (Given/When/Then) and **test cases**. Build to them. A phase isn't
  done until every AC is demonstrably met. **If a spec is wrong, fix the spec first** — never
  leave code and plan disagreeing.
- **No overengineering, Occam's razor, clarity over cleverness, UX-focused.** Simplest thing
  that is *correct*. No abstraction until the second real caller.
- **Research before inventing.** Hit something non-trivial → run the `researcher` subagent,
  find how the industry already solves it, cite it with a URL and a date, then add judgement.
  This already caught two things in design that intuition got backwards (below).
- **Root cause, not symptom.** Bug → `/rca`. No empty catch, no `.skip`, no retry around a
  race, no widened type.
- **UI needs a mock first.** `docs/mock/*.dc.html` + `docs/design-system.md` are the spec.
  New screen or state → `ui-designer` mocks it before anyone writes JSX.

---

## State

**Done — 12 commits, pushed, branch `claude/cadre-ai-chatbot-design-olwwtw`:**
`CLAUDE.md`, `plan.md` (spec-driven, 8 phases), 10 docs, 5 UI mocks, 10 KB files,
9 subagents, 6 custom commands, `.env.example`. **14 ADRs** with the reasoning behind every
non-obvious choice, and `docs/rubric.md` — the scorecard this will be graded against.

**Not done:** all 8 phases. Nothing in `lib/`, `app/` or `package.json` exists.

**Infrastructure:** Vercel ✅ · Supabase Pro ✅ · dev OpenRouter key ✅ ·
client $5 key — held by the person who handed you this.

**UI mocks:** `docs/mock/` in the repo, and on the design canvas at
https://claude.ai/artifact/XwBipyEkXugLfJ66Wmx1as — empty state, streaming answer,
escalation + handoff form, STATIC tier, mobile.

---

## The three things that will bite you

### 1. Two OpenRouter keys. Never mix them. (ADR-014)

```
local + Vercel Preview  →  dev key     OPENROUTER_KEY_PROFILE=dev
Vercel Production only  →  client key  OPENROUTER_KEY_PROFILE=client
```

The client key **cannot be regenerated**. Every eval run, debugging loop and preview deploy
uses the **dev** key. The profile also sets the governor's ledger `namespace`, so dev spend
physically cannot move the client's pacing curve or degradation tier — that isolation is in
the database key, not in your memory.

**The specific mistake:** a preview deployment left on the client key. It drains $5 silently
and there is no undo. `/deploy-check` catches it; run it.

If you are ever about to paste the client key into `.env.local`, stop.

### 2. Thirty-one KB facts are unverified — this blocks Phase 2

`kb/` holds **8 `[V:brief]` · 31 `[V:snippet]` · 0 `[V:live]`**.

The design pass ran where the egress proxy **blocked `cadreai.com`**, so those 31 facts came
from search extracts of real cadreai.com pages, not from reading them. Plausible and sourced,
but unconfirmed.

**Run `/kb-audit --live` before Phase 2 deploys.** Phase 2 puts the bot on a public URL;
doing that with unverified facts ships exactly the failure the KB discipline exists to
prevent. Anything that doesn't confirm gets **deleted, not softened**. Expect the KB to
shrink — that is the mechanism working.

If the audit can't run, Phase 2 still deploys on the 8 `[V:brief]` facts plus the escalation
paths. A smaller honest bot beats a larger confident one.

### 3. Fail-closed is the requirement, not a rough edge

If the governor can't read or estimate spend, **it does not call the model** — no
timeout-and-proceed, no warn-and-continue, no in-process fallback counter. This will feel
awkward to implement. The awkwardness is the requirement working.

It's in `CLAUDE.md` § Known AI failure modes because quietly softening it into "log a warning
and continue" is the most likely regression in the repo, and it is invisible in a passing
test suite.

---

## Where to start

**Phases 0 → 1 → 2, in order.** Phase 2 gets a working bot on a public URL at ~1h35m. Don't
reorder that; deploy-early is the highest-value line in the plan.

After Phase 0, fan out: `kb-curator` (`/kb-audit --live`) ∥ `governor-engineer` (Phase 3)
while you do Phases 1–2. Disjoint **write sets** — that's *why* they parallelise, not because
they feel independent. Phases 2, 4, 5 and 7 all edit `app/api/chat/route.ts` and stay
sequential.

`/clear` between phases.

### Your subagents

| Agent | Use it when |
|---|---|
| `researcher` | Any non-trivial decision, **before** designing |
| `ui-designer` | A screen or state has no mock |
| `governor-engineer` | Anything inside `lib/governor/` |
| `kb-curator` | Any Cadre fact, and `/kb-audit --live` |
| `tester` | After a phase's code exists — writes tests from the AC, not the code |
| `simulated-user` | After Phases 4 and 6 — finds what assertions can't |
| `eval-runner` | Only when asked. Spends money |
| `reviewer` | After Phase 3, and before submission |
| `final-judge` | **Last, via `/judge`** — scores against Cadre's own five weighted dimensions |

`researcher`, `reviewer` and `simulated-user` write nothing and can run any time.

---

## Already decided — do not re-litigate

Each has an ADR. If you think one is wrong, say so; don't quietly rebuild it.

| Decision | Where |
|---|---|
| Next.js on Vercel | ADR-001 |
| Supabase Postgres over PostgREST, never a direct connection | ADR-002 |
| **No RAG.** Whole KB (4,700 tok) in context | ADR-003 — argued with numbers |
| `gemini-3.8-flash` / `gemini-3.1-flash-lite`, **pinned ids** | ADR-004, ADR-013 |
| Governor is domain-agnostic — no Cadre strings in `lib/governor/` | ADR-005 |
| Fail closed, no escape hatch | ADR-006 |
| Three tiers, never a hard stop | ADR-007 |
| $1.20 reserve locked to the review window | ADR-008 |
| Lead capture, never a fake "someone will call you" | ADR-009 |
| No conversation persistence | ADR-012 |
| Two keys + ledger namespacing | ADR-014 |

Scope is fixed in `docs/architecture.md` §1 (IN / OUT / LATER). **Don't add to it.** If
something looks missing it is probably in LATER with a trigger condition.

## Two things research already overturned

Both are in the docs; both are places where the obvious answer is wrong, and they are the
best argument for running `researcher` before you build:

1. **Streaming + screen readers.** Announcing tokens as they arrive floods the screen reader.
   The settled pattern is to stream silently and announce the finished message once.
   (`docs/design-system.md`)
2. **OpenRouter cost accounting.** Real cost arrives in the **final streaming chunk**; the
   legacy `usage: { include: true }` parameter is deprecated and does nothing. Guessing the
   field names produces code that looks right and silently under-counts.
   (`docs/governor-spec.md` §2)

---

## What "done" looks like

- Public Vercel URL that streams a grounded answer and refuses a pricing question.
- Every AC in `plan.md` met, phase by phase.
- `pnpm test` green, governor state table covered row by row, no skipped tests.
- `/kb-audit --live` passed; zero `[V:snippet]` facts remaining.
- Eval run recorded in `docs/eval-set.md` with date, pass rate and real dollars.
  **Section C (injection) ships green or it doesn't ship.**
- `docs/decisions.md` carries an ADR for every mid-build deviation.
- Zip with `.git`, without `node_modules` / `dist` / `build` / venv.
- **`/judge` run, Gate 0 and Gate 1 both clear**, and its top three findings addressed or
  disclosed in `docs/decisions.md`. It grades what exists, not what's planned, so run it
  once everything is deployed.

## If you run out of time

Cut in the order at the bottom of `plan.md`, and **write each cut into `docs/decisions.md`**.
Being explicit about what you left out and why is graded; quietly shipping less is not.

Never cut: Phase 2's deployment, the governor tests, or the KB source discipline.
