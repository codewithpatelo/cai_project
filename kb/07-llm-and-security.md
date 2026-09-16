# LLM selection and data security

## The honest position

**Cadre AI publishes no LLM-selection methodology and no data-security policy page.**
A targeted search across `cadreai.com` on 2026-09-16 found no security, privacy, trust,
compliance, or model-policy page. Two things follow:

1. The bot **must not** state a Cadre security posture, retention policy, data residency,
   sub-processor list, or compliance status. Not SOC 2, not GDPR, not "your data is never
   used for training". Every one of those is a contractual claim a chatbot cannot make on a
   consultancy's behalf, and getting it wrong is the most expensive error in this whole
   product.
2. This scenario is therefore **escalation-first by design**, not by accident.

## What the bot CAN say — three verified things

1. **Partners.** Cadre works with **OpenAI, Anthropic (Claude), Google, Microsoft, AWS,
   Salesforce and Snowflake**, and uses **OpenRouter for model access**. `[V:brief]`
   Multi-provider access is itself the observable fact: Cadre is not locked to one model
   vendor and selects per workload.
2. **Guardrails are part of the delivered product.** Cadre publicly describes building
   agents that run end-to-end processes **with guardrails and human oversight**. `[V:snippet]`
   That is a design stance the bot may quote verbatim.
3. **Its own build.** The bot may answer transparently about *itself* — that it is a
   grounded assistant, that it answers only from a curated public knowledge base, that it
   stores no conversation transcripts, and that it hands off rather than guessing. This is
   verifiable from this repository and is offered as an illustration of how Cadre builds,
   **explicitly labelled as being about this chatbot, not a statement of Cadre policy.**

## Required shape of the answer

Acknowledge the question is a real and good one → give the three verified things above →
state plainly that the specifics (retention, residency, DPAs, model-by-model policy) are
answered by Cadre's team against the client's actual requirements, not by a chatbot →
offer handoff.

Never: quote another vendor's policy as if it were Cadre's. Never: infer Cadre's posture
from the fact that they partner with a vendor who has a policy.

### Not published
Security policy · privacy policy · DPA / sub-processor list · retention periods ·
data residency · compliance certifications · model allow-lists · red-team practice.

Sources:
- Cadre AI Candidate Take-Home Challenge v1.1, "About Cadre AI" → Key partners (BRIEF)
- https://www.cadreai.com/agents (extract, 2026-09-16)
- Negative result: site-scoped search of cadreai.com for security/privacy/compliance pages,
  2026-09-16 — no such page surfaced.
