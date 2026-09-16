# Cadre AI — support assistant

A public support chatbot for Cadre AI. It answers common inbound questions from a curated
knowledge base, refuses what Cadre does not publish, and hands off to a human when it
cannot help. It runs on a $5 OpenRouter key that cannot be regenerated, so a budget
governor paces spend and degrades in steps rather than running out.

Two properties matter more than any feature: **it never states a Cadre fact that isn't in
`kb/` with a source**, and **it never runs out of money**.

## Quick start

```bash
pnpm install
cp .env.example .env.local      # fill in the DEV key, never the client key
pnpm dev                        # http://localhost:3000
```

With no OpenRouter key and no Supabase configured, the app still runs: the governor fails
closed and every answer is served from the zero-cost STATIC tier. That is the designed
behaviour, not a broken state.

```bash
pnpm test        # 300+ unit tests, mocked LLM, zero network, zero spend
pnpm typecheck
pnpm lint
pnpm build       # runs kb:compile first; fails the build on an unsourced KB fact
pnpm eval        # SPENDS REAL MONEY. Dev key only. See docs/eval-set.md
```

## How it fits together

```
kb/*.md                  Facts about Cadre + their sources. The only place Cadre facts live.
lib/kb/compile.ts        Build gate: fails on an unsourced fact or an uncited URL.
lib/prompt/              Fixed instructions + <knowledge_base> envelope + trimmed history.
lib/governor/            Budget, pacing, degradation. Domain-agnostic; no Cadre strings.
lib/llm/openrouter.ts    The only file that knows OpenRouter exists.
lib/chat/                Wire protocol, STATIC responder, URL filter, config.
app/api/chat             SSE endpoint. Thin orchestration.
app/api/handoff          Lead capture.
app/api/health           Non-secret status.
app/(ui)/                Presentation.
```

Design documents are in `docs/`. Start with `docs/architecture.md`, then
`docs/governor-spec.md`. Every non-obvious decision has an ADR in `docs/decisions.md`.

## Deployment runbook

Not yet deployed. This is what it takes, in order.

### 1. Supabase

Create a project, then apply the schema:

```bash
psql "$SUPABASE_DB_URL" -f supabase/schema.sql
```

Two tables and one function. Verify the atomic counter works — it should return `1` then `2`:

```sql
select governor_incr('t:probe', 1, 60);
select governor_incr('t:probe', 1, 60);
```

### 2. Vercel — the branch trap, first

Whatever import route is used, **set the Production Branch to
`claude/design-build-handoff-jpyrjr`** (Vercel → Settings → Git → Production Branch).

The repository's default branch is `claude/cadre-ai-chatbot-design-olwwtw`, which holds the
design documents and no application code. A build from it does not fail loudly — it
"completes" in about 60ms with no output, and every route then returns 404. That looks like
a broken application rather than a build of the wrong branch, so check the build log's
`Cloning … (Branch: …)` line before debugging anything else.

### 2a. Vercel — third-party Git import (no GitHub connection)

A GitHub account can hold a Vercel Login Connection for only one Vercel account, so if that
connection already belongs to another account, linking the usual way is unavailable and
moving it would break whichever account currently holds it.

This repository is **public**, so Vercel can clone it directly instead:

1. Go to **vercel.com/new** and choose **Import Third-Party Git Repository**.
2. Paste `https://github.com/codewithpatelo/cai_project`.
3. **Set the Production Branch to `claude/design-build-handoff-jpyrjr`.** The repository's
   default branch holds the design documents and no application code, so a build from it
   will fail.
4. Add the environment variables from §2c before the first build.

No OAuth, no GitHub App, no change to any existing connection. The trade-off is that pushes
do not auto-deploy; redeploy from the dashboard.

### 2b. Vercel — from the CLI, no GitHub connection needed

Linking a git repository requires a GitHub Login Connection on the Vercel account, and a
GitHub account can only be connected to one Vercel account at a time. If that connection
already belongs to another Vercel account, **do not move it** — deploy from the CLI
instead. The CLI uploads the working tree directly and needs only a Vercel login; the git
connection exists for auto-deploy on push, which this project does not require.

```bash
git checkout claude/design-build-handoff-jpyrjr
pnpm install
npx vercel login          # pick the Vercel account this should live in
npx vercel link           # create or select the project, e.g. cadre-ai-support-bot
```

### 2c. Environment variables

Paste your own values; nothing here is committed.

```bash
# Which provider the key belongs to, and the key itself.
npx vercel env add LLM_PROVIDER preview            # deepseek
npx vercel env add OPENROUTER_API_KEY preview      # the DEV key, never the client's
npx vercel env add OPENROUTER_KEY_PROFILE preview  # dev

# Pin the model and its real per-token rates, read off the provider's pricing page.
npx vercel env add MODEL_PRIMARY preview                  # deepseek-chat
npx vercel env add MODEL_PRIMARY_INPUT_PER_MTOK preview
npx vercel env add MODEL_PRIMARY_OUTPUT_PER_MTOK preview

# The ledger. Without these the governor fails closed and every answer is STATIC.
npx vercel env add SUPABASE_URL preview
npx vercel env add SUPABASE_SERVICE_ROLE_KEY preview
npx vercel env add TELEMETRY_SALT preview          # 32+ random bytes

npx vercel                 # preview deployment
```

Deploy to production only with the client key and `OPENROUTER_KEY_PROFILE=client`
(ADR-014). A preview left on the client key drains a $5 budget that cannot be regenerated,
and there is no undo.

### 2d. Vercel — git-linked (only if the GitHub connection is free)

Create a project from this repository. Set environment variables **per environment** — the
split is the point, not a formality (ADR-014):

| Variable | Preview | Production |
|---|---|---|
| `OPENROUTER_API_KEY` | **dev** key | **client** key |
| `OPENROUTER_KEY_PROFILE` | `dev` | `client` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | same project | same project |
| `TELEMETRY_SALT` | any 32+ random bytes | a different 32+ random bytes |
| `GOVERNOR_SIM_ENABLED` | `true` for demos | **unset** |

The profile drives the ledger namespace, so dev spend is physically incapable of moving the
client's pacing curve or degradation tier. **A preview left on the client key drains $5
silently and there is no undo.**

### 3. Before going public

- **Confirm the key's real expiry.** A $5/7-day key issued around 16 Sep expires on or near
  review day. Set `GOVERNOR_KEY_EXPIRES_AT` to whichever comes first: the real expiry, or
  the end of the review window.
- **The KB ships in full, unverified — by decision, not by accident (ADR-022).** 27 facts
  are `[V:snippet]`: sourced to a real cadreai.com page but recovered from that page's
  search extract, not read off it. `/kb-audit --live` still could not run (every route out
  of the build environment, Playwright included, terminates at a policy gateway). **Run it
  from an environment with egress to cadreai.com before the live review**, and delete
  anything that does not confirm rather than softening it. `KB_MIN_VERIFICATION=brief`
  remains available and ships only the 7 brief-verified facts.
- **Run the eval set on the dev key.** `docs/eval-set.md` has the command. Section C
  (injection) ships green or it does not ship.
- `curl https://<url>/api/health` and check `keyProfile`, `ledger` and `simulated` read
  what you expect.

### 4. If the key dies before the review

Nothing breaks. The STATIC tier makes no provider call, costs nothing, and still answers all
six brief scenarios from the same knowledge base and still captures leads. Demo it
deliberately rather than apologising for it — it is the strongest evidence that the
degradation design works.

## What this deliberately does not do

Quote prices · promise outcomes or ROI · compare Cadre to competitors · give legal,
financial, tax or HR advice · access or confirm anything in a customer account · emit a URL
that `kb/` does not cite · name Cadre staff or clients · state Cadre's security or
compliance posture.

It also stores no conversation transcripts, no IP addresses and no message text in
telemetry. The one place PII is stored is a lead the user deliberately submitted, with
30-day retention.
