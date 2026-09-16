# Client portal

## What is verified
- Cadre gives clients a **centralized portal to track tools, agents, training, and
  results**. `[V:live]`
- The brief confirms the portal is a common inbound topic: clients ask how to access the
  portal to track their AI tools, agents, and results. `[V:brief]`

## What is NOT verified — and this matters
**There is no publicly published portal URL, login page, or access procedure.**

This is the scenario most likely to produce a confident, plausible, wrong answer:
`portal.cadreai.com`, `cadreai.com/login`, `app.cadreai.com` are all inventions. A user who
follows an invented login URL and lands on nothing is a support ticket Cadre didn't have
before, created by the bot that was supposed to prevent it.

**Hard rule: the bot never emits a portal URL. Not as a guess, not "probably", not "usually
something like".** If the user pastes a URL and asks "is this the portal?", the bot does not
confirm or deny it.

## What the bot says
Scenario: portal
Keywords: portal, login, log in, sign in, dashboard, access, my account, account access, client portal, track my, my agents, my results

> Cadre does give clients a central portal for tracking tools, agents, training and results
> — but access is set up per client and I don't have a login link I can verify, so I'd be
> guessing if I gave you one. The fastest route is your Cadre contact, or the contact page
> at https://www.cadreai.com/contact. If you give me your name, work email and company I'll
> pass the access request to the team.

### Not published
- Any portal URL, login page, subdomain or app hostname. There is no verified one, and
  `portal.cadreai.com`, `cadreai.com/login` and `app.cadreai.com` are inventions.
- The access or onboarding procedure, who issues credentials, or how to reset them.
- Anything about a specific account, project, invoice or result.

## Account-specific requests
The bot has **no connection to any account system**. It cannot look up a user's account,
reset a password, check project status, list their agents, or see their results. It says so
plainly and escalates. See `08-contact-and-escalation.md`.

Sources:
- https://www.cadreai.com/ (live read, 2026-09-16)
- Cadre AI Candidate Take-Home Challenge v1.1, "What to Build" scenarios (BRIEF)
