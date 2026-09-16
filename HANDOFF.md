# HANDOFF — design → build

You are picking up a **completed design package** with **zero application code written**.
Your job is to execute `plan.md`. This file tells you where things stand, what is already
decided, and the three things that will bite you. It is short on purpose.

**Read in this order:** `CLAUDE.md` → `plan.md` → this file → then the one doc your current
phase needs. Do **not** read all of `docs/` up front; it is ~45k tokens and each phase needs
one file. The loading policy is in `CLAUDE.md` § Context management and it is real advice,
not decoration.

---

## Hard dates — this is the tightest constraint on the project

| | |
|---|---|
| Live review | **Wed 23 Sep 2026, 17:00–18:00 ART** (= 20:00–21:00 UTC) |
| **Submission deadline** | **end of Mon 21 Sep 2026** — the brief requires one full business day before the review |
| Client key lifetime | $5, 7 days, **cannot be regenerated** |
| Build budget | ~5 hours across 8 phases |

The deadline is the 21st, not the 23rd. Plan against that.

A $5/7-day key issued around 16 Sep **expires on or near review day**. Confirm the real
expiry timestamp before deploying. If it lands before the review window, the $1.20 reserve is
worthless and the honest plan is to demo the STATIC tier deliberately — which still answers
all six brief scenarios, because STATIC makes no provider call at all.

---

## State

**Done (6 commits, pushed, branch `claude/cadre-ai-chatbot-design-olwwtw`):**
the full design package — `CLAUDE.md`, `plan.md`, 7 docs, 10 KB files, 4 subagents, 4 custom
commands, `.env.example`. 14 ADRs with the reasoning behind every non-obvious choice.

**Not done:** all 8 phases of `plan.md`. Nothing in `lib/`, `app/`, or `package.json` exists.

**Infrastructure available:** Vercel ✅ · Supabase Pro ✅ · dev OpenRouter key ✅ ·
client $5 key — held by the person who handed you this.

---

## The three things that will bite you

### 1. Two OpenRouter keys. Never mix them. (ADR-014)

```
local + Vercel Preview  →  dev key     OPENROUTER_KEY_PROFILE=dev
Vercel Production only  →  client key  OPENROUTER_KEY_PROFILE=client
```

The client key cannot be regenerated. Every eval run, debugging loop and preview deploy uses
the **dev** key. `OPENROUTER_KEY_PROFILE` also sets the governor's ledger `namespace`, so dev
spend physically cannot move the client's pacing curve or degradation tier — that isolation
is in the database key, not in your memory.

**The specific mistake to avoid:** a preview deployment left on the client key. It drains
$5 silently and there is no undo. `/deploy-check` checks for it; run it.

If you are ever about to paste the client key into `.env.local`, stop.

### 2. Thirty-one KB facts are unverified — and this blocks Phase 2

`kb/` currently holds **8 `[V:brief]` · 31 `[V:snippet]` · 0 `[V:live]`**.

The design pass ran in an environment whose egress proxy **blocked `cadreai.com`**, so those
31 facts came from search-engine extracts of real cadreai.com pages, not from reading the
pages. They are plausible and sourced, but unconfirmed.

**Run `/kb-audit --live` before Phase 2 deploys.** Phase 2 is what puts the bot on a public
URL; doing that with unverified facts ships exactly the failure the entire KB discipline
exists to prevent. Anything that does not confirm on the live page gets **deleted, not
softened**. Expect the KB to shrink — that is the mechanism working, not a problem to fix.

If the audit cannot run, Phase 2 still deploys, using only the 8 `[V:brief]` facts plus the
escalation paths. A smaller honest bot beats a larger confident one.

### 3. Fail-closed is the requirement, not a rough edge

If the governor cannot read or estimate spend, **it does not call the model** — no
timeout-and-proceed, no warning-and-continue, no in-process fallback counter. This will feel
awkward to implement. The awkwardness is the requirement working.

`CLAUDE.md` lists this under known AI failure modes because quietly softening it into
"log a warning and continue" is the most likely regression in the whole repo, and it is
invisible in a passing test suite.

---

## Where to start

**Phases 0 → 1 → 2, in order.** Phase 2 gets a working bot onto a public URL at the ~1h35m
mark. Do not reorder that; deploy-early is the single highest-value line in the plan.

After Phase 0, fan out: `kb-curator` (running `/kb-audit --live`) ∥ `governor-engineer`
(Phase 3) while you do Phases 1–2. They have disjoint write sets, which is *why* they
parallelise — not because they feel independent. Phases 2, 4, 5 and 7 all edit
`app/api/chat/route.ts` and must stay sequential.

`/clear` between phases.

---

## Already decided — do not re-litigate

Each has an ADR with the reasoning. If you think one is wrong, say so; don't quietly rebuild it.

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
something looks missing, it is probably in LATER with a trigger condition.

---

## What "done" looks like

- Public Vercel URL that streams a grounded answer and refuses a pricing question.
- `pnpm test` green, governor state table covered row by row, no skipped tests.
- `/kb-audit --live` passed; zero `[V:snippet]` facts remaining.
- One eval run recorded in `docs/eval-set.md` with a date, pass rate and real dollar figure.
- `docs/decisions.md` carries an ADR for every mid-build deviation.
- Zip with `.git` included, without `node_modules` / `dist` / `build` / venv.

## If you run out of time

Cut in the order given at the bottom of `plan.md`, and **write the cut into
`docs/decisions.md`**. Being explicit about what you left out and why is graded; quietly
shipping less is not.

Never cut: Phase 2's deployment, the governor tests, or the KB source discipline.
