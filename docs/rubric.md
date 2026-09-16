# Final rubric — scored against Cadre's own evaluation criteria

This is the scorecard `final-judge` runs before submission. **The weights and dimension
names are Cadre's, taken verbatim from the take-home brief**, not invented here. The
observable checks under each are ours — the brief says what it grades, not how to verify it.

**Scoring.** Each criterion is 0–4. A dimension's score is the mean of its criteria, ×25 to
give a percentage, ×weight. Total is out of 100.

| Band | Meaning |
|---|---|
| **4** | A senior engineer would point at this as an example |
| **3** | Solid. Does the job, no notable gaps |
| **2** | Present but thin — a reviewer would probe it and find soft spots |
| **1** | Token effort. Named, not done |
| **0** | Absent, or actively wrong |

**Evidence is mandatory.** Every score cites a file path, a command output, or a quoted
line. A score with no evidence is recorded as 0 — "looks fine" is not a finding.

---

## Gate 0 — Deliverables (pass/fail, not scored)

The brief lists these as required. Any failure caps the total at **40** regardless of
everything else, because the submission is incomplete.

| # | Check | How |
|---|---|---|
| G1 | Deployed, publicly accessible URL, responding | `curl -sI <url>` → 200 |
| G2 | `CLAUDE.md` at repo root | `test -f CLAUDE.md` |
| G3 | `plan.md` at repo root | `test -f plan.md` |
| G4 | `.git` present and readable in the zip | `git log --oneline \| wc -l` ≥ 10 |
| G5 | No `node_modules`, `dist`, `build`, `.next`, venv in the zip | inspect archive |
| G6 | Zip is "a few megabytes at most" | `du -sh` |

## Gate 1 — Automatic fail conditions

Any one of these caps the total at **50** and is reported first, in bold. They are failures
of the thing the product exists to do.

| # | Condition | How to check |
|---|---|---|
| F1 | A secret appears anywhere in the repo or git history | `git log -p \| grep -nE 'sk-or-v1-[A-Za-z0-9]{20,}\|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}'` — key **shape**, not variable names |
| F2 | The bot emits a URL not traceable to a `Sources:` line in `kb/` — especially a portal or booking URL | probe live + `grep -rn "cadreai.com" app/ lib/` |
| F3 | The bot states a price, range, or "typically around" | probe live, 3 phrasings incl. one pressuring |
| F4 | The bot claims a security or compliance posture for Cadre | probe live |
| F5 | The bot lists eight AI Maturity Index pillars | probe live |
| F6 | A raw error, stack trace or provider message reaches the user | force a failure path |
| F7 | Governor tests skipped, `.only`'d, or absent | `grep -rn "\.skip(\|\.only(" --include=*.test.ts` |
| F8 | Fail-closed weakened to log-and-continue | read the catch paths in `lib/governor/` |

---

## Dimension 1 — Claude Code Proficiency · **30%**
> *"How you set up CLAUDE.md, plan.md, use subagents, custom commands, and manage AI context. The most important dimension."*

| # | Criterion | 4 looks like | Check |
|---|---|---|---|
| 1.1 | `CLAUDE.md` is opinionated and specific, not boilerplate | Names this stack, these commands, these hard rules; contains something only this project would say | Read it. Would it make sense pasted into another repo? If yes → ≤2 |
| 1.2 | It encodes failure modes, not just facts | A section on what the AI got wrong *here*, with specifics | `grep -A5 "failure modes" CLAUDE.md` |
| 1.3 | `plan.md` is executable in phases | Each phase: goal, tasks, files, verifiable done-criterion, commit message, estimate | Read. Could a fresh agent execute phase 3 without asking anything? |
| 1.4 | Phases are specified, not described | User story, use cases, Given/When/Then ACs, named test cases | Count ACs per phase. <3 → ≤2 |
| 1.5 | Subagents exist with real boundaries | Each has an owned write set, explicit prohibitions, and a done-definition | `ls .claude/agents/` + read two |
| 1.6 | Parallelism is justified structurally | The plan says *why* phases parallelise (disjoint write sets), and why others don't | Read §Subagents |
| 1.7 | Custom commands do real work | Not aliases — each encodes project-specific checks | `ls .claude/commands/` + read `/verify` |
| 1.8 | Context strategy is explicit | States what is always loaded, what loads on demand, when to `/clear` | `grep -A10 "Context management" CLAUDE.md` |
| 1.9 | Git history shows the method | Small, scoped commits with reasoning in the body; phases visible | `git log --oneline` and read 3 bodies |

**Probe:** pick one commit and ask — does its message explain *why*? A history of "fix", "wip",
"update" scores ≤1 here regardless of the docs.

## Dimension 2 — System Design & Architecture · **25%**
> *"Your data model, API structure, system prompt design, separation of concerns, and scaling trade-offs."*

| # | Criterion | 4 looks like | Check |
|---|---|---|---|
| 2.1 | Separation of concerns is real, not aspirational | Swapping the LLM provider touches one file; changing a fact touches one `kb/` file | Trace both. If either spreads → ≤2 |
| 2.2 | The governor is genuinely domain-agnostic | Zero product strings; liftable by copying the folder | `grep -ri cadre lib/governor/` must be empty |
| 2.3 | API is typed with defined error behaviour | Request/response types, status codes, streaming contract documented **and matching the code** | `docs/architecture.md` §4 vs the route handler |
| 2.4 | Data model is minimal and justified | What's persisted, what deliberately isn't, and why | `docs/architecture.md` §5 |
| 2.5 | PII discipline is structural | Can't log message text without changing a type | Read the telemetry type |
| 2.6 | System prompt separates instructions from data | KB inside a fenced region, framed as data | `docs/system-prompt.md` + `lib/prompt/assemble.ts` |
| 2.7 | Scaling answer is concrete | Names what changes at 100/day and 10k/day, and what doesn't | `docs/architecture.md` §7 |
| 2.8 | Decisions are recorded with alternatives and accepted trade-offs | ADR format; the trade-off is stated, not hidden | `docs/decisions.md` |
| 2.9 | The budget design survives adversarial questioning | Fail-closed has no escape hatch; pacing and reserve are derived, not guessed | Read `lib/governor/`, walk the state table |

**Probe:** "What happens if Supabase is down for an hour?" The answer must be *degrades to
STATIC*, demonstrable in code, not aspirational.

## Dimension 3 — Development Speed & Scope · **20%**
> *"How you prioritize features, where you draw scope boundaries, and how you manage complexity."*

| # | Criterion | 4 looks like | Check |
|---|---|---|---|
| 3.1 | Scope is explicit and written down | IN / OUT / LATER with a reason per row, decided before building | `docs/architecture.md` §1 |
| 3.2 | LATER items carry trigger conditions | "RAG when KB > 25k tokens", not "maybe later" | Same table |
| 3.3 | Deployed early | First deploy commit is in the first third of the history | `git log --oneline --reverse \| head -20` |
| 3.4 | The six brief scenarios all work | Each answers or escalates correctly on the live URL | Probe all six |
| 3.5 | Cuts are disclosed, not hidden | What was dropped and why, in `docs/decisions.md` | Read it |
| 3.6 | No overengineering | No unused abstraction, no dependency replacing 20 lines, no RAG | Read `package.json` and `lib/` |

**Probe:** anything built that isn't in the IN table? That is scope drift and scores ≤2 here
even if it works.

## Dimension 4 — Code Quality & Verification · **15%**
> *"Clean code, error handling, catching AI bugs, knowing what your code does."*

| # | Criterion | 4 looks like | Check |
|---|---|---|---|
| 4.1 | Tests exist where they matter and run clean | Governor state table covered row by row | `pnpm test`; map tests to `governor-spec.md` §5 |
| 4.2 | Tests are honest | No `.skip`, no `.only`, no assertion on a mock standing in for behaviour | Read three tests |
| 4.3 | Error handling degrades, never leaks | Every failure path lands in STATIC | Force 429, 500, timeout, store down |
| 4.4 | Typing is strict and real | No `any`, no `!`, no `@ts-expect-error` escape hatches | `grep -rn ": any\|@ts-expect-error" --include=*.ts` |
| 4.5 | Eval evidence is recorded | Date, pass rate, real dollars spent; injection section green | `docs/eval-set.md` |
| 4.6 | KB has zero unverified facts | No `[V:snippet]` remaining | `grep -c "\[V:snippet\]" kb/*.md` → 0 |
| 4.7 | AI-generated bugs were caught | Evidence of a real catch — a commit fixing a plausible-but-wrong generation | `git log --grep="fix"` and read |
| 4.8 | Responsive and accessible as built | No horizontal scroll at 320px; keyboard-complete with visible focus; ≥4.5:1 in **both** themes; theme persists and doesn't flash | Resize to 320, Tab through, measure contrast, reload in dark |

**Probe:** pick a random function and ask what it does and why it's there. Hesitation scores
≤2 — the brief says explicitly this is what the code deep-dive tests.

## Dimension 5 — Communication & Reasoning · **10%**
> *"Explaining decisions, articulating trade-offs, productive technical dialogue."*

| # | Criterion | 4 looks like | Check |
|---|---|---|---|
| 5.1 | Trade-offs are stated with what was given up | Every ADR names an accepted cost | `docs/decisions.md` |
| 5.2 | Numbers carry sources and dates | Prices, token counts, estimates — each cited or with its method shown | `docs/model-selection.md` |
| 5.3 | Honest about what's broken | A written list of known gaps, before anyone asks | `docs/decisions.md`, `docs/demo-script.md` |
| 5.4 | The demo is planned to the minute | 10-minute script with contingencies | `docs/demo-script.md` |
| 5.5 | Ambiguity was resolved and recorded | Open questions taken as decisions, not left hanging | `docs/decisions.md` § Open questions |

**Probe:** the brief says *"the best candidates are honest about what's broken."* Is there a
real weakness disclosed, or only flattering ones?

---

## Report format

```
GATE 0    pass / FAIL (which)
GATE 1    clear / FAIL (which, verbatim evidence)

D1 Claude Code Proficiency   x.x/4  → xx.x/30
D2 System Design             x.x/4  → xx.x/25
D3 Speed & Scope             x.x/4  → xx.x/20
D4 Quality & Verification    x.x/4  → xx.x/15
D5 Communication             x.x/4  → xx.x/10
                             TOTAL  → xx/100

THE THREE THINGS THAT COST THE MOST POINTS
  1. <criterion> — <evidence> — <the specific fix>
  2. …
  3. …

WHAT A REVIEWER WILL PROBE FIRST
  <the softest spot, and the question that exposes it>

VERDICT   ship / fix first (what, and how long it takes)
```
