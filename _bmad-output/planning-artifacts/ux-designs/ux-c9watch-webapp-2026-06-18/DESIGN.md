---
name: c9watch-webapp
description: Single-operator desktop cockpit for watching a fleet of Claude Code agent sessions. Neutral-charcoal dark (Catppuccin-accented), terminal-adjacent, KDE-native. Urgency carried by Column placement and by size/proximity (the adaptive hero), never by chrome. One reserved hot hue (gold) means "needs you."
status: final
created: 2026-06-18
updated: 2026-06-18
colors:
  # Surfaces — NEUTRAL CHARCOAL (faint warmth; de-tinted off BOTH blue-black and taupe).
  # Depth by tone, not shadow. The board uses these to encode near/far (hero vs recessed).
  bg-base: '#1a1a18'           # the window ground (near-neutral dark)
  bg-surface: '#232220'        # rail, panels, general surface
  bg-surface-raised: '#2c2b27' # hover, dialog body, rail-active, inputs
  bg-col-hero: '#201f1c'       # the HERO board column container (near, raised)
  bg-col-calm: '#151513'       # recessed/flank board column (far, inset — the darkest container)
  bg-card-hero: '#2a2925'      # hero card (near, full-contrast)
  bg-card-calm: '#1e1e1b'      # recessed/flank card (far; rendered at ~0.82 opacity)
  bg-terminal: '#141312'       # embedded terminal — the deepest neutral black, the focal layer
  scrim: 'rgba(10,10,8,0.62)'  # modal backdrop
  # Lines
  border: '#34332e'            # default hairline between surfaces
  border-strong: '#423f39'     # active/focused container edge
  border-card: '#403e37'       # card edge — guarantees a card reads distinct from its column
  # Text — neutral-charcoal ramp (warm-neutral off-white, not golden)
  text-primary: '#d6d3ca'
  text-secondary: '#a4a094'
  text-muted: '#6b685e'        # secondary card fields, disabled
  text-dim: '#47453d'          # recessed/"far" card text in calm columns
  # Status / accent — Catppuccin Mocha family + one custom gold alert. The ONLY semantic colors; each = one meaning.
  working: '#89b4fa'           # Catppuccin blue — busy, leave alone (used sparingly)
  needs-you: '#ffcf29'         # custom gold — THE reserved alert hue (Needs-you only); the one HOT hue, "warm = come unblock me"
  done: '#a6e3a1'              # DEFINED-BUT-UNUSED token — no live `done` state (see contract §4: 3-state model, no Done column). Kept in frontmatter so the 1:1 token test stays green; not referenced by any live component.
  idle: '#807d72'              # neutral muted — the live `idle` column accent (an Idle dot)
  danger: '#db4b4b'            # deeper red — destructive confirm only (Stop / Quit anyway)
  focus-ring: '#b4befe'        # Catppuccin lavender (cool) — keyboard focus outline; never a fill, never a status, never warm (so it can't imitate the gold alert)
typography:
  font-ui: "system-ui, 'Noto Sans', 'Segoe UI', sans-serif"
  font-mono: "'JetBrains Mono', ui-monospace, 'Hack', 'Noto Sans Mono', monospace"
  display:                    # rare — empty-state headlines only
    fontFamily: '{typography.font-ui}'
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.3'
  heading:                    # column headers, focused-session title
    fontFamily: '{typography.font-ui}'
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: 0.01em
  body:                       # card sessionName (primary line)
    fontFamily: '{typography.font-ui}'
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.4'
  label:                      # buttons, tags, rail labels
    fontFamily: '{typography.font-ui}'
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.3'
  meta:                       # secondary card detail (pid · tasks · cost)
    fontFamily: '{typography.font-ui}'
    fontSize: 11.5px
    fontWeight: '400'
    lineHeight: '1.3'
  mono:                       # projectPath, pendingToolName, pid value, terminal
    fontFamily: '{typography.font-mono}'
    fontSize: 12.5px
    fontWeight: '400'
    lineHeight: '1.45'
rounded:
  sm: 4px      # tags, inputs, dots' chips
  md: 6px      # cards, buttons
  lg: 8px      # panels, dialog, terminal frame
  full: 9999px # status dots, tray badge
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
  rail-width: 240px        # focused-session attention rail
  rail-width-collapsed: 56px
  card-min-height: 92px
  gutter: 16px             # between board columns
  card-gap: 12px           # between cards within a column
elevation:
  shadow-dialog: '0 12px 32px rgba(13,14,20,0.55)'
  shadow-pop: '0 6px 18px rgba(13,14,20,0.45)'
components:
  status-dot:
    size: 8px
    radius: '{rounded.full}'
    working: '{colors.working}'
    needs-you: '{colors.needs-you}'
    done: '{colors.done}'
    idle: '{colors.idle}'
  board-column-hero:           # center, wide slot — holds the highest-priority NON-EMPTY column
    background: '{colors.bg-col-hero}'
    width: '~50% (CSS grid 0.66fr / 1.25fr / 0.66fr)'
    edge-needs-you: '0 0 0 1px rgba(255,207,41,0.12)'  # faint gold when hero = Needs-you
    edge-working: '0 0 0 1px rgba(137,180,250,0.10)'    # faint blue when hero = Working (calm cue, low opacity)
  board-column-calm:           # the two flank slots — recessed, "far"
    background: '{colors.bg-col-calm}'
    width: '~25% each'
  session-card-hero:           # cards in the hero column — large, full-contrast, "near"
    background: '{colors.bg-card-hero}'
    border: '{colors.border-card}'
    accent-bar: '3px left'     # in the hero column's accent: {colors.needs-you} OR {colors.working}
    radius: '{rounded.md}'
    padding: '{spacing.3}'
  session-card-calm:           # cards in a flank column — compact, dimmed, "far"
    background: '{colors.bg-card-calm}'
    border: '{colors.border-card}'
    opacity: '0.82'
    text: '{colors.text-dim}'
    radius: '{rounded.md}'
  column-header:
    font: '{typography.heading}'
    count-color: '{colors.text-muted}'
    needs-you-accent: '{colors.needs-you}'
    working-accent: '{colors.working}'
    done-accent: '{colors.idle}'
  rail-item:
    background: 'transparent'
    background-active: '{colors.bg-surface-raised}'
    label: '{typography.label}'
    needs-you-fill: 'rgba(255,207,41,0.14)'
    needs-you-border: '{colors.needs-you}'
    height: 44px
    height-needs-you: 56px      # the "enlarge" treatment
  button-primary:
    background: '{colors.working}'
    foreground: '{colors.bg-base}'
    radius: '{rounded.md}'
    font: '{typography.label}'
  button-ghost:
    background: 'transparent'
    foreground: '{colors.text-secondary}'
    border: '{colors.border}'
    radius: '{rounded.md}'
  button-danger:
    background: '{colors.danger}'
    foreground: '#ffffff'
    radius: '{rounded.md}'
  tray-badge:
    background: '{colors.needs-you}'
    foreground: '{colors.bg-base}'   # dark numerals — gold is light, so white fails contrast
    radius: '{rounded.full}'
  embedded-terminal:
    # xterm.js ITheme — reads these exact values (Catppuccin Mocha ANSI on a neutral-black
    # ground). The JS theme object and the CSS chrome are the SAME tokens: one source of truth.
    background: '{colors.bg-terminal}'
    foreground: '{colors.text-primary}'
    cursor: '#d6d3ca'
    cursorAccent: '{colors.bg-terminal}'
    selectionBackground: 'rgba(60,58,48,0.85)'
    black: '#1a1a18'
    red: '#f38ba8'
    green: '#a6e3a1'
    yellow: '#f9e2af'
    blue: '#89b4fa'
    magenta: '#cba6f7'
    cyan: '#94e2d5'
    white: '#a4a094'
    brightBlack: '#47453d'
    brightRed: '#f38ba8'
    brightGreen: '#a6e3a1'
    brightYellow: '#f9e2af'
    brightBlue: '#89b4fa'
    brightMagenta: '#cba6f7'
    brightCyan: '#94e2d5'
    brightWhite: '#d6d3ca'
---

## Brand & Style

c9watch-webapp is a **cockpit, not a dashboard**. The operator runs irreversible gated procedures — `prod` deploys, configmap changes, environment refreshes — through a fleet of Claude Code agents, and the one job that matters is *never miss an agent that needs you*. The visual language serves that single behavioral bar: a calm, dark, terminal-adjacent surface where almost nothing competes for attention, so the one thing that *should* grab the eye — a session waiting on you — actually does.

The posture is **operator-to-operator, instrument-panel sober**, in **neutral charcoal** — a faintly-warm dark grey that deliberately sits *between* the cool blue-black of a typical dev-tool dark theme and a fully warm taupe (both were tried and dialed back). Accents are **Catppuccin Mocha** (soft blue, green) on that neutral ground, plus **one custom gold** reserved for the alert. The chrome recedes; the embedded terminal reads as a real terminal (the deepest black on screen); and exactly one hot hue — gold — means *come unblock me*. Color is rationed.

Urgency is carried two ways, both **column-level** (never `prod`-vs-`develop` weighting — that is beyond-v1, deliberately): (1) **which Column** a card sits in, and (2) **size/proximity** — the **adaptive hero**. The center, wide, full-contrast slot always holds the column the operator should be looking at: **Needs-you when anything is waiting; otherwise Working.** Things that need you are *big and near*; calm columns recede *small and far*. The same metaphor runs through the focused-session rail (FR-16 enlarges Needs-you). If a future reader wants to make something "pop," the answer is almost always *no* — the gold has to stay the loudest thing in the room, or the product's whole promise erodes (SM-C1, alert fatigue).

This is a from-scratch token set (no component library): a small, bespoke surface — board, cards, rail, terminal, two dialogs. CSS custom properties generated 1:1 from the frontmatter tokens; scoped CSS Modules per component; the xterm.js theme object reads the same tokens so the terminal and the chrome can never drift apart.

## Colors

The palette is **neutral-charcoal surfaces, a few Catppuccin-family accents, one custom gold alert, and nothing else.** A cockpit shouldn't compete with the one gold dot that means *act now*.

- **Surfaces are neutral charcoal** (faintly warm) and layer to encode **near/far**. The general ramp brightens forward: `bg-base` (`#1a1a18`, window) → `bg-surface` (`#232220`, rail/panels) → `bg-surface-raised` (`#2c2b27`, hover/dialog). On the **board**, depth means proximity: the **hero column** sits on `bg-col-hero` (`#201f1c`, raised/near) with hero cards on `bg-card-hero` (`#2a2925`); the **flank columns** recede onto `bg-col-calm` (`#151513`, the darkest/inset/far) with dimmed `bg-card-calm` (`#1e1e1b`) cards at ~0.82 opacity. The **embedded terminal goes deepest** — `bg-terminal` (`#141312`, the deepest neutral black) — so the live terminal pulls focus the moment you enter a session.
- **`needs-you` gold (`#ffcf29`) is the reserved alert hue** — a bright, warm gold that reads like a warning light against the neutral charcoal. It appears on: the Needs-you status dot, the Needs-you card's left accent bar, the hero-column edge *when Needs-you is the hero*, the Needs-you rail item, the `pendingToolName`, and the tray badge. **Nowhere else** — not chrome, not hover, not decoration. When nothing needs you, gold is absent from the whole window. Every non-alert use steals from the signal. (Because gold is light, anything sitting *on* it — the tray-badge numerals — is dark, not white.)
- **`working` blue (`#89b4fa`, Catppuccin blue)** means *busy, leave alone* — the Working dot, the Working tick, the primary-action button, and the hero accent bar **when Working is the hero**. It is the one cool note in a neutral room, used sparingly; the Working-hero column edge is a faint **blue tint** (a calm cue, not a gold alert), kept low so the "all quiet" state stays calm.
- **`idle` muted (`#807d72`)** is the live **idle** column accent (muted = *idle/sitting* — an alive session awaiting the operator's next prompt; the live `WaitingForInput` status). It renders **calm** — idle earns the OS attention signal (notification/badge) but never the in-app gold emphasis (FR-16 is Needs-you-only) and never the hero slot. The **`done` green (`#a6e3a1`)** token is **defined-but-unused** — there is **no live `done` state** (exited sessions vanish; no Done column). It is kept in the token set only so the 1:1 token test stays green. (Status→column model is authoritative in `c9watch-0.8.1-contract.md §4` — 3-state: needs-you/working/idle; exited vanishes; no Done column.)
- **`danger` (`#db4b4b`)** is a red, used **only** on destructive confirm buttons (Stop session, Quit anyway). It is a *cool red*, kept clearly apart from the warm gold so "an agent needs you" and "this will kill an agent" never read as the same color — the gold→red separation is wider than the old rose→red was.
- **`focus-ring` lavender (`#b4befe`, Catppuccin lavender)** is the keyboard-focus outline only — never a fill, never a status. It is deliberately **cool**: with gold owning "warm = needs you," the focus ring must not be warm or it would imitate the alert. (It replaces the previous amber ring, which sat too close to the gold.) It reads as a focus affordance, not a status, even though it shares the cool end with `working` blue — a thin transient outline never competes with the working dot/fill.

The **embedded terminal keeps the full Catppuccin Mocha ANSI palette** (including ANSI `red #f38ba8` and `yellow #f9e2af`) — that is verbatim machine output on the deepest-black layer, a different plane from the app's gold/lavender semantics. Do not "reconcile" the terminal's ANSI red with the gold alert; they never share a surface.

Avoid: gradients, heavy glows, a second hot color, any per-environment (`prod`/`develop`) color weighting, gold anywhere that isn't a genuine Needs-you signal, a warm focus ring.

## Typography

Two families, one rule: **chrome is sans, data is mono.**

- **`font-ui`** (`system-ui` → Noto Sans on Fedora KDE) carries all chrome: column headers, card titles (`sessionName`), buttons, rail labels, dialog copy. Using the system font is what makes the app read as KDE-native rather than web-embedded.
- **`font-mono`** (JetBrains Mono / Hack) carries everything that *is* terminal data or comes verbatim from `c9watch`: the embedded terminal, `projectPath`, `pendingToolName`, the `pid` value. Monospace for these is semantic — it signals "this is the machine's truth, shown verbatim," consistent with the thin-over-c9watch philosophy.

The ramp is deliberately compressed (11.5–14px chrome, 20px display) because a cockpit is dense — many cards, one window. `display` (20px) is rare: empty-state headlines only. No all-caps, no display sizes for emphasis — emphasis is color and Column, not type size. (Terminal font-size is operator-controllable at runtime and is not bound by this ramp.)

## Layout & Spacing

A 4-based scale (`4 / 8 / 12 / 16 / 20 / 24 / 32`). The largest gaps separate the three Board columns (`gutter` 16px); the smallest sit inside a card.

- **Board view — adaptive center hero.** Three columns, but **not equal width**: a center **hero** slot (~50%, CSS grid `0.66fr / 1.25fr / 0.66fr`) flanked by two recessed slots (~25% each). The hero slot always holds the **highest-priority non-empty column** by the cascade **Needs you → Working → Idle**: when ≥1 session needs you, Needs-you is the central hero (gold-edged); when none do, Working is promoted to the hero (faint-blue edge), and the now-empty Needs-you rests calm in the left flank ("All quiet."). Idle is always the right flank and never the hero. The two left/center occupants (Needs-you, Working) swap left-flank↔center on the 0↔1 Needs-you boundary; Idle stays put. Columns scroll independently and always render (empty → header + one-line hint, never collapses — FR-1 empty-state). The hero swap animates as a compositor-friendly width/position transition (~250–300ms) and doubles as an in-board attention cue. (Status→column model is authoritative in `c9watch-0.8.1-contract.md §4` — 3-state: needs-you/working/idle; exited vanishes; no Done column.)
- **Focused-session view:** the **attention rail** (`rail-width` 240px) docks left; the embedded terminal takes all remaining width as the main view. The rail is *always present* in this view — it is the in-app attention sink (FR-16). It may collapse to icons (`rail-width-collapsed` 56px) but never disappears.
- One window, no routing. Board ↔ focused-session is a view-state swap, not navigation. Modals (new-session picker is native-OS; Quit-guard, Stop-confirm) stack **one level deep, never two.**

## Elevation & Depth

Depth is **tonal, not cast-shadow** — consistent with a flat KDE-native instrument panel — and on the board it **encodes proximity**: the hero column is the lightest/nearest container (`bg-col-hero`) with full-contrast cards, while the flank columns sink to the darkest inset tone (`bg-col-calm`) with dimmed cards (~0.82 opacity, `text-dim`). Near = bright + big; far = dark + small. Off the board, the rail/panels sit on `bg-surface` and lift to `bg-surface-raised` on hover/active. Shadow is reserved for **genuinely floating layers only**: the Quit-guard / Stop dialog (`shadow-dialog` + `scrim`) and transient popovers (`shadow-pop`). The hero column carries only a faint 1px accent edge (gold, or a low blue tint when Working is hero), not a shadow. The embedded terminal is the one *inverted* depth cue — it recedes into the deepest neutral black, which paradoxically pulls focus because it's the highest-contrast region.

## Shapes

Crisp, tool-like corners: `sm` 4px (tags, inputs), `md` 6px (cards, buttons), `lg` 8px (panels, dialog, terminal frame). `full` is reserved for **status dots and the tray badge only** — the round dot is the atomic unit of the whole status language, so roundness must mean "status," nothing else. No pills on buttons; buttons are 6px — this reads "instrument," not "consumer app."

## Components

→ Rendered references (built from these tokens): [`mockups/board.html`](./mockups/board.html), [`mockups/focused-session.html`](./mockups/focused-session.html), [`mockups/quit-guard.html`](./mockups/quit-guard.html). **This spine wins on conflict with any mock.**

- **Status dot** — 8px `full` circle, the atomic status unit. Live dots: `working` blue · `needs-you` gold · `idle` muted (the `done` green token exists but is **unused** — there is no live `done` state; see contract §4). Appears on every card and every rail item. Carries a text label for accessibility; color is never the only signal (see Do's/Don'ts and EXPERIENCE.Accessibility).
- **Session card** — two presentations driven by whether its column is the hero. **Hero card** (`bg-card-hero`, larger type, `padding/3`, `md` corners): a **3px left accent bar** in the hero column's accent — `needs-you` gold when the hero is Needs-you, `working` blue when the hero is Working. **Calm card** (`bg-card-calm`, compact, `~0.82` opacity, `text-dim` body): the recessed "far" presentation in a flank column. Anatomy is the same top→bottom in both, just scaled: `sessionName` (`body`) + status dot · `projectPath` (`mono`, path-tail emphasized) · `pendingToolName` (`mono`, only when present — the "what it's blocked on") · muted footer `pid · tasks · cost` (`meta`). The flank/calm card abbreviates path and may drop the footer detail. `latestMessage` is hover/expand, never primary. **Watch-only card** (Konsole): same anatomy, no terminal affordance, a muted `Konsole` tag, click-to-focus cursor.
- **Column header** — `heading` + a muted count (`Needs you · 2`), with a top accent tick in the column's accent (gold / blue / idle-muted). The **hero column's** header is larger (`heading` at full size, with a divider); flank headers are smaller and `text-secondary`. The header is always present even when the column is empty.
- **Attention rail item** (FR-16) — a session row in the focused-session rail. Default 44px, transparent. **Needs-you item:** enlarges to 56px, gains `needs-you-fill` (14%-opacity gold) + a `needs-you` left border, and a **subtle pulse** (see Do's/Don'ts and EXPERIENCE for motion spec). Idle items stay calm (no enlarge, no pulse) — a muted dot only. The active (currently-open) session gets `bg-surface-raised`.
- **Buttons** — `primary` (working-blue fill, used for `+ New session`), `ghost` (bordered, for secondary actions), `danger` (deeper-red fill, for Stop / Quit-anyway only).
- **Tray badge** — count painted on the tray icon; gold `full` chip with **dark** numerals (gold is light — white would fail contrast) = number of sessions in **Needs-you ONLY** (Idle EXCLUDED — Jose 2026-06-19; UX-DR3 one-reserved-hue: the gold chip = the genuine needs-you count, never diluted onto calm idle sessions).
- **Embedded terminal** — `lg`-cornered frame on `bg-terminal`; xterm.js themed from the `embedded-terminal` token block (Catppuccin Mocha ANSI on a neutral-black ground). WebGL renderer; no chrome inside the terminal region except a thin frame.
- **Dialogs** (Quit-guard, Stop-confirm) — centered, `bg-surface-raised`, `lg` corners, `shadow-dialog` over `scrim`; Cancel is the default/focused action.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Keep `needs-you` gold exclusively for genuine Needs-you signals | Use gold for chrome, hover, headings, or decoration |
| Keep the focus-ring **cool** (lavender) so it can't imitate the gold alert | Use a warm focus ring, or let it read as a status |
| Carry urgency with **Column placement** and the **adaptive hero (size/proximity)** | Add `prod`-vs-`develop` color/size weighting (beyond-v1) |
| Keep neutrals **neutral charcoal** (between blue-black and taupe); accents are Catppuccin Mocha | Swing the neutrals back to a blue-black cast, or to a warm taupe |
| Keep the Working-hero edge a **faint, low-opacity** blue tint | Turn it into a bright blue glow — it must read calm, not alert |
| Promote **Needs-you → else Working** into the hero; flank the rest, dimmed | Let Idle take the hero, or leave the hero empty while a column has content |
| Pair every status color with a text label + dot shape | Rely on color alone to convey status |
| Pulse Needs-you rail items subtly (~1.5s opacity/scale); honor `prefers-reduced-motion` → static | Bounce, flash, or animate anything that isn't a Needs-you signal |
| Make `bg-terminal` the deepest **neutral** black so the terminal pulls focus | Lighten the terminal to "match" the chrome |
| Tonal depth for cards/rail; shadow only for floating dialogs/popovers | Cast shadows for hierarchy on flat surfaces |
| `font-mono` for c9watch-verbatim data (path, tool, pid, terminal) | Set `projectPath`/`pendingToolName` in the UI sans |
| Empty columns keep their header + hint | Collapse or hide an empty Column |
