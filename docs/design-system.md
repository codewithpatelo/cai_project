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

## Token architecture — read this before writing a single colour

**The mocks carry literal hex values. The app must not.**

`.dc.html` files need literal hexes because the canvas format paints them inline. If the
build copies those hexes into components, **dark mode becomes impossible without touching
every file** — and this is exactly the mistake that looks harmless for two hours and then
costs a rewrite.

The app defines every token once, as CSS custom properties, and components reference
`var(--*)` and nothing else:

```css
:root {                      /* light, and the default */
  --surface: #FBFAF7;  --raised: #FFFFFF;  --ink: #1A1D1A;
  --ink-muted: #4F554F; --ink-subtle: #6B726B; --border: #E3E1DA;
  --accent: #2F5D50;   --accent-soft: #EAF0ED; --on-accent: #FFFFFF;
  --warn: #8A5616;     --warn-soft: #F6EEE3;
  --neutral: #5C625C;  --neutral-soft: #EFEEE9;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* dark values */ } }
:root[data-theme="dark"] { /* dark values */ }
```

**A hardcoded hex anywhere in `app/` is a bug**, catchable with a grep and worth one in
`/verify`.

## Tokens — light

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

## Tokens — dark

Not the light palette inverted. Dark surfaces keep the same warm cast, and **the accent
gets lighter**, because a deep green that reads well on paper disappears on charcoal.

```
Surface       #1A1A17   warm charcoal
Raised        #232420   bubbles, header, inputs
Ink           #F2F1EC
Ink muted     #B5B8B0
Ink subtle    #8C918A
Border        #34352F
Accent        #7FB8A4   lighter green — buttons, links, focus
On accent     #1A1A17   text ON an accent button (dark text on light green)
Accent soft   #24312C   user bubble
Warn          #D9A468   Warn soft #2E2519
Neutral       #A0A59D   Neutral soft #262723
```

**Measured, not eyeballed.** Every pair below was computed with the WCAG relative-luminance
formula; the script is in the commit that added this section.

| Pair | Light | Dark |
|---|---|---|
| body on surface | 16.30 | 15.42 |
| secondary on surface | 7.33 | 8.68 |
| caption on surface | **4.74** | 5.43 |
| link on surface | 7.18 | 7.72 |
| button text on accent | 7.49 | 7.72 |
| user bubble text | 14.73 | 11.97 |
| warn badge | 5.33 | 6.78 |
| neutral badge | 5.39 | 5.99 |

All pass 4.5:1. **Light caption text is the tightest at 4.74** — do not lighten
`--ink-subtle` in light mode without re-measuring.

## Theme switching

Three states, one control:

1. **Default: follow the OS** via `prefers-color-scheme`. Most people never touch the toggle
   and should get the right answer anyway.
2. **Toggle overrides** by setting `data-theme="light"|"dark"` on `<html>`.
3. **The override persists** in `localStorage`. Wrap the read in try/catch — it throws in
   some privacy modes, and a theme preference is never worth a white screen.

Set the attribute in a tiny inline script **before first paint**, or the page flashes light
before switching. That flash is the only thing users actually notice about theme handling.

The control is a real `<button>`, 44×44, in the header, with `aria-label="Switch to dark
mode"` / `"Switch to light mode"` — the label states the action, not the current state.
Sun and moon are inline stroke SVG.

**Respect `prefers-reduced-motion`:** no transition on the theme change for those users, and
none on the streaming cursor.

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

## Responsive

Three sizes, one layout. There is no separate mobile build and no breakpoint zoo — the chat
column is fluid and only a few things change.

| Width | Behaviour |
|---|---|
| **< 480px** | 16px gutters · composer 46px, icon-only send · header drops "Support assistant" · handoff form 1 column · bubbles max 90% · chips scroll horizontally or wrap |
| **480–900px** | 24px gutters · composer regains its text label · bubbles max 85% |
| **> 900px** | 32px gutters · transcript capped at **760px and centred** — full-width chat on a 1440px monitor is unreadable · bubbles 78% bot / 70% user |

Rules that matter more than the numbers:

- **Mobile-first.** Write the small layout, then add `min-width` queries. Retrofitting down
  is how horizontal scroll gets shipped.
- **No fixed heights** on anything containing text. Fixed heights in the mocks are an
  artboard requirement, not a design instruction.
- **The composer must stay reachable** when the mobile keyboard opens: `dvh`, not `vh`.
  `100vh` under an iOS keyboard pushes the input off-screen — a classic and very visible bug.
- **Test at 320px**, not just 375. It still exists and it's where layouts break.
- Touch targets stay ≥44px at every width; they get *more* important on small screens, not
  less.

## Accessibility

Not a pass at the end. It's a build constraint, and every item here is checkable.

- **Real elements.** `<button>`, `<a href>`, `<input>` + `<label>`. Never `role="button"` on
  a div — Tab skips it. Icon-only buttons carry `aria-label`.
- **Keyboard-complete.** Every control reachable by Tab in a sensible order, with a
  **visible focus ring**. Never `outline: none` without a replacement. Enter submits the
  composer.
- **Contrast** ≥4.5:1 body, 3:1 at 24px+, in **both** themes. The table above is the record.
- **Never colour alone.** The tier badge carries a label, not just a dot colour.
- **Zoom to 200%** without loss of content or horizontal scroll.
- **`prefers-reduced-motion`** respected: no theme transition, no streaming-cursor blink.
- **Form errors** are associated with their field (`aria-describedby`) and announced, not
  just coloured red.
- The streaming live-region rule below is the subtle one — read it.

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
