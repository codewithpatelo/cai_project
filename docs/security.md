# Security posture — OWASP Top 10 for LLM Applications 2026

Audited against the **2026** edition (published 2026-08-03), not the 2025 one. The list was
read from source rather than recalled: `genai.owasp.org/download/56857/` and the project
repository at `github.com/GenAI-Security-Project/GenAI-LLM-Top10/tree/main/2026`, which
agree. Four entries moved rank and one was renamed and widened — 2025's *System Prompt
Leakage* is now **LLM08:2026 Hidden Context Exposure**.

Two facts shape everything below, and both are worth more than any control in the table:

- **The model has no tools, no function calling, and no access to any system.** Its output
  becomes text on a screen and nothing else. The worst outcome of a fully successful
  injection is the bot saying something off-brand.
- **There is nothing secret in the context.** No credentials, no tool schemas, no
  entitlements. The knowledge base is public information from cadreai.com.

A control that depends on the model behaving is a preference, not a boundary. Everything
that actually enforces something here is deterministic code.

## The ten

| | Risk | State | Where |
|---|---|---|---|
| **LLM01** | Prompt Injection | **Mitigated, partly unverified** | below |
| **LLM02** | Sensitive Information Disclosure | Mitigated | below |
| **LLM03** | Excessive Agency | Not applicable by design | below |
| **LLM04** | Supply Chain | Mitigated | below |
| **LLM05** | Data and Model Poisoning | Mitigated | below |
| **LLM06** | Unbounded Consumption | Mitigated | below |
| **LLM07** | Misinformation | **Mitigated, unverified against a real model** | below |
| **LLM08** | Hidden Context Exposure | Informational by construction | below |
| **LLM09** | Vector and Embedding Weaknesses | Not applicable | below |
| **LLM10** | Improper Output Handling | Mitigated | below |

---

### LLM01:2026 — Prompt Injection

Four layers, in decreasing order of how much they can be trusted.

1. **Nothing to steal.** No tools, no account access, no secrets in context.
2. **Structural separation.** Rules sit outside `<knowledge_base>`; data sits inside it and
   is explicitly framed as data. `assemble.test.ts` asserts that an imperative planted in
   `kb/` stays inside the envelope and behind the fixed instructions (eval C7).
3. **Instructional.** The prompt tells the model that user text is something to answer,
   never something to obey.
4. **Output-side.** `lib/chat/url-filter.ts` strips every link and address `kb/` does not
   cite, regardless of why the model produced it. This is the only layer that does not
   depend on the model behaving.

**A gap this audit found and closed: the conversation history was attacker-controlled.**
There is no server-side transcript (ADR-012), so `history` arrives in the request body and
every `assistant` turn in it could be forged. A crafted transcript makes the model treat a
fabricated line as something it previously said — and a screenshot of a consultancy's bot
quoting a price it never quoted is the whole attack. `lib/chat/history-integrity.ts` now
HMAC-signs every answer the server produces; a turn whose signature does not verify is
dropped before assembly. Stateless, so it coexists with storing nothing. User turns are
never dropped — the user may say anything; it is the *assistant* role that carries borrowed
authority.

Requires `TELEMETRY_SALT`. Without it verification cannot run and **fails open**, because
failing closed would erase conversation context and look like amnesia. `/api/health`
reports `historyIntegrity` so the state is visible rather than assumed.

**Cross-modal injection** (2026 widened LLM01 to cover instructions hidden in images or
audio) does not apply: the only input is text.

**Unverified:** eval section C is written and its assertions are unit-tested against
hand-written answers, but it has never run against a real model. Section C ships green or
it does not ship, and it has not yet run.

### LLM02:2026 — Sensitive Information Disclosure

No conversation transcripts are stored anywhere. No IP addresses — rate-limit keys hold
`HMAC(ip, salt)`. No user message text can reach telemetry: `CallUsage` has no field able to
hold it, and `lib/guardrails.test.ts` fails the build if one is added. Keys are read inside
route handlers only; every client chunk of the live deployment was fetched and inspected,
and no key material or variable name appears.

The single PII store is a lead the user deliberately submitted: minimal fields, 30-day
retention, RLS on with no public policies so the anon key cannot read it.

### LLM03:2026 — Excessive Agency

The 2026 edition's biggest climber, and the one this application is structurally immune to.
The model is given no tools, no function calling and no credentials. It cannot read, write
or confirm anything in any system. Model output reaches exactly one place: the user's
screen, after filtering. The lead form writes to the database from *user*-submitted input
through a validated endpoint, never from anything the model said.

`assemble.test.ts` asserts the prompt describes no tool or schema, so this stays true of
what the model is told as well as of what it can do.

### LLM04:2026 — Supply Chain

Model ids are pinned, never `~latest` aliases (ADR-013): an alias can change model, price
and behaviour mid-window and silently invalidate the budget maths. Dependencies are
lockfile-pinned. `pnpm audit` is now a script and a release gate; it found four advisories,
all the same transitive `postcss` pulled in by `next`, now forced to a patched range by a
`pnpm.overrides` entry. Current state: no known vulnerabilities.

### LLM05:2026 — Data and Model Poisoning

No training and no fine-tuning, so the classic form does not apply. The analogue here is
the knowledge base, and it is gated at build time: `lib/kb/compile.ts` fails the build on a
factual bullet with no `Sources:` block, and on any URL or email address no `Sources:` block
cites. A malicious or careless KB edit cannot introduce a followable link. Every fact is
`[V:brief]` or `[V:live]` after the audit in ADR-024.

### LLM06:2026 — Unbounded Consumption

Rose four places in 2026, and it is what the entire governor exists for: a lifetime ceiling,
daily pacing, an inviolable reserve, three-tier degradation and fail-closed accounting. Four
rate limits (per-IP 60s and daily, per-session 60s and lifetime). Output tokens capped,
history trimmed per tier, message length capped at 2,000 characters and the body at 32 KB.

**One finding from this audit was self-inflicted.** The `?probe=model` diagnostic added
while debugging spends money on a **GET**, which crawlers, link previewers and prefetchers
follow unasked. It now requires `HEALTH_PROBE_TOKEN`, and is unavailable when that is unset —
an unauthenticated money-spending endpoint is not a reasonable default.

### LLM07:2026 — Misinformation

This is the product's entire reason to exist, so the controls are the features: whole-KB
grounding, a build-time source gate, `Not published` blocks that make absence an answer, and
escalation as a correct outcome rather than a failure. The output filter removes invented
links even when the model is confident.

**Honestly unverified.** The eval set exists and its assertions are tested, but no case has
run against a real model. Grounding quality is therefore argued, not measured.

### LLM08:2026 — Hidden Context Exposure

Renamed and widened from 2025's *System Prompt Leakage*. OWASP's guidance is to assume
hidden context is discoverable and to design so that disclosing it costs nothing; severity
tracks **content**, not the act of leaking.

The prompt does instruct the model not to reveal itself, and that instruction is not
relied on. What matters is that the content is **informational** on OWASP's scale, and
`assemble.test.ts` pins it: no credential-shaped material, no environment variable names, no
tool or function schemas, no internal hostname or connection string, and none of our spend
ceilings, windows or rate limits. A test also asserts the system message is the *whole* of
what the model is told, so that suite is exhaustive rather than partial.

Nothing depends on the context staying hidden. Refusals are backed by the URL filter and by
the absence of tools; spend is enforced by the governor; there is no authorization to
bypass. A full prompt disclosure would tell an attacker what the bot will not do — which the
bot already says out loud when asked.

### LLM09:2026 — Vector and Embedding Weaknesses

Not applicable: there is no RAG, no vector store and no embeddings. Decided with numbers in
`docs/model-selection.md` §6 — the KB is ~5,800 tokens, small enough to pass whole.

### LLM10:2026 — Improper Output Handling

Fell furthest in 2026, but it is the one that turns a model's words into someone else's
code. Answers render as **text**: no markdown, no HTML, no `dangerouslySetInnerHTML`
anywhere in the transcript path, asserted by test. The single place model output reaches an
attribute is `linkify`, whose pattern requires an `https?://` scheme — `javascript:`,
`data:`, `vbscript:` and `file:` cannot reach an `href`, and a test drives those exact
payloads through the real pattern. Links carry `rel="noopener noreferrer"`. SSE token text
is JSON-encoded, so a newline in an answer cannot split a frame.

---

## What is still open

1. **The eval set has never run against a real model.** Sections A–D, and specifically
   section C (injection), are unverified rather than passed. This is the largest open item
   and no amount of code review substitutes for it.
2. **History integrity needs `TELEMETRY_SALT` set** in the deployment, or it fails open.
3. **No adversarial testing by a human.** The `simulated-user` agent exists and has not been
   run against the live URL.
