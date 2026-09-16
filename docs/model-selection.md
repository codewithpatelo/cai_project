# Model selection and budget

All prices are **USD per million tokens, OpenRouter list price, captured 2026-09-16.**
OpenRouter passes through each provider's own per-token price and takes its platform fee
on credit purchase (~5.5%, min $0.80), not per request — so with $5 already credited, the
per-token numbers below are what we actually spend.

## 1. Candidates

Only **current-generation** models are considered. An earlier draft of this document
selected `gemini-2.5-flash`, which is a 2025-generation model — cheap, but a generation
behind, and choosing it in September 2026 would have been an unforced error on the one
decision the brief explicitly asks us to defend.

| Model | In $/M | Out $/M | Cache read $/M | Family | Source (2026-09-16) |
|---|---|---|---|---|---|
| **`google/gemini-3.8-flash`** | **0.75** | **3.75** | **0.075** | Google | https://openrouter.ai/google/gemini-3.8-flash |
| `openai/gpt-5.4-mini` | 0.75 | 4.50 | — | OpenAI | https://openrouter.ai/openai/gpt-5.4-mini |
| `anthropic/claude-haiku-4.5` | 1.00 | 5.00 | 0.10 | Anthropic | https://openrouter.ai/anthropic/claude-haiku-4.5 |
| **`google/gemini-3.1-flash-lite`** | **0.25** | **1.50** | — | Google | https://openrouter.ai/google/gemini-3.1-flash-lite |
| `google/gemini-3.5-flash-lite` | 0.30 | 2.50 | — | Google | https://openrouter.ai/google/gemini-3.5-flash-lite |

Two pricing facts worth noting, because both are counter-intuitive and both were checked
rather than assumed:

- **`gemini-3.5-flash` costs $1.50/$9.00** — double `3.8-flash` for an older model. Version
  numbers do not monotonically track price, so every candidate was priced individually.
- **`gemini-3.1-flash-lite` ($0.25/$1.50) is cheaper than `gemini-3.5-flash-lite`
  ($0.30/$2.50)** despite the lower version number. Same lesson.

## 2. Token budget per conversation — measured, not guessed

Knowledge base measured on the actual files in `kb/` at design time:

```
raw kb/0*.md                20,854 chars  ≈ 5,213 tokens
after build-time strip of
Sources: blocks + [V:] tags 18,629 chars  ≈ 4,657 tokens
```

Estimation method: `chars / 4`, the standard English rough ratio. It is an **estimate, and
the governor never relies on it for billing** — real cost comes back from OpenRouter
(§4 of `governor-spec.md`). It is used only for capacity planning here and for the
fail-closed fallback estimate.

Per-request input budget:

| Component | Tokens |
|---|---|
| Fixed instructions (`docs/system-prompt.md`) | 1,100 |
| Knowledge base (whole, shipped) | 4,700 |
| Conversation history (hard cap) | 1,500 |
| **Input ceiling** | **7,300** |
| Output (target 120–200 words, capped) | 250 |

A typical 4-turn conversation: input grows 5,900 → 6,800 → 7,600 → 8,300 (history capped at
1,500), mean ≈ 7,150. The **fixed prefix is 5,800 tokens** — instructions + KB — and is
byte-identical on every request by construction. That number matters in §5.

**Cost per turn (primary, `gemini-3.8-flash`, no cache):**
7,150 × 0.75/1e6 + 250 × 3.75/1e6 = $0.005363 + $0.000938 = **$0.00630**
**Per 4-turn conversation:** $0.0252 → with a 20% safety margin, **$0.030**.

**Cost per turn (economy, `gemini-3.1-flash-lite`):**
7,150 × 0.25/1e6 + 250 × 1.50/1e6 = $0.001788 + $0.000375 = **$0.00216**
**Per 4-turn conversation:** $0.0087 → with margin, **$0.0104**. **2.9× cheaper.**

## 3. What $5 buys

| Bucket | Amount | At PRIMARY | At ECONOMY |
|---|---|---|---|
| Operating budget (days 1–6) | $3.80 | ~126 conversations | ~365 |
| Live-review reserve (locked) | $1.20 | ~40 | ~115 |
| **Total** | **$5.00** | **~166** | **~480** |

Realistic mixed operation — PRIMARY until the 60% threshold, ECONOMY after — gives roughly
**220 conversations**, or ~31/day across the key's 7-day life.

This is materially tighter than the ~370 the 2025-generation draft projected. That is the
honest price of a current model, and it is still comfortably above what a demo URL will
see. The conclusion it does *not* change:

> **The budget is not the binding constraint — abuse is.** 31 conversations/day is far more
> than this bot will organically serve, but a single unthrottled scripted client burns the
> $3.80 operating budget in **under two minutes** at $0.0063/turn. Rate limiting is the
> primary defence; the ceiling is the backstop.

Moving to a 2.25×-costlier model therefore tightened the per-IP daily cap from 120 to **80
requests** (≈$0.50/day/IP worst case). Rate limits are denominated in requests but exist to
bound dollars, so they are re-derived whenever the model price changes — see
`governor-spec.md` §7.

## 4. Decision

**Primary: `google/gemini-3.8-flash`. Economy: `google/gemini-3.1-flash-lite`.**

Why 3.8 Flash as primary:

- **It is the current-generation Flash model** and, per Google's own positioning, the most
  capable one in that line. The quality-critical behaviour here is *refusal discipline* —
  not padding the AI Maturity Index to eight pillars, not producing a plausible portal URL
  under pressure. That is exactly where a generation gap shows.
- **vs `openai/gpt-5.4-mini` (0.75/4.50).** Identical input price, **20% more expensive on
  output**, and it is a reasoning model: reasoning tokens bill as output and vary per
  request. For a system whose central requirement is a hard, *predictable* ceiling, a model
  whose output volume I cannot bound is the wrong trade at the same input price.
- **vs `anthropic/claude-haiku-4.5` (1.00/5.00).** 33% more on input, 33% more on output,
  for a task that is not quality-bound once the KB is in context. It would cut capacity from
  ~166 to ~125 conversations. Haiku remains the documented **escape hatch** if evals section
  C shows 3.8 Flash failing refusal cases — the switch is one config line.
- **Explicit cache-read pricing at $0.075/M — 10% of input.** Haiku's cache read is $0.10/M
  but with a $1.25/M *write* cost; Gemini's implicit caching has no write cost at all. With
  a 5,800-token fixed prefix, that asymmetry is worth real money (§5).

Why 3.1 Flash Lite as the economy tier:

- **2.9× cheaper per conversation** ($0.0104 vs $0.030), which is the entire point of the tier.
- **Cheapest current-generation option**, and cheaper than the higher-numbered
  `3.5-flash-lite`.
- **Same family, same tokenizer, same prompt.** Degrading within a family means the system
  prompt, the KB, and the eval expectations carry over unchanged. Degrading across families
  would mean maintaining a second prompt and a second eval baseline — real work, under
  budget pressure, at exactly the wrong moment.

### Pin the version; never use a `~latest` alias
OpenRouter publishes `~google/gemini-flash-latest` and `~anthropic/claude-haiku-latest`.
**We use neither.** An alias can change model, price and behaviour mid-window, which would
invalidate every number on this page and every eval baseline without a deploy. Pinned ids
only; upgrading is a deliberate commit that re-runs §3 and the evals. Recorded as ADR-013.

## 5. Prompt caching: counted as upside, never as budget

`gemini-3.8-flash` publishes **cache read at $0.075/M — one tenth of input price — with no
cache-write cost and no storage cost** (Gemini implicit caching). OpenRouter supports
implicit caching for OpenAI, DeepSeek and Gemini models and uses **sticky routing** to keep
follow-up requests on the same provider endpoint. Our 5,800-token fixed prefix clears the
minimum-prefix requirement comfortably and is byte-identical across every request by
construction (§ prompt assembly ordering).

What a hit is worth, concretely. A cached turn costs
`5,800 × 0.075/1e6 + 1,350 × 0.75/1e6 + 250 × 3.75/1e6` = **$0.00239** against $0.00630
uncached. A 4-turn conversation whose turns are seconds apart — turn 1 cold, turns 2–4 warm
— costs **$0.0135 instead of $0.0252 — very close to half.**

**But the implicit cache TTL is on the order of 3–5 minutes.** A support bot on a demo URL
sees sparse, bursty traffic; most *conversations* will start cold even though most *turns
within* a conversation will hit. So:

> **Every number in §2 and §3 assumes zero cache hits.** Hits make us cheaper than planned.
> The budget is never allowed to depend on them.

Budgeting on hits we might not get is how a budget silently fails; ordering the prompt for
them anyway is free. This is why the fixed prefix comes first and is never reordered, and
why `trimHistory()` never touches it.

Source: https://openrouter.ai/docs/guides/best-practices/prompt-caching (2026-09-16)

## 6. Whole KB in context, not RAG

At **4,700 tokens** the entire knowledge base costs **$0.0035 per request** uncached on
3.8 Flash — and $0.00035 on a cache hit. A RAG
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
