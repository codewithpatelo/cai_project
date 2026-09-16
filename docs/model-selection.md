# Model selection and budget

All prices are **USD per million tokens, OpenRouter list price, captured 2026-09-16.**
OpenRouter passes through each provider's own per-token price and takes its platform fee
on credit purchase (~5.5%, min $0.80), not per request — so with $5 already credited, the
per-token numbers below are what we actually spend.

## 1. Candidates

| Model | In $/M | Out $/M | Family | Source (2026-09-16) |
|---|---|---|---|---|
| `google/gemini-2.5-flash` | **0.30** | **2.50** | Google | https://openrouter.ai/google/gemini-2.5-flash |
| `openai/gpt-5-mini` | 0.25 | 2.00 | OpenAI | https://openrouter.ai/openai/gpt-5-mini |
| `anthropic/claude-haiku-4.5` | 1.00 | 5.00 | Anthropic | OpenRouter model page / pricing index |
| `google/gemini-2.5-flash-lite` | **0.10** | **0.40** | Google | https://openrouter.ai/google/gemini-2.5-flash-lite |

Flash Lite also publishes cache read **$0.01/M** and cache write **$0.08333/M**.

## 2. Token budget per conversation — measured, not guessed

Knowledge base measured on the actual files in `kb/` at design time:

```
raw kb/0*.md                20,854 chars  ≈ 5,213 tokens
after build-time strip of
Sources: blocks + [V:] tags 18,629 chars  ≈ 4,657 tokens
```

Estimation method: `chars / 4`, the standard English rough ratio. It is an **estimate, and
the governor never relies on it for billing** — real cost comes back from OpenRouter
(§4). It is used only for capacity planning here and for the fail-closed fallback estimate.

Per-request input budget:

| Component | Tokens |
|---|---|
| Fixed instructions (system prompt, §`docs/system-prompt.md`) | 1,100 |
| Knowledge base (whole, shipped) | 4,700 |
| Conversation history (hard cap, §5 of governor spec) | 1,500 |
| **Input ceiling** | **7,300** |
| Output (target 120–200 words, capped) | 250 |

A typical 4-turn conversation: input grows 5,900 → 6,800 → 7,600 → 8,300 (history capped at
1,500), mean ≈ 7,150.

**Cost per turn (primary):** 7,150 × 0.30/1e6 + 250 × 2.50/1e6 = $0.002145 + $0.000625 =
**$0.00277**
**Cost per 4-turn conversation:** **$0.0111**. With a 20% safety margin: **$0.0135**.

**Cost per conversation (degraded, Flash Lite):** 7,150 × 0.10/1e6 + 250 × 0.40/1e6 =
$0.000815/turn → $0.00326 → with margin **$0.0039**.

## 3. What $5 buys

| Bucket | Amount | Conversations |
|---|---|---|
| Operating budget (days 1–6) | $3.80 | ~281 primary |
| Live-review reserve (locked) | $1.20 | ~89 primary, or ~307 degraded |
| **Total** | **$5.00** | **~370 primary-model conversations** |

Sanity check on the real risk: 370 conversations over 7 days is ~53/day. A demo bot behind
a public URL will not organically see that. **The budget is not the binding constraint —
abuse is.** That is why the governor's rate limiting (§7 of the spec) is load-bearing and
the ceiling is a backstop, not the primary defence. A single unthrottled scripted client
could burn $3.80 in about four minutes; per-IP and per-session limits are what stop it.

## 4. Decision

**Primary: `google/gemini-2.5-flash`. Degraded: `google/gemini-2.5-flash-lite`.**

Why Flash over the two cheaper-looking alternatives:

- **vs `openai/gpt-5-mini` (0.25/2.00 — nominally cheaper).** GPT-5-mini is a reasoning
  model; reasoning tokens bill as **output**, the expensive side, and their count varies
  per request. For a system whose central requirement is a *hard, predictable ceiling*,
  a model whose output volume I cannot bound is worse than one that is 20% more expensive
  on paper. Flash with thinking disabled produces bounded output. Predictability beats
  list price here.
- **vs `anthropic/claude-haiku-4.5` (1.00/5.00).** 3.3× input and 2× output cost. Haiku is
  the better instruction-follower, but this task — answer from 4,700 tokens of curated
  text, refuse when it isn't there — is not quality-bound. Paying 3× for headroom we don't
  need would cut capacity from ~370 to ~110 conversations. Haiku is the documented
  **escape hatch** if evals (§`docs/eval-set.md`) show Flash failing refusal cases.

Why Flash Lite as the degradation step, specifically:

- **Same family, same tokenizer, same prompt.** Degrading within a family means the system
  prompt, the KB, and the eval expectations all carry over unchanged. Degrading *across*
  families would mean a second prompt to maintain and a second set of evals — real work,
  under budget pressure, at exactly the wrong moment.
- **3.4× cheaper per conversation** ($0.0039 vs $0.0135), which is the whole point.
- Publishes cache read/write pricing, so telemetry stays comparable across tiers.

## 5. Prompt caching: counted as upside, never as budget

OpenRouter supports **implicit caching** for OpenAI, DeepSeek and Gemini 2.5 models — no
breakpoints, no cache-write cost, no storage cost — and uses **sticky routing** to keep
follow-up requests on the same provider endpoint. Minimum prefix for Gemini 2.5 Flash is
1,024 tokens; our 5,800-token fixed prefix (instructions + KB) clears that comfortably and
is byte-identical across every request by construction (§ prompt assembly).

**But the cache TTL is on the order of 3–5 minutes.** A support bot on a demo URL sees
sparse, bursty traffic; most conversations will start cold. So:

> **Every number in §2 and §3 assumes zero cache hits.** Cache hits make us cheaper than
> planned. The budget is never allowed to depend on them.

Within a single live conversation (turns seconds apart) hits are likely, which is why the
fixed prefix is ordered first and never reordered.

Source: https://openrouter.ai/docs/guides/best-practices/prompt-caching (2026-09-16)

## 6. Whole KB in context, not RAG

At **4,700 tokens** the entire knowledge base costs **$0.0014 per request** on Flash. A RAG
pipeline to avoid that would need an embedding store, a chunker, a retriever, an eval for
retrieval quality, and a failure mode where the right chunk isn't retrieved and the bot
answers *worse* while still costing money.

RAG would start paying for itself somewhere north of ~50,000 KB tokens. We are 10× below
that. **Full context wins on cost, on simplicity, and — most importantly — on
groundedness:** the model sees every "Not published" block on every turn, which is exactly
what makes refusals reliable. Retrieval would sometimes hide the very block that prevents
a hallucination.

Recorded as ADR-003. Revisit if the KB passes 25,000 tokens.

## 7. Re-verification

Prices move. `/deploy-check` re-reads the OpenRouter model pages and **fails** if any
candidate's price has moved more than 20% from the table above, forcing a recalculation of
§3 rather than silently running on stale math.
