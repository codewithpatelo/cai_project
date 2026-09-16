---
description: Audit kb/*.md for unsourced facts, invented URLs and unverified claims.
argument-hint: "[--live]  re-fetch every source page and promote/delete tags"
---

Audit the knowledge base. Report findings; **do not fix silently** — an auditor that edits
is not an auditor.

## 1. Structural (mechanical)
- Every `##` section has a `Sources:` block in its file.
- Every `Sources:` entry is a full URL with a read date, or `BRIEF`.
- Every factual bullet carries a `[V:brief]`, `[V:snippet]` or `[V:live]` tag.
- Every topic file has either facts or an explicit `### Not published` block.

```bash
grep -Ln "^Sources:" kb/0*.md            # files missing a sources block
grep -n "^- " kb/0*.md | grep -v "\[V:"  # untagged bullets
```

## 2. Invented-content sweep — the part that actually matters
```bash
grep -rniE "portal\.|/login|/signin|app\.cadreai|calendly|hubspot|savvycal" kb/
grep -rniE "\\$[0-9]|per hour|per month|starting at|pricing starts" kb/
grep -rniE "SOC ?2|ISO ?27|HIPAA|GDPR compliant|PCI" kb/
```
Every hit is presumed invented until traced to a `Sources:` URL.

Then read by hand for the three highest-risk items:
- **Any portal/login/booking URL.** Only `https://www.cadreai.com/contact` is verified.
- **The AI Maturity Index pillar list.** Must be **four** names, with the partiality
  stated. Five or more means something was invented.
- **Any security or compliance claim.** Cadre publishes none; the KB says so.

## 3. Cross-check against the bot
Does every `### Not published` block have a matching escalation trigger in
`kb/08-contact-and-escalation.md`? A gap there is a topic where the bot has no facts *and*
no instruction to hand off — which is exactly where it improvises.

## 4. `--live` mode
For each `[V:snippet]` fact: fetch the source URL, confirm the claim on the live page.
- Confirmed → promote to `[V:live]`.
- Not found → **delete the fact.** Do not soften it, do not hedge it, do not keep it with a
  note. A fact that isn't on the page isn't a fact.
- Page unreachable → leave `[V:snippet]` and report it; the design environment had
  `cadreai.com` blocked by an egress proxy, so this may recur.

## 5. Report
| Severity | File | Finding | Suggested action |
Then: pass / fail, and the count of facts at each verification level. **`--live` must be run
and pass before the final deploy** — shipping with unverified `[V:snippet]` facts is
shipping a bot that might be confidently wrong about its own company.
