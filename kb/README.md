# Knowledge Base — rules of the road

Everything in `kb/*.md` is injected verbatim into the model's context as **data, not
instructions**. Treat these files as the bot's only permitted source of Cadre AI facts.

## Hard rules

1. **Every claim carries a source.** A fact with no `Source:` line does not ship.
   `/kb-audit` fails the build on any unsourced bullet.
2. **Permitted sources only:**
   - The take-home brief (`Cadre AI Candidate Take-Home Challenge v1.1`) — cited as `BRIEF`.
   - Public pages on `cadreai.com`.
   Nothing else. Not a press release, not a LinkedIn profile, not model memory.
3. **Never invent:** URLs (especially a portal or booking URL), prices, SLAs, case-study
   numbers, named people, certifications, compliance claims, partner tiers.
4. **Absence is a fact too.** When Cadre publishes nothing on a topic, the KB says so
   explicitly in a `### Not published` block, and the bot uses that to escalate instead of
   guessing. These blocks are the single most load-bearing content in the KB.
5. **No page invents a link.** Only URLs that appear in a `Source:` line may be shown to a
   user, and only as the page they actually are.

## Verification status (read this before Phase 2)

The design pass was run in an environment whose egress proxy **blocks `cadreai.com`**, so
pages could not be fetched directly. Facts below were recovered from search-engine
extracts of those pages on **2026-09-16** and are tagged:

- `[V:snippet]` — sourced to a real cadreai.com URL, text recovered via search extract.
- `[V:brief]` — stated in the take-home brief. Authoritative, no re-check needed.
- `[V:live]` — confirmed by reading the live page. Only `/kb-audit --live` sets this tag.

**When the live audit runs.** `kb-curator` runs `/kb-audit --live` in the post-Phase-0
fan-out, before Phase 2 puts the bot on a public URL — shipping unverified facts to real
users is the thing the tags exist to prevent. Phase 7 re-runs it as the final gate, because
the KB may have grown in between.

Any `[V:snippet]` fact that cannot be confirmed on the live page is **deleted**, not
softened. The bot loses a fact; it does not gain a guess.

**Current counts (audited 2026-09-16):** 7 `[V:brief]` · 27 `[V:snippet]` ·
**0 `[V:live]`**. Every snippet fact is unverified until the live audit runs.

An earlier note claimed 8 / 31 / 0. That was wrong on all three numbers; an offline
audit counted the tags. Two corrections came out of it:

- The **Construction** bullet in `03-industries.md` claimed agents that extract material
  quantities from plans and "reduce estimating time from days to hours". It carried
  `[V:snippet]` but cited no page, and no construction page appears in the inventory below.
  It was **deleted**. Construction survives as an industry Cadre names, which is
  `[V:brief]` and needs no page.
- A tag only counts when it **ends a line**. `04-getting-started.md` mentions `[V:live]`
  mid-sentence while explaining this convention; that is prose, not a verified fact, and
  the compiler does not treat it as one.

## Page inventory discovered (all `[V:snippet]`, 2026-09-16)

`/` · `/about` · `/strategy` · `/leadership-facilitation` · `/ai-engineering` · `/agents` ·
`/departments` · `/departments/customer-success` · `/industries/private-equity` ·
`/case-studies` · `/contact` · `/careers` · `/articles` · `/events` ·
`/events/ai-leadership-workshop` · `/ai-2030-podcast`

## File map

| File | Covers |
|---|---|
| `01-company.md` | What Cadre is, who it serves |
| `02-services.md` | The four service lines |
| `03-industries.md` | Industries and departments |
| `04-getting-started.md` | How to engage; booking a call |
| `05-ai-maturity-index.md` | The Index and how to get scored |
| `06-client-portal.md` | The portal |
| `07-llm-and-security.md` | Model selection & data security posture |
| `08-contact-and-escalation.md` | Handoff paths and what the bot may promise |
| `09-boundaries.md` | Topics the bot refuses or deflects |
