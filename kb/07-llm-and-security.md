# LLM selection and data security

## The honest position

Cadre publishes a privacy policy, terms of service, and a product section titled "LLM
Selection & Data Security". It does **not** publish any compliance certification or
client-engagement data agreement. The line runs between those two.

1. The bot **may** state what the published pages state, quoting rather than paraphrasing.
2. The bot **must not** state a compliance status (SOC 2, ISO, HIPAA, GDPR), a
   sub-processor list, a DPA's contents, or how client data is handled inside an
   engagement. Those are contractual claims a chatbot cannot make for a consultancy.
3. Refusing what Cadre *does* publish is under-answering, not caution — the same failure
   as the eight pillars (`05-ai-maturity-index.md`).

## What the bot CAN say — verified

1. **Published approach to LLM selection and data security.** Cadre publishes a section
   headed "LLM Selection & Data Security" on both its AI Engineering and AI Strategy
   pages, listing four commitments: `[V:live]`
   - Select the right LLM tailored to your use cases
   - **Black-box your data so it's never used to train other models**
   - Stop employees from sharing company secrets on personal LLMs
   - Get your entire team on secure, compliant AI tools
2. **Privacy policy**, last updated 06/25/2026: Cadre retains personal data **for 2
   years**, applies "appropriate technical and organisational measures", and does not
   intentionally collect special category data. Legal entity **AI Gurus LLC dba Cadre
   AI**; privacy questions go to **privacy@gocadre.ai**. `[V:live]`
3. **Hosting.** The terms of service state the services are **hosted in the United
   States**. `[V:live]`
4. **Partners.** Cadre works with **OpenAI, Anthropic (Claude), Google, Microsoft, AWS,
   Salesforce and Snowflake**, and uses **OpenRouter for model access**. `[V:brief]`
   Multi-provider access is itself the observable fact: Cadre is not locked to one model
   vendor and selects per workload.
5. **Guardrails are part of the delivered product.** Cadre publicly describes building
   agents that run end-to-end processes **with guardrails and human oversight**. `[V:live]`

## Required shape of the answer

Lead with what is published. Point at the pages. Only if the question reaches past them
(certifications, a DPA, client-engagement data handling) say that part is not published.

Never quote another vendor's policy as Cadre's, never infer Cadre's posture from a
partner's, and never read "secure, compliant AI tools" as a certification — it describes
what Cadre helps clients adopt.

## What the bot says
Scenario: llm-security
Keywords: llm, model, models, which model, security, secure, data, privacy, compliance, compliant, soc 2, soc2, gdpr, hipaa, iso, retention, residency, dpa, encryption, safe, training data, sub-processor, privacy policy

> Cadre publishes its approach under "LLM Selection & Data Security": picking the right
> LLM per use case, black-boxing your data so it is never used to train other models,
> stopping staff from putting company secrets into personal LLMs, and getting the team
> onto secure, compliant tools. On its own site data, the privacy policy says Cadre keeps
> personal data for two years and the services are hosted in the US.
> https://www.cadreai.com/legal/privacy-policy has the detail.
> What is not published is any compliance certification — no SOC 2, ISO or HIPAA
> attestation — or the data agreement for a client engagement. Those come from the team.

### Not published
Compliance certifications (SOC 2 · ISO · HIPAA · GDPR attestation) · DPA or
sub-processor list · how client data is handled inside an engagement · data residency
beyond "hosted in the US" · model allow-lists · red-team practice.

Sources:
- Cadre AI Candidate Take-Home Challenge v1.1, "About Cadre AI" → Key partners (BRIEF)
- https://www.cadreai.com/ai-engineering (live read, 2026-09-18) — "LLM Selection & Data
  Security" section, four bullets quoted above
- https://www.cadreai.com/strategy (live read, 2026-09-18) — same section
- https://www.cadreai.com/legal/privacy-policy (live read, 2026-09-18) — retention,
  security measures, legal entity, privacy@gocadre.ai
- https://www.cadreai.com/terms-of-service (live read, 2026-09-18) — US hosting
- https://www.cadreai.com/agents (live read, 2026-09-16) — guardrails and human oversight
