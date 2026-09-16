---
description: Full pre-commit verification gate. Run before every commit.
---

Run the verification gate. Do not commit until every step is green.

## 1. Automated
```bash
pnpm typecheck && pnpm lint && pnpm test
```
All three green. Report the test count — a suddenly smaller number means tests were skipped
or deleted.

## 2. Secrets
```bash
git diff --cached | grep -inE 'sk-or-|OPENROUTER_API_KEY *=|UPSTASH.*=' || echo "clean"
git status --porcelain | grep -E '\.env($|\.local)' || echo "no env files staged"
```

## 3. Invariants
```bash
grep -ri cadre lib/governor/ && echo "FAIL: domain leak in governor" || echo "governor clean"
grep -rn "\.only(\|\.skip(" --include=*.test.ts lib/ || echo "no skipped tests"
grep -rn "cadreai.com" --include=*.ts --include=*.tsx app/ lib/ || echo "no hardcoded urls"
```
Any Cadre fact outside `kb/` is a failure. Any URL in code that isn't the allow-list
constant is a failure.

## 4. Read the diff
```bash
git diff --cached
```
Read it. Not skim — read. For each changed hunk, state what it does and why. **If you can't
explain a line, it does not ship.** This step is the entire point of the command; the greps
are just the cheap part.

Look specifically for the failure modes in CLAUDE.md § "Known AI failure modes": invented
URLs, padded pillar lists, invented API field names, weakened fail-closed, a helpful price
range that crept in.

## 5. Targeted checks
- Touched `lib/prompt/`? Re-read the snapshot diff **by eye**. Never `-u` past it.
- Touched `kb/`? Run `/kb-audit`.
- Touched `lib/governor/`? Name the state-table row each change affects and the test
  covering it.

## 6. Checklist
Complete the pre-commit checklist in `docs/eval-set.md`. Actually complete it — report each
line as checked or failed. A checklist nobody completes verifies nothing.

## 7. Commit
Only now. Imperative mood, one concern, body explains *why* if it isn't obvious.
