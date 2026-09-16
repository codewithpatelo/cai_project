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

### 2. Vercel

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
- **Decide what the KB may say.** 27 facts are `[V:snippet]` — sourced to a real page but
  recovered from a search extract, not read off the page. Either run `/kb-audit --live` and
  promote or delete them, or build with `KB_MIN_VERIFICATION=brief`, which ships only the
  7 brief-verified facts plus the escalation paths (ADR-016).
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
