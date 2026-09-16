# Engineering principles

How work gets done here. `CLAUDE.md` says *what* the rules are; this says *how* to think
when the rules don't cover the case in front of you.

## 1. Spec-driven, not vibe-driven

**Every phase in `plan.md` is specified before it is built**: a user story where one
applies, use cases, acceptance criteria in Given/When/Then, and test cases naming the
assertion. The plan is the map. An implementer should never have to guess what "done"
means or invent a requirement mid-phase.

Write specs the way you'd write a ticket for someone competent who isn't in the room:
**clear, concise, actionable, unambiguous.** If a criterion can't be checked mechanically
or by a named manual step, it isn't a criterion yet — rewrite it.

**If the spec is wrong, fix the spec, then build.** Don't build something different and
leave the plan lying. A phase that ends with code and plan disagreeing has failed even if
the code works.

## 2. No overengineering. Occam's razor.

Prefer the simplest thing that is *correct*. Note that "simplest" and "correct" are two
tests, and both have to pass — `docs/decisions.md` ADR-002 is exactly this argument.

Concretely:
- No dependency for what a 20-line function does.
- No abstraction until the second real caller exists. One exception, already taken and
  justified: `LedgerStore` is a port from day one because it is how the governor gets
  tested without a network (ADR-005) — and that bet paid out when the store swapped from
  Redis to Postgres and touched one file.
- No config option nobody asked for. No "we might need it later."
- No framework feature used because it's there.

The scope table in `docs/architecture.md` §1 already made these calls. **LATER means later**,
with a written trigger. Don't relitigate it mid-build.

## 3. Clarity over cleverness

The reviewer reads this code in a 10-minute deep-dive and asks what a specific function
does. Optimise for that. A clever one-liner that needs a comment loses to four obvious
lines that don't. Name things after what they mean in the domain, not after the pattern
they implement.

## 4. UX-focused: value lands on the user's side

Ask what the person typing actually gets. A feature that makes the architecture nicer and
the user's experience the same is not a feature.

This is why the bot degrades instead of erroring, why refusals always carry a next step,
why the tier badge says "Saved answers" instead of a dollar figure, and why the handoff
promises nothing it can't keep. **An honest "I don't know, here's who does" is a better
product than a confident guess** — for a consultancy selling AI judgement, it's the whole
product.

## 5. Research before you invent

When a task is non-trivial, **stop and find out how the industry solves it** before
designing. Almost everything is solved already. Look for the state of the art or the
established default, take it, then add your own judgement on top — but don't force
originality where a known-good answer exists, and don't reinvent a wheel badly because
inventing felt faster than reading.

This already paid for itself twice in design:
- **Streaming + screen readers.** The intuitive approach (announce tokens as they arrive)
  is *wrong* and floods the screen reader. The settled pattern — stream silently, announce
  the finished message and state transitions — came from reading, not from thinking hard.
  (`docs/design-system.md`)
- **OpenRouter cost accounting.** Usage and real cost come back in the final streaming
  chunk; the legacy `usage: { include: true }` parameter is deprecated and does nothing.
  Guessing the field names would have produced code that looks right and silently
  under-counts. (`docs/governor-spec.md` §2)

Cite what you found, with a URL and a date, next to the decision it drove.

## 6. Root cause, not symptom

When something breaks: reproduce it, find **why**, then fix that. A fix you can't explain
is a coincidence.

Ask whether the bug is an instance of a pattern. One missing `await` on a ledger write is
a bug; a codebase where ledger writes are sometimes awaited is a design problem, and
patching the one you found leaves the rest. If the root cause is in the spec, fix the spec.

Prefer a failing test that captures the bug before the fix. It proves you found the real
cause, and it stops the bug coming back.

**Never** silence a symptom: no empty `catch`, no `.skip` on the test that caught it, no
retry wrapped around a race, no widened type to make an error go away.

## 7. Verify your own output

You are directing a system that writes code fast and confidently, including when it's
wrong. `CLAUDE.md` § Known AI failure modes lists the specific things that have gone wrong
here. Read the diff. Run `/verify`. Don't regenerate a snapshot to make it pass.

## 8. Spend the client's key like it's the last of it — because it is

The $5 OpenRouter key **cannot be regenerated** and the demo dies without it. Development,
evals and probing run on the dev key (ADR-014). Before any real-model call, check
`OPENROUTER_KEY_PROFILE`. Never run `pnpm eval` unprompted.

This isn't frugality for its own sake. Running out is the one failure mode with no
recovery path, and everything in `docs/governor-spec.md` exists because of it.
