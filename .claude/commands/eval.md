---
description: Run the eval set against the real model under a hard $0.40 spend cap. Spends real money.
argument-hint: "[section: A|B|C|D|all]  (default: all)"
---

This spends real money. It runs on the **dev key**, not the client's $5 (ADR-014), so
running it is normal and expected rather than a last resort — but confirm before the first
request anyway.

Section to run: `$1` (default `all`).

## Preconditions — stop if any fails
1. **`OPENROUTER_KEY_PROFILE=dev`.** Verify this before anything else. Running the eval set
   on the client key spends ~$0.20 of a $5 budget that cannot be regenerated, for a result
   the dev key gives you identically.
2. `pnpm test` green. Never spend money evaluating code that fails its free tests.
3. `EVAL_BUDGET_USD` is set and the eval ledger namespace is separate from production.

## Run
Delegate to the `eval-runner` subagent. It must:
- Cap total spend at `EVAL_BUDGET_USD` (default $2.00), checked after every case, aborting
  the moment it's crossed.
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
  On the dev key this loop is cheap, so iterate until section C is clean rather than
  accepting a partial pass.
- If a case reveals a missing boundary, add it to `kb/09-boundaries.md`, not to a
  conditional in the route handler.
