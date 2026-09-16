# Industries and departments

## Industries Cadre publishes agents for
Taken verbatim from the industry filter on https://www.cadreai.com/agents: `[V:live]`
Retail & E-commerce · Hospitality · Mortgage & Lending · Financial Services ·
Construction · Manufacturing & Logistics · Real Estate · Professional Services ·
Private Equity

The brief independently names: professional services, private equity, financial services,
real estate, construction, manufacturing, retail "and more". `[V:brief]`

Published industry example:
- **Private equity** — deal sourcing, and due diligence work including **CIM analysis,
  financial modeling, and contract review**. `[V:live]`
  Source page: https://www.cadreai.com/industries/private-equity
- **Construction** — a published agent example, the **Change Order Tracker**: it documents
  scope changes as they happen, generates change-order pricing, and protects margin on each
  change. `[V:live]`
  Source page: https://www.cadreai.com/agents

## Departments
Cadre publishes AI solutions organised **by department** as well as by industry. `[V:live]`
Source page: https://www.cadreai.com/departments
A published department page exists for **Customer Success** — predicting at-risk accounts,
automating health monitoring, scaling personalised engagement. `[V:live]`
Cadre publishes agents by department for: Legal, Technology, Marketing, Customer Success,
Finance, Operations, Executive Leadership and Sales. `[V:live]`
Source page: https://www.cadreai.com/departments/customer-success

## What the bot says
Scenario: industries
Keywords: industry, industries, sector, vertical, do you work with, work with my, private equity, construction, manufacturing, retail, financial services, real estate, hospitality, professional services

> Cadre works with B2B companies and publishes work across professional services, private
> equity, financial services, real estate, mortgage and lending, construction, retail and
> e-commerce, manufacturing and logistics, and hospitality. The published example I can
> point to in detail is private equity — deal sourcing and due diligence work like CIM
> analysis, financial modeling and contract review. If your industry isn't on that list I
> won't guess whether it's a fit; a strategist can tell you directly at
> https://www.cadreai.com/contact, or I can pass your details to the team.

## Answering "do you work with my industry?"

This is the highest-traffic prospect question and the easiest place to hallucinate.
Three cases, and only three:

1. **Industry is on the list above** → yes, confirm it, name one published example if the
   KB has one for that industry, offer the contact page.
2. **Industry is not listed but is clearly B2B** → do **not** say no and do **not** say
   yes. Say Cadre's published focus is B2B companies with manual workflows that get less
   efficient as they grow, that this industry is not one of the ones Cadre publishes a page
   for, and that a strategist can confirm fit directly. Offer handoff.
3. **Industry is consumer/B2C, regulated in a way Cadre says nothing about, or unclear** →
   handoff, no judgement offered.

Never extrapolate from one industry to a neighbouring one ("you do construction, so you
must do civil engineering"). Adjacency is not a published fact.

Sources:
- https://www.cadreai.com/agents (live read, 2026-09-16)
- Cadre AI Candidate Take-Home Challenge v1.1, "About Cadre AI" table (BRIEF)
- https://www.cadreai.com/industries/private-equity (live read, 2026-09-16)
- https://www.cadreai.com/departments (live read, 2026-09-16)
- https://www.cadreai.com/departments/customer-success (live read, 2026-09-16)
- https://www.cadreai.com/ai-engineering (live read, 2026-09-16)
