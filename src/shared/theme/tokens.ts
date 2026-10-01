// Story 1.3 — the design-token source of truth (AC-1).
//
// These values are a 1:1 TRANSCRIPTION of the DESIGN.md frontmatter token set
// (`_bmad-output/planning-artifacts/ux-designs/ux-c9watch-webapp-2026-06-18/DESIGN.md`, an
// internal planning doc — not shipped, and not part of the theme-authoring contract below).
// The companion sheet is src/renderer/src/styles/tokens.css; tokens.test.ts beside it
// asserts the sheet matches this map.
//
// NOTE on the 3-state model (FROZEN DECISION in the story): the `done` color token
// is LEFT DEFINED here so the sheet stays 1:1 with the frontmatter, but NO component
// consumes it for a live state (StatusDot/ColumnHeader use working/needs-you/idle
// only — see `src/main/c9watch/columns.ts` `Column`, an internal main-process detail, not
// a theme-authoring one). Generating the harmless token keeps the 1:1 guarantee intact; the
// components follow the contract §4 3-state model.
//
// Custom themes (spec 2026-09-20): this map is now ALSO the canonical token source —
// `TOKEN_NAMES` (`src/shared/schemas/theme.ts`) is exactly `Object.keys(TOKENS)`, so main
// validates every theme package's `tokens` against these key names, and `docs/themes/THEMES.md`'s
// token table (`npm run gen:theme-docs`) is generated from this map + `tokenDocs.ts`. A theme
// author reaches this contract through the generated docs, never this file or the two internal
// breadcrumbs above.
//
// [Source: DESIGN.md frontmatter (colors/typography/rounded/spacing/elevation);
//  .claude/rules — CSS Modules + CSS custom properties, no component library]

/**
 * Every design token as `--name → value`, exactly as it must appear in `:root` of
 * `tokens.css`. The key is the CSS custom-property name WITHOUT the leading `--`.
 * Order here mirrors `tokens.css` for an easy side-by-side read; tests are
 * order-independent (they compare by key).
 */
export const TOKENS = {
  // ── Surfaces (neutral charcoal; depth by tone) ─────────────────────────────
  'bg-base': '#1a1a18',
  'bg-surface': '#232220',
  'bg-surface-raised': '#2c2b27',
  'bg-col-hero': '#201f1c',
  'bg-col-calm': '#151513',
  'bg-card-hero': '#2a2925',
  'bg-card-calm': '#1e1e1b',
  /* The DEFAULT rail row fill — every row you are NOT viewing (text keeps 7.82:1 on it). A
   * lift along the app's warm-neutral ramp, not a hue. There is deliberately no
   * `bg-row-active` counterpart: the active row paints `bg-terminal`, the same token the
   * terminal frame paints, so the two cannot drift. Rail only; board cards have no
   * selected fill. */
  'bg-row-rest': '#3a3833',
  'bg-terminal': '#141312',
  scrim: 'rgba(10,10,8,0.62)',

  // ── Lines ──────────────────────────────────────────────────────────────────
  border: '#34332e',
  'border-strong': '#423f39',
  'border-card': '#403e37',

  // ── Text (neutral-charcoal ramp) ───────────────────────────────────────────
  'text-primary': '#d6d3ca',
  'text-secondary': '#a4a094',
  'text-muted': '#6b685e',
  'text-dim': '#47453d',

  /* Ink ON a filled button. `text-on-accent` sits on `--working` (the primary Save/Create
   * button): the app's darkest neutral, not `--bg-base`, so it stays readable when a theme
   * lightens the ground. `text-on-danger` sits on `--danger` (armed Delete, Quit anyway). */
  'text-on-accent': '#11111b',
  'text-on-danger': '#ffffff',
  /* Ink ON a lit fill: a LIT toggle (`--text-primary` fill — the filter button, the rail's open
   * tag toggles) and the needs-you count pill. It was `--bg-base`, which a glass theme makes
   * `transparent` — and the ink vanished with it. Same value as `bg-base` here. */
  'text-on-lit': '#1a1a18',

  // ── Status / accent (Catppuccin Mocha + one custom gold) ───────────────────
  working: '#89b4fa',
  'needs-you': '#ffcf29',
  done: '#a6e3a1', // DEFINED for 1:1; UNUSED by any component (3-state model)
  idle: '#807d72',
  danger: '#db4b4b',
  /* Feedback callout (spec 2026-10-01): green success beside danger. The fills/borders mix the
   * tone over the THEME's raised surface (the workspace-tint pattern), so a theme that sets none
   * still gets a tint of its own surface. `text-on-success` is the ✓ on the green disc. */
  success: '#a6e3a1',
  'text-on-success': '#11111b',
  'success-fill': 'color-mix(in srgb, #a6e3a1 10%, var(--bg-surface-raised))',
  'success-border': 'color-mix(in srgb, #a6e3a1 35%, var(--bg-surface-raised))',
  'danger-fill': 'color-mix(in srgb, #db4b4b 10%, var(--bg-surface-raised))',
  'danger-border': 'color-mix(in srgb, #db4b4b 40%, var(--bg-surface-raised))',
  'focus-ring': '#b4befe',

  // ── Tags (spec 2026-09-11 T-7) — opaque fills; see tokens.css for why ──────
  'tag-slate-fill': '#373739',
  'tag-slate-border': '#5b5e65',
  'tag-slate-text': '#c4c9d4',
  'tag-blue-fill': '#333943',
  'tag-blue-border': '#516482',
  'tag-blue-text': '#a9c7fb',
  'tag-green-fill': '#384135',
  'tag-green-border': '#5e795a',
  'tag-green-text': '#b7e4b2',
  'tag-amber-fill': '#443629',
  'tag-amber-border': '#7f5b3a',
  'tag-amber-text': '#f0b98a',
  'tag-violet-fill': '#3e3742',
  'tag-violet-border': '#6f5d81',
  'tag-violet-text': '#d7bff9',
  'tag-rose-fill': '#443336',
  'tag-rose-border': '#81515d',
  'tag-rose-text': '#f5a9be',
  'tag-red-fill': '#44322e',
  'tag-red-border': '#804f48',
  'tag-red-text': '#f5a59a',
  'tag-lime-fill': '#3c402f',
  'tag-lime-border': '#6b7749',
  'tag-lime-text': '#d1e79d',
  'tag-teal-fill': '#35413d',
  'tag-teal-border': '#567871',
  'tag-teal-text': '#afe9e0',
  'tag-cyan-fill': '#334040',
  'tag-cyan-border': '#51767b',
  'tag-cyan-text': '#a6e5f0',
  'tag-indigo-fill': '#373742',
  'tag-indigo-border': '#5a5c81',
  'tag-indigo-text': '#b6baf9',
  'tag-pink-fill': '#453c40',
  'tag-pink-border': '#826a7a',
  'tag-pink-text': '#f8d1ed',

  // ── Workspace tint (spec 2026-09-29) — a workspace is a LIGHT tint of the control that names it,
  //    never a dot (a small coloured circle reads as status). The hue mixed over the THEME's
  //    bg-surface-raised: fill 14%, border 40% — so a theme that sets none of these still gets a tint
  //    of its own surface (a light theme gets light boxes). Separate from the tag tokens on purpose. ─────────
  'workspace-slate-fill': 'color-mix(in srgb, #7f849c 14%, var(--bg-surface-raised))',
  'workspace-slate-border': 'color-mix(in srgb, #7f849c 40%, var(--bg-surface-raised))',
  'workspace-blue-fill': 'color-mix(in srgb, #89b4fa 14%, var(--bg-surface-raised))',
  'workspace-blue-border': 'color-mix(in srgb, #89b4fa 40%, var(--bg-surface-raised))',
  'workspace-green-fill': 'color-mix(in srgb, #a6e3a1 14%, var(--bg-surface-raised))',
  'workspace-green-border': 'color-mix(in srgb, #a6e3a1 40%, var(--bg-surface-raised))',
  'workspace-amber-fill': 'color-mix(in srgb, #f9e2af 14%, var(--bg-surface-raised))',
  'workspace-amber-border': 'color-mix(in srgb, #f9e2af 40%, var(--bg-surface-raised))',
  'workspace-violet-fill': 'color-mix(in srgb, #cba6f7 14%, var(--bg-surface-raised))',
  'workspace-violet-border': 'color-mix(in srgb, #cba6f7 40%, var(--bg-surface-raised))',
  'workspace-rose-fill': 'color-mix(in srgb, #f38ba8 14%, var(--bg-surface-raised))',
  'workspace-rose-border': 'color-mix(in srgb, #f38ba8 40%, var(--bg-surface-raised))',
  'workspace-red-fill': 'color-mix(in srgb, #f28779 14%, var(--bg-surface-raised))',
  'workspace-red-border': 'color-mix(in srgb, #f28779 40%, var(--bg-surface-raised))',
  'workspace-lime-fill': 'color-mix(in srgb, #c2df7c 14%, var(--bg-surface-raised))',
  'workspace-lime-border': 'color-mix(in srgb, #c2df7c 40%, var(--bg-surface-raised))',
  'workspace-teal-fill': 'color-mix(in srgb, #94e2d5 14%, var(--bg-surface-raised))',
  'workspace-teal-border': 'color-mix(in srgb, #94e2d5 40%, var(--bg-surface-raised))',
  'workspace-cyan-fill': 'color-mix(in srgb, #89dceb 14%, var(--bg-surface-raised))',
  'workspace-cyan-border': 'color-mix(in srgb, #89dceb 40%, var(--bg-surface-raised))',
  'workspace-indigo-fill': 'color-mix(in srgb, #9ea3f7 14%, var(--bg-surface-raised))',
  'workspace-indigo-border': 'color-mix(in srgb, #9ea3f7 40%, var(--bg-surface-raised))',
  'workspace-pink-fill': 'color-mix(in srgb, #f5c2e7 14%, var(--bg-surface-raised))',
  'workspace-pink-border': 'color-mix(in srgb, #f5c2e7 40%, var(--bg-surface-raised))',

  // ── Typography: families ───────────────────────────────────────────────────
  'font-ui': "system-ui, 'Noto Sans', 'Segoe UI', sans-serif",
  'font-mono': "'JetBrains Mono', ui-monospace, 'Hack', 'Noto Sans Mono', monospace",

  // ── Typography: ramp (size + weight + line-height per step) ─────────────────
  'font-size-display': '20px',
  'font-weight-display': '600',
  'line-height-display': '1.3',
  'font-size-heading': '14px',
  'font-weight-heading': '600',
  'line-height-heading': '1.3',
  'letter-spacing-heading': '0.01em',
  'font-size-body': '13px',
  'font-weight-body': '500',
  'line-height-body': '1.4',
  'font-size-label': '12px',
  'font-weight-label': '500',
  'line-height-label': '1.3',
  'font-size-meta': '11.5px',
  'font-weight-meta': '400',
  'line-height-meta': '1.3',
  'font-size-mono': '12.5px',
  'font-weight-mono': '400',
  'line-height-mono': '1.45',

  // ── Rounded ────────────────────────────────────────────────────────────────
  'rounded-sm': '4px',
  'rounded-md': '6px',
  'rounded-lg': '8px',
  'rounded-full': '9999px',

  // ── Spacing (4-based) + layout primitives ──────────────────────────────────
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '20px',
  'space-6': '24px',
  'space-8': '32px',
  /* Shared by the rail's "Sessions" header AND the focused view's Board bar. They sit side by side
   * and each draws a 1px bottom border, so a difference reads as a STEP in that line at the rail's
   * edge. 45px is the Board bar's measured content height; the rail header grows to meet it. */
  'topbar-height': '45px',
  'rail-width': '240px',
  /* 70px, not 56px: the rail's 1px right border would otherwise leave a 55px content box and
   * clip the 56px needs-you square's own edge. The ICON stays 56px; this is the gutter. */
  'rail-width-collapsed': '70px',
  'card-min-height': '92px',
  gutter: '16px',
  'card-gap': '12px',

  // ── Elevation (shadow only for genuinely floating layers) ──────────────────
  'shadow-dialog': '0 12px 32px rgba(13,14,20,0.55)',
  'shadow-pop': '0 6px 18px rgba(13,14,20,0.45)'
} as const

export type TokenName = keyof typeof TOKENS
