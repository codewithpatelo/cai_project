---
description: Score the finished project against Cadre's evaluation criteria. Run last, before submission.
argument-hint: "[deployed URL]"
---

Run the final evaluation. Deployed URL: `$1`

This is the last gate before submission. Delegate to the `final-judge` subagent.

## Preconditions
1. Everything is built, committed and deployed. **Judging a half-built project wastes the
   run** — the judge grades what exists, and a phase that isn't built scores 0.
2. `OPENROUTER_KEY_PROFILE=dev`, or a preview deployment. The judge probes the live bot;
   probing production spends the client's unregenerable $5.
3. `pnpm test` has been run at least once, so the judge isn't the first to discover it's red.

## The judge must
- Work `docs/rubric.md` in order: Gate 0 (deliverables), Gate 1 (auto-fails), then the five
  weighted dimensions.
- Cite evidence for every score — path, command output, or quoted line. No evidence → 0.
- Probe the live URL, not just the docs. Documentation claiming a property is not the
  property.
- Report actual command output, not expected output.
- Take the harsher reading on ties, and say what would raise each score.

## After
- A **Gate 1 failure is not a scoring note, it's a stop.** Fix it before anything else;
  those are the failures of the thing the product exists to do.
- Work the "three things that cost the most points" in order of points-per-hour, not
  severity. The deadline is real.
- Re-run once after fixing. Record the before/after in `docs/decisions.md`.
- **Do not argue the score down.** If a criterion is unfair, fix the rubric and say so in a
  commit — don't quietly rescore.
