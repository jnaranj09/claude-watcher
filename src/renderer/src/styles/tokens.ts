// Story 1.3 — the design-token source of truth (AC-1).
//
// These values are a 1:1 TRANSCRIPTION of the DESIGN.md frontmatter token set
// (`_bmad-output/planning-artifacts/ux-designs/ux-c9watch-webapp-2026-06-18/DESIGN.md`).
// The companion `tokens.css` `:root` sheet is generated from THESE values (same
// names, same hex/values), and `tokens.test.ts` asserts the CSS sheet matches this
// map character-for-character — so a typo on either side fails the harness LOUDLY
// (the "one source of truth / no drift" guarantee, UX-DR1).
//
// NOTE on the 3-state model (FROZEN DECISION in the story): the `done` color token
// is LEFT DEFINED here so the sheet stays 1:1 with the frontmatter, but NO component
// consumes it for a live state (StatusDot/ColumnHeader use working/needs-you/idle
// only — see `src/main/c9watch/columns.ts` `Column`). Generating the harmless token
// keeps the 1:1 guarantee intact; the components follow the contract §4 3-state model.
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

  // ── Status / accent (Catppuccin Mocha + one custom gold) ───────────────────
  working: '#89b4fa',
  'needs-you': '#ffcf29',
  done: '#a6e3a1', // DEFINED for 1:1; UNUSED by any component (3-state model)
  idle: '#807d72',
  danger: '#db4b4b',
  'focus-ring': '#b4befe',

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
  'rail-width': '240px',
  'rail-width-collapsed': '56px',
  'card-min-height': '92px',
  gutter: '16px',
  'card-gap': '12px',

  // ── Elevation (shadow only for genuinely floating layers) ──────────────────
  'shadow-dialog': '0 12px 32px rgba(13,14,20,0.55)',
  'shadow-pop': '0 6px 18px rgba(13,14,20,0.45)'
} as const

export type TokenName = keyof typeof TOKENS
