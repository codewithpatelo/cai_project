---
description: Root-cause a bug instead of patching the symptom.
argument-hint: "[what broke]"
---

Bug: `$1`

`docs/principles.md` §6. Work the steps in order and do not skip to the fix.

## 1. Reproduce
Make it happen on demand, smallest input possible. **If you cannot reproduce it, stop** and
say so — a fix for something you can't trigger is a guess you'll ship.

## 2. Find the cause, not the location
Where it throws is usually not where it broke. Trace back to the decision that made the bad
state possible. Keep asking "why" until the answer is a design choice rather than a line of
code.

State the cause in one sentence before writing anything. If you can't, you haven't found it.

## 3. Is it a pattern?
The question that separates a fix from a cleanup: **is this the only instance?**
One missing `await` on a ledger write is a bug; a codebase where ledger writes are
*sometimes* awaited is a design problem, and patching the one you found leaves the rest.

```bash
# grep for the shape of the bug, not the symptom
```

## 4. Is the spec wrong?
If the code does what `plan.md` or `docs/` told it to, **the spec is the bug.** Fix the spec
first, then the code, in that order, and say so in the commit.

## 5. Failing test first
Write the test that captures the bug, watch it fail, then fix. This proves you found the
real cause and stops it coming back. If the bug is in the governor, it also goes in the §5
state table coverage.

## 6. Fix
Minimal change at the root cause. Nothing else in the commit.

**Never:** empty `catch`, `.skip` on the test that caught it, a retry wrapped around a race,
a widened type to silence an error, or a `?? default` that hides the bad state. Especially
never weaken fail-closed into log-and-continue because it made the error go away — that is
listed in `CLAUDE.md` § Known AI failure modes precisely because it is tempting.

## 7. Report
```
SYMPTOM     what was seen
CAUSE       one sentence, the design decision
SCOPE       only instance / N others found at <paths>
SPEC        correct as written / fixed at <file>
TEST        the test that now fails without the fix
FIX         what changed and why it's at the root
```
