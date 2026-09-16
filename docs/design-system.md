# Design system

Small on purpose. Enough to keep five screens consistent and no more — a token set
nobody can hold in their head gets ignored, and an ignored design system is worse than none.

**Reference mocks:** `docs/mock/*.dc.html` (also on the design canvas). They are the
source of truth for layout and copy tone. Build to them; don't reinterpret them.

## Why it looks like this

Cadre sells judgement to private-equity boards and professional-services partners. The
visual register is **a competent front desk, not a consumer AI toy**. That rules out the
defaults this kind of app drifts into: purple-blue gradients, glassmorphism, emoji, a
bouncing avatar, Inter. A serif display face over a plain sans, on warm paper, reads as a
firm rather than a demo.

## Tokens

```
Surface       #FBFAF7   warm paper, page ground
Raised        #FFFFFF   bot bubbles, header, inputs, cards
Ink           #1A1D1A   body text
Ink muted     #4F554F   secondary text        (8.0:1 on surface)
Ink subtle    #6B726B   captions, placeholders (5.1:1 on surface)
Border        #E3E1DA   1px hairlines
Accent        #2F5D50   deep green: buttons, links, focus, user bubble tint
Accent soft   #EAF0ED   user bubble, accent badge background
Warn          #8A5616   economy tier, simulated badge
Warn soft     #F6EEE3
Neutral       #5C625C   static tier
Neutral soft  #EFEEE9
```

Green rather than blue: blue is the default every chatbot reaches for, and green reads
closer to Cadre's own site without imitating it.

```
Radius    4 (bubble tail) · 8 (inputs, small buttons) · 10 (composer) · 12–14 (bubbles, cards) · 999 (pills)
Spacing   4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 24 · 28 · 32   (no arbitrary values)
Type      Fraunces 500/600 — display only (h1, section heads, wordmark)
          Public Sans 400/500/600 — everything else
Scale     38/22/19 display · 16 lead · 15 body · 14 controls · 13 form labels · 12 captions
Line      1.15 display · 1.6 body · 1.55 secondary
Width     max 640px for prose, 78% for bot bubbles, 70% for user bubbles
```

## Components

| Component | Rules |
|---|---|
| **Header** | Wordmark + "Support assistant" + tier badge, right-aligned. 1px bottom border. Never a logo the KB can't source. |
| **Tier badge** | Pill, 6px dot + label. **Plain language, never a number:** "Live model" / "Economy mode" / "Saved answers". A prospect does not need to know we're economising on tokens. |
| **Simulated badge** | Warn pill, no dot, sits left of the tier badge. Only ever visible in demo mode. |
| **User bubble** | Accent-soft, right-aligned, radius `14 14 4 14`, max 70%. |
| **Bot bubble** | White + 1px border, left-aligned, radius `14 14 14 4`, max 78%. |
| **Stream cursor** | 2px × 17px accent bar at the end of the streaming bubble. No typing dots, no shimmer. |
| **Suggested chips** | Real `<button>`, pill, ≥44px tall, wrap freely. Six, matching the brief's six scenarios — these are what a reviewer clicks first. |
| **Handoff card** | White, 3px accent left border, 2-col grid of fields collapsing to 1 on mobile. Sits inline in the transcript, not a modal. |
| **Degradation notice** | Dashed border, neutral-soft fill, info glyph. Explains the shorter answers without mentioning money. |
| **Composer** | Input + Send, both ≥48px (46 mobile). Persistent caption underneath stating the bot's limits. |

## Non-negotiables

- **Real elements.** `<button>`, `<a href>`, `<input>` + `<label>`. Never `role="button"`
  on a div — Tab skips it. Icon-only buttons carry `aria-label`.
- **Touch targets ≥44px.** Composer 48px, chips 44px, mobile send 46×46.
- **Contrast ≥4.5:1** for body, 3:1 at 24px+. The muted/subtle greys above are chosen to
  pass on `#FBFAF7`; don't lighten them.
- **Icons are inline stroke SVG.** No emoji, no icon font.
- **No horizontal scroll at 375px.**
- **Focus is visible.** Never `outline: none` without a replacement.

## Streaming and screen readers — the one non-obvious rule

The transcript is one `aria-live="polite" aria-atomic="false"` region. **Tokens are not
announced as they arrive.**

Token-by-token streaming is structurally incompatible with how live regions work: a naive
implementation pushes updates 5–20 times a second and a screen reader either floods or
drops them. The pattern that actually works — and this is settled practice, not our
invention — is to let the text appear silently while it streams, announce the **finished
message once**, and announce **state transitions** ("generating", "complete", "using saved
answers") rather than content.

Mount the live region at the app root and keep it in the DOM permanently. A live region
created at the moment content arrives announces nothing.

Sources: [The Accessibility Gap in AI Interfaces](https://tianpan.co/blog/2026/04/17/ai-accessibility-streaming-screen-readers) ·
[Accessible AI Chat Interfaces](https://accessibility.build/guides/accessible-ai-chat) (both read 2026-09-16)

## Copy tone in the UI

Same register as the bot: direct, warm, brief. No "Oops!", no "Great question!", no
exclamation marks. Error and empty states say what happened and what to do next.

**The composer caption is load-bearing:** it sets expectations before the user types, which
is cheaper than correcting them after.
