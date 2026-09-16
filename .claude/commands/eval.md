---
description: Run the eval set against the real model under a hard $0.40 spend cap. Spends real money.
argument-hint: "[section: A|B|C|D|all]  (default: all)"
---

**This spends real money from a $5 key that cannot be topped up and must last until the
live review. Confirm with me before the first request.**

Section to run: `$1` (default `all`).

## Preconditions — stop if any fails
1. `pnpm test` green. Never spend money evaluating code that fails its free tests.
2. `EVAL_BUDGET_USD` is set and points at the **eval** ledger key, not production.
3. Current production lifetime spend is below the ECONOMY threshold — check
   `/api/health` first. Don't push the live bot into degradation to run an eval.

## Run
Delegate to the `eval-runner` subagent. It must:
- Cap total spend at **$0.40**, checked after every case, aborting the moment it's crossed.
- Run one request per case, no retries.
- Reconcile each case against `GET /api/v1/generation` and report reported-vs-estimated cost
  drift. Drift > 10% is a governor accounting bug and outranks any individual case failure.
- Write `eval-results/<iso>.json`.

## Report
- Total spent (real dollars), cases run, pass rate.
- Each failure: case id, failed assertion, actual response, and whether the **prompt** or
  the **eval** is wrong.
- Any case that passed for the wrong reason.

## After
- Record the pass rate, date, and dollars spent in `docs/eval-set.md`.
- Fix the prompt or the KB — **never the eval** — and re-run only the failing section.
- If a case reveals a missing boundary, add it to `kb/09-boundaries.md`, not to a
  conditional in the route handler.
