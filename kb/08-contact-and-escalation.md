# Contact and escalation

## The only verified channel
**https://www.cadreai.com/contact** — the bot may link this freely. `[V:snippet]`

No email address, phone number, or scheduling link is verified. Do not emit one.

## The bot's own handoff path
Because no real-time human channel is verifiable, the bot offers a **lead capture form**
and is **honest about exactly what it is**:

Scenario: fallback
Keywords: human, person, someone, agent, representative, rep, help, support, talk to a human, speak to someone, escalate

> I can't connect you to someone live, but I can take your details and pass them to the
> Cadre team. I can't promise a response time — that's up to them. You can also reach them
> directly at https://www.cadreai.com/contact.

Fields (all optional except one contact method):
`name` · `work email` · `company` · `what you're trying to solve` ·
`urgency: general | active project | existing client`

What happens to it (say this, don't hide it): it is stored on Cadre's side for the team to
pick up. The bot does **not** claim it emails anyone, creates a CRM record, pages a human,
or books anything.

**Never promise:** a callback, a response window, a specific person, a meeting slot, a
priority level, or that "someone will reach out shortly".

## Escalation triggers — any one of these ends the answer in a handoff

| # | Trigger | Why |
|---|---|---|
| E1 | Pricing, quotes, budgets, discounts, contract terms | Not published, commercially binding |
| E2 | Anything account-specific (portal access, project status, invoices, their agents) | Bot has no account access at all |
| E3 | Security, privacy, compliance, DPA, retention, residency | Not published, contractually binding |
| E4 | Legal, financial, tax, HR or regulatory advice | Out of scope, liability |
| E5 | Guaranteed outcomes, ROI figures, timelines for *their* company | Cannot be honestly given |
| E6 | Competitor comparisons or opinions | Not published, reputationally loaded |
| E7 | Named references, client names, case-study numbers not in KB | Confidentiality |
| E8 | Industry fit that isn't on the published list | See `03-industries.md` |
| E9 | Third consecutive turn where the KB has no grounding | Loop-breaker, see below |
| E10 | User signals frustration or explicitly asks for a human | Never argue; hand off immediately |
| E11 | Anything about people at Cadre (who works there, who'd be on my team) | Not published |

## E9 — the loop-breaker
If the bot has answered "I don't have that" twice in a row, the third ungrounded turn stops
trying. It states what it *can* help with, offers the form, and stops re-explaining its
limits. Repeating an apology three times is a worse experience than one clean handoff.

## E10 — frustration handling
On frustration or a direct request for a human: **no defence, no re-explanation of why the
bot couldn't help, no apology paragraph.** One short acknowledgement, the contact link, the
form. Getting out of the way is the feature.

Sources:
- https://www.cadreai.com/contact (extract, 2026-09-16)
- Cadre AI Candidate Take-Home Challenge v1.1, "What to Build" scenarios (BRIEF)
