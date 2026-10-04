---
paths:
  - 'src/renderer/**'
---

# Rule: UI shape (one shell, no second layout)

Every config surface (Templates, Shortcuts, Workspaces, Tags, Rules, Past sessions, Settings) is
built on ONE shell: `components/ManageDialog/` (`ManageDialog`, `useManageDialog` from
`ManageDialog.ts`). Read a sibling dialog first. Two dialogs doing one job in two layouts is a
defect. (`UX-DR<n>` ids come from design docs not in this tree; this file is the rule set.)

## Canonical shape

```tsx
const dialog = useManageDialog({ title: 'Templates', testIdPrefix: 'templates', onClose })
const formOpen = dialog.state.creating || selected !== null

<ManageDialog.Provider {...dialog}>
  <ManageDialog.Frame>                       {/* overlay z-60, role=dialog, Escape closes */}
    <ManageDialog.Header><ScopeFilter … /></ManageDialog.Header>
    <ManageDialog.Columns>                   {/* fixed rail | 1fr */}
      <ManageDialog.List>
        <ManageDialog.Rows>
          <ManageDialog.Row id={t.id} testId="template-row">{t.name}</ManageDialog.Row>
        </ManageDialog.Rows>
        <ManageDialog.New testId="template-new" />   {/* in the rail's ListBottom; startNew() */}
      </ManageDialog.List>
      {formOpen ? (
        <ManageDialog.Form onSubmit={submit}>
          …fields…
          <ManageDialog.Footer>               {/* flex-end: [Delete] [Save] */}
            <ManageDialog.Delete testId="template-delete" onConfirm={remove} />
            <ManageDialog.Save testId="template-save" disabled={!canSave} />
          </ManageDialog.Footer>
        </ManageDialog.Form>
      ) : (
        <ManageDialog.Placeholder testId="template-placeholder">
          Select a template on the left, or create a new one.
        </ManageDialog.Placeholder>
      )}
    </ManageDialog.Columns>
    <ManageDialog.Message testId="template-error" />
  </ManageDialog.Frame>
</ManageDialog.Provider>
```

## Two-column rules

- Right column is PLACEHOLDER (nothing open), FORM (a row or New), or PANE (settings-like, no
  Save). **Never an empty form.** `select(null)` → placeholder; `+ New` → `startNew()`. Render the
  form only while `state.creating || selected !== null` (a gone row = nothing open).
- Flows: open → placeholder; `+ New` → New form; save → that row (scope follows); delete/forget →
  placeholder; scope change → placeholder.
- Placeholder = ONE sentence, `--text-secondary`, centred: `Select a <thing> on the left, or create
a new one.` (no `+ New` → `Select a <thing> on the left.`). No button in it.
- Settings-like surface: CATEGORIES are rail rows (Notifications, Appearance, Terminal, Keyboard,
  API), opens on the first (`initialSelectedId`), right column is `ManageDialog.Pane` headed by the
  category. New setting → existing category; new category is a design question.
- No exceptions: a surface that "needs" a table or card is a design question.

## Dialog rules

- **Row actions only inside `ManageDialog.RowActions`** (fixed-width, revealed on hover/focus), and
  never one the form owns (Delete, rename). The row itself selects.
- **Destructive actions in the footer, left of primary**: one `flex-end` row `[Delete] [Save]`.
- **Arm in place:** `Delete` → `Confirm delete`, `variant="danger"` → `armed`. Blur disarms; Escape
  disarms and STOPS (doesn't close the dialog). Never a second Cancel/Confirm pair.
- **Delete is red at rest** (danger border/text, transparent), fills on hover/focus; `armed` (solid)
  only when armed. Looks live in `Button.module.css` only; use `<ManageDialog.Delete>`.
- **Workspace Delete warning names EVERY cascaded store** (templates, shortcuts, tags, rules, past
  sessions — main's `cascade()`). A new cascaded store owes a word there and in its test (UX-09).
  Deleting the ACTIVE workspace re-points the focused view (`focusWorkspace`, UX-18).
- **Panel capped to viewport, FORM scrolls:** `.panel` `max-height: calc(100vh - 2 *
var(--space-6))`, `.columns` `grid-template-rows: minmax(0, 1fr)`, `.form` the one
  `overflow-y: auto` (pinned by `ManageDialog.styles.test.ts`). A too-tall form gets shortened.
  Any scroll region clips every side, so it needs `padding-left/right: var(--space-2)` +
  `scroll-padding-block` or focus rings get cut.
- **One message slot per dialog** (`ManageDialog.Message`, under the columns): an error Callout
  (`role="alert"`) or a 2.5 s success Callout (`showSuccess('Template saved.')`, called AFTER the
  `select` that follows the save). Never render `error.message` — map the code to copy (`copyFor` /
  `templateErrorMessage`). Editing any field clears it (R26). A refused Delete says so.
- **A greyed Save says why** once dirty: muted `ManageDialog.Hint` (not the alert) naming the
  failing field, chosen by Zod issue PATH + draft shape, never the message.
- **A scope change in a form resets what the new scope can't see** (R15, `rescopeDraft`).
- Every interactive control gets `:focus-visible` (Button has it; others join the module's group).
- **A control the operator must not use is NOT rendered** (Default workspace has no Delete). Only
  exception: reorder ↑/↓ in `RowActions` — first ↑ / last ↓ rendered DISABLED with SR label
  `Already first`/`Already last`, so the slot width stays identical.

## Scoped lists (header filter)

Dialogs listing rows from many workspaces carry `components/ScopeFilter/ScopeFilter.tsx` beside the
title.

- Entries in order: unfiltered (`allLabel`: `All templates`, `All shortcuts` — named after the LIST,
  because `Global` is a subset), `Global`, each workspace, `(no workspace)` only if `hasOrphans`.
- Past sessions: `showGlobal={false} showOrphans={false}`.
- Opens on the ACTIVE workspace; unknown active id → unfiltered.
- **Strict filtering both ways** (workspace shows only its rows; Global only global). Editing a
  global row from a workspace view breaks it for everyone. (`+ New session` popover merges global +
  active on purpose.)
- **Flat list in every scope, no section headers.**
- Scope change closes what was open. A save that moves a row re-points the filter to its scope.
- Three empty states, three sentences: nothing at all / nothing in this scope / no search matches.
- `+ New` at rail bottom (`ManageDialog.ListBottom`, `margin-top: auto`).
- Options pass a `WorkspaceLabel` as `display`.

## Workspaces in the UI — a TINT, never a dot

A dot reads as session status (spec `2026-09-29-workspace-tint-design.md`).

- `components/WorkspaceTint/` is the ONE tone → colour map: `workspaceTintClass(tone)` sets
  `--ws-fill`/`--ws-border` from `--workspace-<color>-{fill,border}`; the control reads them in its
  own rule (`var(--ws-fill, <default>)`).
- A workspace listed by name = `components/WorkspaceLabel/WorkspaceLabel.tsx` (`--rounded-sm`; a
  pill is a tag).
- `tone` = `WorkspaceColor | 'global' | 'orphan'`; the last two are untinted and RESET the vars to
  `initial` (custom props inherit).
- Tint is light (fill 14% / border 40%), text `--text-primary`. Separate tokens from `--tag-*`.
- Hover moves the BORDER (`--text-secondary`), never the fill; selected border `--text-primary`.
- The name is always shown (colour is never the only cue).
- **Any operator-typed name truncates and keeps a `title`** (`overflow:hidden` + ellipsis + nowrap,
  `min-width:0` on the flex parent).
- **Text on a raised panel is `--text-secondary`, never `--text-muted`** (2.54:1, fails contrast).

## Tags in the UI

`components/TagChip/TagChip.tsx` is the ONE chip (card footers, rail rows, filter pill, tag lists,
past-sessions rows, Tags colour preview). `TagIndicator` is the compact form, rail default view only.
Tags dialog rail uses `TagPathLabel` instead.

- A tag is a label pill (tinted fill + name), never a dot. Colours only from
  `--tag-<color>-{fill,border,text}` (opaque fills; text ≥ 4.5:1, indicator stroke ≥ 3:1 — pinned
  in tests against `tokens.ts`).
- Chips in TAG-LIST (catalog name) order. One line, `+N` (`TagChipRow`), `+N` `title` lists hidden.
- A tag never changes a rail row's height in the default view; only peek / "Show all tags" add a
  line (`AttentionRail.module.css`).
- Rail peek draws INSIDE the row's card and ends in a `+ tag` pill (dashed, like `+ Add filter`),
  never `Edit`. Real button laid over a hidden copy via CSS anchor positioning (`anchor-scope` per
  `.rowWrap`, `position-visibility: always`).
- Open peek toggle is LIT (`--text-primary` fill, `--text-on-lit`, `TagIndicator mono`), `title`
  `Hide tags`. `Show all tags` toggle lit the same way.
- Tag names truncate sideways only (`overflow-x: clip`, `text-box: trim-both ex alphabetic`) —
  `overflow:hidden` + `line-height:1` cut descenders.
- `TagPicker` trigger: `aria-expanded` + `aria-controls`, never `aria-haspopup` (popup is a
  checkbox `group`).
- **Every tag list popup is `components/TagMenu/TagMenu.tsx`** (filter + `TagPicker`): chip per
  row, `✓` at right when on, no native checkbox. Drawn with `Popover`. Filter = `menu`
  (`menuitemradio`), picker = `group` (`role="checkbox"`).
- Rail row name reserves `--rail-tools-width` while tools show.
- Tags dialog rail: `TagPathLabel` (`acme/` secondary, `prod` primary, indent `depth ×
--space-3`, accessible name = full name). Display only.
- No tag yet: the same button becomes `Create tags` → Tags dialog (`aria-haspopup="dialog"`, no
  `aria-expanded`). Hidden only when no Tags dialog exists.

## Hover (`styles/hover.guard.test.ts`)

- Every clickable control shows a hover, in every theme. A class with `cursor: pointer` has a
  `:hover` rule in its sheet.
- The hover paints the `--bg-hover` layer OVER the control's own fill:
  `background-image: linear-gradient(var(--bg-hover), var(--bg-hover))`. Never a surface token
  (`--bg-base` / `--bg-surface` / `--bg-surface-raised`): where it equals the panel, the hover
  vanishes. A tinted control (workspace) moves its BORDER instead; danger fills red. Exception:
  a rail row previews the active tab (`--bg-base`), allow-listed in the guard.
- Themes may restyle hover (Paper: near-black pill, white ink).

## Spacing roles (`styles/spacing.guard.test.ts`)

Spec `2026-10-01-spacing-roles-design.md`. Target: compact but airy — rows small, groups and
sections clearly apart. Every `gap`/`padding`/`margin` in a component stylesheet is a ROLE token
(`shared/theme/tokens.ts`, built on the `--space-N` scale), never `--space-N` or a raw length.

| Role                                   | Value     | Use                                             |
| -------------------------------------- | --------- | ----------------------------------------------- |
| `--gap-stack`                          | 2px       | title over subtitle in one row                  |
| `--gap-row`                            | 4px       | rows of one list / menu                         |
| `--gap-row-filled`                     | 8px       | rows that are filled boxes (tinted)             |
| `--gap-inline-tight`                   | 4px       | icon + text, small tool clusters                |
| `--gap-inline`                         | 8px       | controls side by side, button rows              |
| `--gap-group`                          | 12px      | groups in a menu, rail, pane; cards in a column |
| `--gap-field`                          | 6px       | label → its control                             |
| `--gap-section`                        | 20px      | field block → next; section → section           |
| `--gap-actions`                        | 24px      | last field → the dialog's buttons               |
| `--gap-page`                           | 16px      | page edge, header ↔ filter bar ↔ board, columns |
| `--inset-item-y/-x`                    | 8/12px    | inside a row, field, menu item                  |
| `--inset-compact-y/-x`                 | 4/8px     | inside a compact control; focus-ring buffers    |
| `--inset-pill` / `-tight`              | 8/4px     | pill side padding / counts and badges           |
| `--inset-popover` / `-card` / `-panel` | 8/12/24px | menu box / card, column / dialog                |

- A divider keeps 8px each side; a group with NO divider before a Popover list (search → list)
  gets `--gap-group` (Popover owns it — no per-menu slot).
- Dialog form: `.form` gap `--gap-field`, `.label` margin-top `--gap-section − --gap-field`.
- **Manage footer is sticky** (`[Delete] [Save]` stays in view while a long form scrolls under
  it; themes style `[data-manage-footer]` — Liquid Glass frosts it).
- The guard's allow-list holds optical nudges and geometry (`+1px` border compensation, the 28px
  peek toggle, 14px icon, 8px dot), each with a reason. A new one needs a reason, not a habit.
- `--gutter` / `--card-gap` are aliases kept for themes; components use the roles.

## Regions and breathing (`ManageDialog.styles.test.ts`)

Spec `2026-10-02-region-spacing-design.md`. The roles say WHICH value a relation gets; this says
which relation two neighbours ARE. Items of one kind close, different regions clearly apart.

1. **A screen is a stack of regions.** Header (title row, optional description) · body (rail |
   pane) · message slot. Rail: top tool (search) · list · bottom slot (`+ New` or an action row,
   plus an optional footnote). Form: blocks (label + control + hint) · footer.
2. **Two different regions never sit closer than `--gap-group` (12px)**; rows of one list keep
   `--gap-row` / `--gap-row-filled`. Check: the space AROUND a group is at least twice the largest
   space INSIDE it (rows 4 → regions 12; field block 6 → blocks 20).
3. **One role per boundary:**

| From → to                            | Role                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| title → its description              | `--gap-field` (6)                                    |
| header → body                        | `--gap-section` (20)                                 |
| rail top tool → list                 | `--gap-group` (12)                                   |
| list → bottom slot                   | `--gap-group` (12), slot pinned `margin-top: auto`   |
| bottom slot's action → its footnote  | `--gap-field` (6)                                    |
| label → control, control → its hint  | `--gap-field` (6)                                    |
| hint / state note → the next control | `--gap-inline` (8)                                   |
| block → block                        | `--gap-section` (20)                                 |
| last block → footer buttons          | `--gap-actions` (24) as the footer's own padding-top |

4. **Same kind, same size.** Settings rows share one `min-height` (a 36px field Select/TextInput
   - insets), so a checkbox row matches a dropdown row. Every rail search is
     `<TextInput variant="inline">`.
5. **A scroll region never ends flush on a fixed region.** The rail list stops `--gap-group` above
   the bottom slot. The sticky footer's space is its PADDING (stays while the form scrolls under
   it), and the form's `--gap-field` stays above the footer box: the box paints over what is under
   it, so flush would cover the last field's focus ring. `scroll-padding-block` clears the whole
   footer box, so Tab never parks a field under it.
6. **A new screen picks slots, not gaps.** Rail foot content goes in `ManageDialog.ListBottom`
   (items `--gap-field` apart), a footnote in `ManageDialog.ListNote`. A DIFFERENT region under
   the list (a footnote, a bulk bar) goes in `ManageDialog.ListBottomDivided`: a divider with
   `--gap-section` each side (rule 7); `+ New` alone keeps the plain slot. No slot fits → add one
   to the shell with its role from the table, never a local gap in the component sheet. Themes
   may restyle a region, never re-space it.
7. **Space groups; an edge separates.** The eye reads one surface as one block, whatever the
   distance. Space alone is enough only between items of the SAME kind (rows of a list, fields of
   a form). Two DIFFERENT kinds of region on the same surface also need a visible edge: their own
   fill, or a divider line between them. Measure space as the eye sees it (ink to ink, padding
   included), not box to box: a row's own padding is space too.
8. **A scroll region shows where it ends.** A frame, a fill or a divider marks its edge, so a row
   cut by the scroll reads as "more below", not as broken layout, and what sits outside it is
   clearly outside. Every `ManageDialog.Rows` fades its bottom 32px while more rows are below
   (`useOverflowEnd`); none at rest. `scroll-padding-bottom: 32px` parks a row reached by keyboard
   above the fade.

## Board filter bar (`components/FilterBar/FilterBar.tsx`)

The ONE place the board is filtered/searched; above the columns, never in the header.

- CONTROLS row always drawn, no box: search, `Filter` button, count (`5 sessions` /
  `3 shown · 2 hidden`). CHIP row (boxed; `Tag is <chip>` with `×`, or `+ Add filter`) only while
  `Filter` is pressed. Not persisted.
- **Search matches card NAME only**, case-insensitive substring, trimmed. `<TextInput
variant="inline">` + magnifier `icon`. Escape with text clears and stops; empty passes through.
  `boardStore.searchQuery`, not persisted, survives workspace switch.
- Tag + search narrow board, column counts and rail status groups through ONE `BoardFilter`
  (`useBoardFilter`). Pinned rail row, notifier, badge, sound ignore both.
- `Filter` = `<Button variant="secondary" lit>`, word + 16px filter-list icon, 32px (same as search
  box — pinned by test), titled `Show filters`/`Hide filters`. No chevron. LIT while chip row open
  AND while closed with a filter on (then also shows count: `Filter, 1 on`). Search never counted.
- Spacing: `--gap-group` (12px) under header, `--gap-page` (16px) above columns (`FilterBar` `.bar`,
  `Board.module.css` `.filterSlot`). Never a negative margin on the grid (covers the bar's clicks).
- Empty sentences name what hides cards (`lib/filterCopy.ts`): `No sessions tagged prod match “dep”
here.` aria-live too.
- Tag is the only filter type: `+ Add filter` opens the tag list directly. One tag at a time
  (`+ Add filter` not rendered while on).
- Drawn only when the workspace has sessions (stays when filter hides all). No tag: list offers
  `Create tags…`; no tag AND no Tags dialog → no `Filter` button.
- `Sort` / `⋯` not built (IdeasBoard) — not rendered.

## Header ☰ menu (`components/AppMenu/AppMenu.tsx`)

Only header control besides `+ New session`; filters nothing.

- Rows: `Settings…` (⚙), `Shortcuts…` (⌨), `Tags` submenu (`Manage tags…` / `Manage rules…`),
  `Past sessions…` (clock) ALWAYS LAST. New rows go before it. Icons in a fixed-width slot; `‹` at
  right.
- Submenu opens LEFT, level with its row; hover opens/closes; ArrowRight/Left; click OPENS, never
  toggles.
- Escape peels one layer (submenu, then menu), listens on the whole menu; closed → passes through.
- Every row opens a dialog under the single-modal rule (`settingsDialogOpen` in `boardStore` joins
  `isModalOpen()`).

## Past sessions and exits

- Nothing selected → placeholder "Select a session on the left." Load failure → error line `Could
not load past sessions`, suppresses the empty sentence.
- **Every exit is Archive or Delete.** Card + focused bar carry Archive (no confirm, reversible) and
  red-at-rest Delete. Delete opens `StopConfirm`: "Delete session? The session is stopped and
  nothing is kept in Past sessions. Claude's own files are not touched." — Cancel default-focused.
- **No key archives** (R27); Archive button label names no chord.
- `Esc to return` only while focus is outside the terminal.
- Rail foot: "Keeps the 200 most recent sessions" (UX-15) — a `ListNote` under the Resume-by-id row
  in `ListBottomDivided` (behind a divider: a different region from the list).
- `transcript_missing`: "Claude no longer has this conversation. Forget it to remove it from the
  list". `session_running_elsewhere`: "This session is running in another terminal. Close it there
  first" (dead pane: "This conversation is running…").
- Pending rename: `⟳` after the name (`NameSyncMark`), `--text-secondary`, title "Claude applies
  this name on your next prompt".
- Dead pane (UX-10) says why by code/signal only (`terminal/exitReason.ts`): `Claude exited with
code 1.` / `Claude was stopped by SIGKILL (signal 9).` Actions: `[Resume conversation]`
  (secondary), `[+ New session]` (primary). Resume REPLACES the pane (`resumeDeadTerminal`);
  refusal → mapped copy on the pane's line. Plain-shell `#terminals` has no Resume.

## Feedback — every action says what happened

Spec `2026-09-29-action-feedback-design.md`. Visible result for every action; nothing runs twice.

**Placement:**

1. Inside a dialog → its message slot (error or success) / Settings' compact `Saved`. **A dialog
   never toasts its own result** (Delete confirm and Quit guard have no slot → they toast refusals).
2. Small action on a control that stays (Copy, Reload themes, Regenerate) → Button `feedback` for
   1.5 s.
3. Board-level or off-screen result → toast.

Copy mapped from a CODE (`includes` — Electron wraps rejections), never `error.message`.

- **Callout (`components/Callout`, spec `2026-10-01-feedback-callout-design.md`) is the ONE in-page
  message.** Tinted box (`--success-fill`/`--danger-fill`), 1px tinted border, 3px `--success`/
  `--danger` left bar, icon disc drawn in CSS (text = the words), `--text-primary` title, optional
  `detail` (`--text-secondary`) and `action`. `size="block"` (dialog slot, small forms, banners) or
  `"compact"` (one line: Settings heading, expander). Success `role="status"`, danger
  `role="alert"`; `announce={false}` inside something already live (dead pane, Settings' slot).
- Success shows `SUCCESS_MS` (2.5 s); an error stays until the next action. Success copy names the
  THING (`Rule deleted.`, `Session forgotten.`), never a typed value. Green = `--success`; themes
  override it (Paper: dark green — `#a6e3a1` on white fails 3:1).
- Toast glyph: success ✓ `--success`, error `!` `--danger`, info neutral.

- **Toasts:** `stores/toastStore.ts` (`toast.success/error/info`) + `<Toaster />` mounted ONCE in
  `App.tsx`, outside the `inert` subtree. Max 3 (4th drops oldest); success/info 5 s (6 s with
  action); error stays; hover/focus pauses. Bottom-right, `--space-4`, `z-index: 70`. Anatomy:
  glyph, title, optional `detail`, optional action (`Button secondary sm`), ✕ (`Button ghost xs
icon`, `aria-label="Dismiss"`). Success/info `role="status"`, error `role="alert"`, in `<section
aria-label="Notifications">`. Themes: `[data-toast]`, `[data-toast-kind]`.
- Toast action not rendered while a modal is open (`modalOpenIn`).
- Toast closes when `run` is called; store contains throws silently, so a failing `run` pushes its
  own error toast.
- Workspace in a toast = `workspace: { name, tone }` (`WorkspaceLabel`), never in the title.
- **Button `feedback` / `feedbackShown` / `busy`:** label and result share one grid cell (width
  never changes); hidden `role="status"` sibling carries the result — tests read it, never
  `textContent`. Pattern: `const [copied, flashCopied] = useFlash<true>()` → `feedback="✓ Copied"
feedbackShown={copied !== null}`. `busy` = disabled + `aria-busy`; busy `Delete` keeps armed look.
- **Every async button uses `useAsyncAction(fn)` → `{ run, busy }` or a `busy` flag.**
- **Every `void window.<a>.<b>(…)` ends in `.catch(`** (`lib/bridgeCatch.test.ts`). A wrapper that
  can fail rethrows a code or reports itself.
- Settings: compact success Callout `Saved` beside pane heading, 2.5 s; refused change rolls back
  (`persistSettingsPatch` → `settings_persist_failed`), error line `Could not save <setting>.`
- **Name prompt stays open while main answers** (`lib/namePromptFlow.ts`): busy `Starting…` /
  `Renaming…`; refusal keeps the name + mapped copy (`folder_missing`, `claude_version`,
  `template_not_found`). No answer in 15 s → close + `Still starting "<name>"…` toast. Late result
  never takes the view (success → registry only + toast with `Open`; failure → error toast).
- **Archive/Delete wait for main:** view goes to board at once, registry only after main answers.
  Archive toasts `Archived "<name>"` with `Resume` (only once the record exists and with a bound id).
- Startup load failure = ONE toast naming every store (`Could not load templates, tags and rules.
Reopen the app to try again.`); each dialog says `Could not load <x>.`

## Banned primitives (each has a guard test)

- **Bare error/success line → `components/Callout/Callout.tsx`.** `Callout.guard.test.ts` fails on
  `role="alert"` outside Callout/Toaster (and the dead PANE) and on text coloured `--danger` in a
  component stylesheet (only Callout, Toaster, Button, the rules `.broken` badge).

- **Native `<select>` → `components/Select/Select.tsx`.** On Linux Chromium paints the popup from
  the GTK theme (light on dark app); CSS, `color-scheme` and `nativeTheme` all failed to fix it.
  Select owes: `role="listbox"`/`option` + `aria-selected`, trigger `aria-haspopup`/`aria-expanded`
  - `ariaLabel` (visible label is a `<span>`); ArrowDown/Up open on the CURRENT row, wrap,
    Home/End; Escape closes, refocuses trigger, **stops propagation**; mousedown outside closes.
    Trigger has `data-value`; rows `data-testid="<testId>-option-<value>"`. Test via
    `test/selectHarness.ts` (`chooseOption`/`selectedValue`/`optionValues`). Options take
    `adornment` or `display`. Sentinel values are WORDS (`'global'`), never `''`.
- **Bare `<input type="text">` → `components/TextInput/TextInput.tsx`.** Field only (label/helper/
  error at call site). Needs `id` (with `<label htmlFor>`) or `ariaLabel`. `onChange` gets the
  string. `inputRef` for focus-on-open only. `invalid` sets `aria-invalid` (never the only signal).
  Placeholder `--text-secondary`. Same box as Select's `field` — change one, change both.
  `TextInput.test.tsx` fails on any other `.input`/`.search`/`.textField` class. Checkboxes/radios/
  ranges stay bare.
- **`<button className=…>` → `components/Button/Button.tsx`.** Variants: `primary` (ONE main
  action: RAISED `--bg-surface-raised` fill + strong border + 600 weight, never an accent colour —
  a blue primary was rejected 2026-09-23), `secondary` (outlined), `danger`, `ghost` (borderless icons). Sizes
  (fixed heights): `md` 32px, `sm` 26px, `xs` 20px; `icon` = square. `lit` = toggle ON
  (`data-lit` present only when on — test `hasAttribute`). **No `className`** — layout goes on a
  wrapper. Refs via `buttonRef`. `Button.test.tsx` fails on any other button class.
  Workspace switcher is NOT a Button (compound pill, matches `md` height); its menu lists only the
  OTHER workspaces (none → just `Manage workspaces…`). Dashed pills and menu rows are Popover rows.
- **Hand-made menu/list popup → `components/Popover`** (spec
  `2026-10-01-popover-standard-design.md`). Parts: `Surface` (box, never scrolls), `List` (only
  scrolling part, `--popover-max-height` on the caller's wrapper), `Item`, `CompactItem`,
  `QuietItem`, `ItemIcon`, `ItemEnd`, `Divider`, `Note`. Draws only — roles, keys, open/close,
  position stay with the caller; no `className`. Row states read from ARIA (`aria-selected`,
  `aria-checked`, `aria-expanded`) + `active` (`data-active`). `tone` → WorkspaceTint +
  `data-tone`. Themes target `[data-popover]`, `[data-popover-list]`, `[data-popover-item]`
  (+ `[data-density='compact']`, `[data-quiet]`, `[data-tone]`), `[data-popover-divider]`.
  `Popover.guard.test.ts` fails on a raw `role="menu"`/`listbox`/`option` or a `--shadow-pop` box
  elsewhere.

## Testing CSS

`vitest.config.ts` sets no `css` option, so a `*.module.css` import returns a string for EVERY key —
`expect(styles[x]).toBeTruthy()` is vacuous. Read the stylesheet with `readFileSync` and assert on
its text.

## Don't

- Don't use `alert()`, `confirm()` or any browser-drawn popup widget.
- Don't hard-code a colour a token names (`--danger`, `--working`, `--text-*`,
  `--workspace-<color>-*`). Never copy WorkspaceTint colours into another module.
- Don't assert a workspace name via container `textContent` — the scope dropdown contains every
  name. Query a `data-testid` or assert structure.
- Don't build a new dialog shell. `ManageDialog.Frame` is z-60, single-modal (add the open flag to
  `isDialogOpen()` in App.tsx), Escape-closable. Delete confirm and Quit guard are modals too (R9):
  nothing opens over them, the page behind is `inert`, Quit guard closes an open Delete confirm.
