---
paths:
  - 'src/renderer/**'
---

# Rule: UI shape (one shell, no second layout)

Every config surface (Templates, Shortcuts, Workspaces, Tags, Rules, Past sessions, Settings) is
built on ONE shell: `components/ManageDialog/` (`ManageDialog`, `useManageDialog` from
`ManageDialog.ts`). Read a sibling dialog first. Two dialogs doing one job in two layouts is a
defect. (`UX-DR<n>` ids come from design docs not in this tree; this file is the rule set.)

**Reuse before you draw.** Before giving anything a look (selected, current, hover, focus, armed,
disabled, empty, a divider, a marker), find where the app ALREADY draws that meaning and reuse
that part or class. The meaning is what counts, not the component: a "current page" is a
"selected row", so it gets the selected-row look. A NEW look for a meaning the app already draws
is never an `[AGENT]` pick in a spec: stop and ask the owner. ("The standard was already on the
settings page. No need to reinvent the wheel visually." — 2026-10-03)

**Reuse the word, too.** Before naming anything the operator sees, search how the app already
names that thing and reuse the word (technical-taste §4 "Same thing, same word"). A word used in
more than one place comes from `copy/terms.ts`; a spec lists every new word in its `## Copy` table.

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
  </ManageDialog.Frame>
</ManageDialog.Provider>
```

A dialog with sibling pages owns this state and renders each page's Header/Columns — see
"Page column".

## Two-column rules

- Right column is PLACEHOLDER (nothing open), FORM (a row or New), or PANE (settings-like, no
  Save). **Never an empty form.** `select(null)` → placeholder; `+ New` → `startNew()`. Render the
  form only while `state.creating || selected !== null` (a gone row = nothing open).
- Flows: open → placeholder; `+ New` → New form; save → that row (scope follows); delete/forget →
  placeholder; scope change → placeholder.
- Placeholder = ONE sentence, `--text-secondary`, centred: `Select a <thing> on the left, or create
a new one.` (no `+ New` → `Select a <thing> on the left.`). No button in it.
- Settings-like surface: CATEGORIES are rail rows (Notifications, Appearance, Terminal, Memory,
  Keyboard, API), opens on the first (`initialSelectedId`), right column is `ManageDialog.Pane` with
  no title (the rail row names the page). New setting → existing category; new category is a design question.
- **One selected look.** Every list where ONE entry is the current one — rail rows, Settings
  categories, the page column — draws it the same way: the row markup (`.row` + `.rowSelect`) and
  `.row[data-selected='true']` (`--bg-surface` fill, `--border-strong` edge). Never a second
  "selected" style (a bar, a tint, bold text) for another list. Hover is the shared `.row` hover
  (the whole row, pin and checkbox included).
- **Page column** (spec 2026-10-03 C): a dialog with SIBLING pages (Sessions: Active · Past ·
  Templates · Import; Tags: Tags · Rules; Memory: Specifics · Facts · Episodes · Commands) puts them in `ManageDialog.Pages` at the far left —
  `pages | rail | form`, or `pages | form` with no list. Text rows, a `nav` with
  `aria-current="page"`; its rows ARE rail rows, so the current page has the one selected look
  (above), the same as a Settings category. Never tabs, never a second dialog. The dialog owns the
  scope and Active's and Past's filters (both survive a page switch) and the shell state; each
  page renders `Header` + `Columns` (page column first) and takes `DialogPageProps`. A page
  switch closes what was open.
- No exceptions: a surface that "needs" a table or card is a design question.

## Dialog rules

- **Row actions only inside `ManageDialog.RowActions`** (fixed-width, revealed on hover/focus), and
  never one the form owns (Delete, rename). The row itself selects. One exception: the favorite
  pin, `ManageDialog.RowFavorite` (before the select button, always visible — its state is
  information). Memory's pin is this same pin on the row, never in the form (owner's pick).
- **Destructive actions in the footer, left of primary**: one `flex-end` row `[Delete] [Save]`.
- **Arm in place:** `Delete` → `Confirm delete`, `variant="danger"` → `armed`. Blur disarms; Escape
  disarms and STOPS (doesn't close the dialog). Never a second Cancel/Confirm pair.
- **Delete is red at rest** (danger border/text, transparent), fills on hover/focus; `armed` (solid)
  only when armed. Looks live in `Button.module.css` only; use `<ManageDialog.Delete>`.
- **Workspace Delete warning names EVERY cascaded store** (templates, shortcuts, tags, rules, goals, past
  sessions, memory — main's `cascade()`, `persistence/workspaceCascade.ts`). A new cascaded store owes a word there and in its test
  (UX-09). Deleting the ACTIVE workspace re-points the focused view (`focusWorkspace`, UX-18).
- **Panel capped to viewport, FORM scrolls:** `.panel` `max-height: calc(100vh - 2 *
var(--space-6))`, `.columns` `grid-template-rows: minmax(0, 1fr)` and its own `max-height:
  560px` (a long list or pane scrolls, it never makes the dialog taller; the Goals sheet lifts
  it), the form's or pane's body (`.scrollBody`) the one `overflow-y: auto` (pinned by
  `ManageDialog.styles.test.ts`), with `[Delete] [Save]` under it. A too-tall form gets shortened.
  Any scroll region clips every side, so it needs `padding-left/right: var(--space-2)` +
  `scroll-padding-block` or focus rings get cut. Every line in it keeps its height
  (`.scrollBody > * { flex-shrink: 0 }`): a read-only value (`overflow: hidden`) otherwise
  collapsed to nothing before the body began to scroll.
- **A dialog's result is ONE toast** (spec 2026-10-26 dialog toasts), keyed `dialog:<testIdPrefix>`
  so a new result replaces the last: `setError(copy)` pushes the error toast,
  `showSuccess('Template saved.')` the success toast (called AFTER the `select` that follows the
  save). Never render `error.message` — map the code to copy (`copyFor` / `templateErrorMessage`).
  Editing any field clears the error and fades its toast (R26), and so does closing the dialog; a
  success fades on its timer. A refused Delete says so. A field error or a standing notice is NOT
  a result: it is a danger Callout by the field or in the pane it describes, never a toast.
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
- Memory: no unfiltered entry (no `allLabel`), no Global, no orphans: main lists ONE workspace's
  items (plus the global ones with `Include global`). `Show stale` (a `Checkbox`, not persisted)
  sits beside `Include global`: both choose which rows exist.
- Opens on the ACTIVE workspace; unknown active id → unfiltered. The Sessions dialog's SESSION
  pages (Active, Past) too (owner 2026-10-12; reverses "open on `All sessions`", 2026-10-03).
- **Include global** (spec 2026-10-03 H; reverses "strict filtering both ways", owner-approved
  2026-10-03): beside a WORKSPACE scope, an `Include global` checkbox (`ScopeFilter/IncludeGlobal`)
  also lists the global rows — what applies there. ONE remembered choice (`settings.includeGlobal`,
  default on) for Templates / Shortcuts / Tags / Rules / Memory; saved on change, a refused write
  rolls back and says so; not in the Settings dialog; not rendered under All / Global /
  `(no workspace)`.
  Workspace rows first, then global, one flat list (Rules keeps the saved RUN order). Global alone
  still shows only global rows. **Every row carries `ScopeMarker`** (its workspace in tint,
  `Global`, or `(no workspace)`), in every scope — that marker is what keeps a global row from
  being edited by mistake. (`+ New session` popover merges global + active, unchanged.)
- **Flat list in every scope, no section headers.**
- Scope change closes what was open. A save that moves a row re-points the filter to its scope.
- **Active / Past rail filter** (`SessionsDialog/RailFilter.tsx`): the page's search (`TextInput
variant="toolbar"` + magnifier, 32px like the board's) + the same `Filter` button
  (`FilterToggle`) on one line, `FilterChips` (wrapping, `data-wrap`) under it;
  Past adds `Ended`. Filters per page and scope while the dialog is open (`railFilters.ts`
  `useScopedFilters`, held by `SessionsDialog` so a page switch keeps them; tags offered by
  `railTags`), never persisted. The Memory dialog's rail is the same `RailFilter` (owner's pick,
  2026-11-11): its types come from `MEMORY_FILTER_FIELDS` (`MemoryDialog/memoryFilterMap.ts`:
  Folder, Session, Tag, Updated, Goal, Session deleted), folder / session / goal pick ONE value
  (`single`, radio rows that close: main filters by one), filters per page, never persisted.
- Memory's pages: `Specifics` and `Facts` edit; an item a save kept with its quote has
  `Open source` in its action row (the quote opens under the read-only lines). After `Check`, the
  form places the item (spec 2026-11-14 memory context index §8): `Folder` (a `Select`, `No
  folder` first, then the folders the dialog knows; a row draws the name and its parent path as
  the Folder filter's rows do, `title` = the whole path), `Goal` (a `Select`, `No goal` first, the
  workspace's goals; not rendered for a global item or under `Global`), `Tags` (the picked tags'
  `TagChipRow` and the session card's ghost tag button opening `TagPicker`), then ONE
  `ManageDialog.Hint` (`Sessions in this folder, goal or with these tags list this item. With
  none, every session of the workspace does.`). On an open specific or fact these replace the
  read-only `Folder` and `Tags` lines (`Origin session` and `Workspace` stay; an episode keeps
  all four). A New form starts from the rail's filters; `Global` on clears the goal and the tags a
  global item cannot hold. A stored goal or tag that is gone is not drawn, sent or dropped. A specific main marks
  as holding the same value as another one (`twinIds`) draws `Same value` in its row's meta line
  (the `Stale` pill) and, in its form under the action row, `Same value as`: one ghost `sm` Button
  per twin (its key, `title` `Open <key>`, its age beside it; a click opens it), `<n> more` past
  five, and one hint. No toast, count or Callout flags it. `Episodes` is written
  by saves only: no `+ New`, no pin, a read-only form (`EpisodeForm`: `Title`, `Body`,
  `[Mark stale]`, `[Past sessions]` while the session's record is listed, `Ended`; no `History`,
  no `Save`; the footer is `Delete` only). `Commands` lists one workspace's commands that worked
  (scope only: no `Include global`, no `Show stale`; the search alone in the rail; no `+ New`):
  the right column shows the command in History's frame, `Folder`, `Last run` and `Delete`.
- Three empty states, three sentences: nothing at all / nothing in this scope / no search matches.
- `+ New` at rail bottom (`ManageDialog.ListBottom`, `margin-top: auto`).
- Options pass a `WorkspaceLabel` as `display`: the OPEN list shows each name in its tint; the closed
  trigger shows the plain `label` — a tint box never sits inside the dropdown box (spec 2026-10-03
  G). Every `Select` follows it, so a form's `Workspace` field too.

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
  `Hide tags`. `Show all tags` toggle lit the same way. It is remembered PER WORKSPACE
  (`settings.showAllTagsByWorkspace`); the rail's collapse is remembered once for all
  (`settings.railCollapsed`). A refused save rolls back and toasts.
- Tag names truncate sideways only (`overflow-x: clip`, `text-box: trim-both ex alphabetic`) —
  `overflow:hidden` + `line-height:1` cut descenders.
- `TagPicker` trigger: `aria-expanded` + `aria-controls`, never `aria-haspopup` (popup is a
  checkbox `group`).
- **Every tag list popup is `components/TagMenu/TagMenu.tsx`** (filter + `TagPicker`): chip per
  row, `✓` at right when on, no native checkbox. Drawn with `Popover`. Filter = `menu`
  (`menuitemcheckbox`, several tags), picker = `group` (`role="checkbox"`). The picker's list (a
  card's `Tags…`, the rail peek's `+ tag`) is portaled to `document.body` and placed under its
  trigger, right edges lined up (left edges when that would leave the window: the rail's `+ tag`
  sits near its left edge), by `useAnchoredPlacement`, as `Select`'s list is: drawn inside
  its anchor, a form's scroll body would cut it. Out of the DOM order, it takes focus when it
  opens (its first row, or the list itself when no tag is in scope); Escape, or Tab past either
  end, closes it and hands focus back to its trigger. The filter's list stays under its pill.
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
- Themes may restyle hover (Liquid Glass does; Paper keeps the app hover fill).

## Spacing roles (`styles/spacing.guard.test.ts`)

Spec `2026-10-01-spacing-roles-design.md`. Target: compact but airy — rows small, groups and
sections clearly apart. Every `gap`/`padding`/`margin` in a component stylesheet is a ROLE token
(`shared/theme/tokens.ts`, built on the `--space-N` scale), never `--space-N` or a raw length.

| Role                                   | Value     | Use                                             |
| -------------------------------------- | --------- | ----------------------------------------------- |
| `--gap-stack`                          | 2px       | title over subtitle in one row                  |
| `--gap-row`                            | 4px       | rows of one list / menu                         |
| `--gap-row-filled`                     | 8px       | filled-box rows: every Manage rail, task boxes  |
| `--gap-inline-tight`                   | 4px       | icon + text, small tool clusters                |
| `--gap-inline`                         | 8px       | controls side by side, button rows              |
| `--gap-group`                          | 12px      | groups in a menu, rail, pane; cards in a column |
| `--gap-field`                          | 6px       | label → its control, above or beside it         |
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
- **Manage footer sits under the scroll body** (spec 2026-10-29 goals page polish): a Form or
  Pane is its scroll body (`[data-manage-scroll]`) then a footer slot; `ManageDialog.Footer`
  draws into that slot wherever it sits in the children, so `[Delete] [Save]` stay in view and
  nothing scrolls behind them. No fill, no band. Themes style `[data-manage-footer]`.
- The guard's allow-list holds optical nudges and geometry (`+1px` border compensation, the 28px
  peek toggle, 14px icon, 8px dot), each with a reason. A new one needs a reason, not a habit.
- `--gutter` / `--card-gap` are aliases kept for themes; components use the roles.

## Regions and breathing (`ManageDialog.styles.test.ts`)

Spec `2026-10-02-region-spacing-design.md`. The roles say WHICH value a relation gets; this says
which relation two neighbours ARE. Items of one kind close, different regions clearly apart.

1. **A screen is a stack of regions.** Header (title row, optional description) · body (rail |
   pane). Rail: top tool (search) · list · bottom slot (`+ New` or an action row,
   plus an optional footnote). Form: blocks (label + control + hint) · footer.
2. **Two different regions never sit closer than `--gap-group` (12px)**; rows of one list keep
   `--gap-row` / `--gap-row-filled`. Check: the space AROUND a group is at least twice the largest
   space INSIDE it (rows 4 → regions 12; field block 6 → blocks 20). One exception (owner,
   2026-10-14): a dialog's title → description is 20, as wide as header → body.
3. **One role per boundary:**

| From → to                            | Role                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| title → its description              | `--gap-section` (20), every dialog (Quit/Stop too)   |
| header → body                        | `--gap-section` (20)                                 |
| rail top tool → list                 | `--gap-group` (12)                                   |
| list → bottom slot                   | `--gap-group` (12), slot pinned `margin-top: auto`   |
| bottom slot's action → its footnote  | `--gap-field` (6)                                    |
| label → control, control → its hint  | `--gap-field` (6), label above or beside             |
| hint / state note → the next control | `--gap-inline` (8)                                   |
| block → block                        | `--gap-section` (20)                                 |
| last block → footer buttons          | `--gap-actions` (24) as the footer's own padding-top |

A label beside its control (a checkbox's text, a swatch beside its radio) is the same boundary as
one above it. The exception is a Settings row: its label and control sit at the row's two edges.

4. **Same kind, same size.** Settings rows share one `min-height` (a 36px field Select/TextInput
   - insets), so a switch row matches a dropdown row. A rail search is
     `<TextInput variant="inline">`; a search beside a `Filter` button (the board, the Active /
     Past rail) is `variant="toolbar"` (32px, the button's height). Every menu and list row is 36px, 13 / 500
     (`Popover` `.item`); a Manage rail row is 44px, 13 / 500 (`.rowSelect`), room for a second
     line (Shortcuts, Workspaces) — its hover is the whole row, pin and checkbox included; compact and quiet popover rows keep their own size. Open-rail
     rows 36, active row 40; collapsed rail 40 / 44 squares.
5. **A scroll region never ends flush on a fixed region.** The rail list stops `--gap-group` above
   the bottom slot. A form's body keeps an `--inset-compact-y` buffer at its bottom (the last
   field's focus ring stays whole), and the footer's padding-top makes up the rest of
   `--gap-actions`. `scroll-padding-block` parks a field reached by Tab above the body's end fade.
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
   clearly outside. Every `ManageDialog.Rows`, and every Form or Pane body, fades its bottom 32px
   while more is below (`useOverflowEnd`, one shared CSS rule); none at rest. A 32px bottom scroll
   padding parks a row or field reached by keyboard above the fade.
9. **Bare controls get more air than containers** (owner, 2026-10-12). A container's own edge
   already separates it, and its content, so space plus that edge reads as a double break: two
   containers side by side keep the smaller gap. Controls with no container around them (a search
   field, a row of buttons) are boxes themselves, and only space separates them from the next
   container, so they get the larger gap. Liquid Glass: window edge → header 12, header → focused
   body 12 (container → container), header → board search row 16 (container → bare controls).

## Board filter bar (`components/FilterBar/FilterBar.tsx`)

The ONE place the board is filtered/searched; above the columns, never in the header.

- CONTROLS row always drawn, no box: search, `Filter` button, count (`5 sessions` /
  `3 shown · 2 hidden`). CHIP row (boxed; a pill per filter type that is on, then
  `+ Add filter`) only while `Filter` is pressed. Not persisted.
- **Search matches card NAME only**, case-insensitive substring, trimmed. `<TextInput
variant="toolbar">` + magnifier `icon`. Escape with text clears and stops; empty passes through.
  `boardStore.searchQuery`, not persisted, survives workspace switch.
- Filters + search narrow board, column counts and rail status groups through ONE `BoardFilter`
  (`useBoardFilter`). Pinned rail row, notifier, badge, sound ignore both.
- **Filter types:** Tag (several, any of), Folder (several, any of; the workspace's own folders),
  Launched (Today / Last 7 days / Last 30 days / On a day / Since a day). AND across types. The chip
  row is `components/FilterChips/FilterChips.tsx`, the ONE chip row (board, the Sessions pages' rail
  and the Memory rail; Memory adds Session, Updated and the value-less `Session deleted`, whose type
  row turns it on and whose pill only removes). `+ Add filter` opens a type menu (types already on
  are not offered); each row is a `Popover.Submenu` whose values open beside it, on the right
  unless they would leave the window (`submenuSide`: the TYPE MENU's right edge + `SUBMENU_ROOM`,
  measured when a submenu opens), then on the left. A pill reopens its values under itself; `×`
  removes the type. Tag and folder rows are `menuitemcheckbox` and the list stays open while
  picking (a surface's `single` types are `menuitemradio` and a pick closes); the Launched / Ended
  rows (`On a day` / `Since a day` included) are `menuitemradio`, and a preset or a calendar day
  closes. Opened from a KEY (Enter / Space on `+ Add filter` or a pill), the list focuses its
  first row, like the submenu's ArrowRight; a pointer open leaves focus on the trigger.
  ArrowDown / ArrowUp move between the rows of the focused menu (`Popover/menuArrows.ts`,
  `moveMenuRow`). Tag counts as on only through a tag the surface offers (a gone id neither
  draws a pill nor hides Tag). Two offered tags with the same name each show a `ScopeMarker`
  after the chip (`Global`, the workspace, or `(no workspace)` when it is gone); a tag with its
  own name shows none.
- Pills: `Tag is <chips>` / `Tag is any of <chips>` (`TagChipRow`, `+N` past its capped slot),
  `Folder is <name>` / `Folder is any of <names>` (`title` = full paths), `Launched today` …
  `Launched since <date>`. A crowded row shrinks the folder and time pills (text ends in `…`);
  the Tag pill and `+ Add filter` never shrink. Every list floats over the columns / rail rows
  (the row is a stacking context, each list positioned), never pushing them down. A popup under a
  trigger (the type menu, a pill's list, the Calendar) lines up with the trigger's left edge, or
  with its right edge when `trigger.left + SUBMENU_ROOM` passes the window (`popupAlign`, the
  submenu's flip rule, measured as it opens), so it stays inside the window. Every popup the row
  opens is at most `FILTER_LIST_MAX` wide (`SUBMENU_ROOM` minus the submenu gap; the chip row sets
  `--popover-max-width`), so a value list always fits the room the flip reserves. A folder row's
  parent path gives way first, then the name ends in `…`; the row's `title` is the full path.
- **Per workspace:** `boardStore.filtersByWorkspace` — switching away keeps a workspace's filters,
  switching back restores them all. Not persisted. Tags a workspace cannot see drop out at read
  time (`useBoardFilter` → `effectiveFilters`). Search stays ONE global box.
- `Filter` = `components/FilterBar/FilterToggle.tsx` (board and rail): `<Button variant="secondary"
lit>`, word + 16px filter-list icon, 32px (same as the search box beside it — pinned by test),
  titled `Show filters`/`Hide filters`. No chevron. LIT while chip row open AND while closed with
  a filter on. Count = number of filter TYPES on (`Filter, 2 on`). Search never counted.
- Spacing: `--gap-group` (12px) under header, `--gap-page` (16px) above columns (`FilterBar` `.bar`,
  `Board.module.css` `.filterSlot`). Never a negative margin on the grid (covers the bar's clicks).
- Empty sentences name what hides cards (`lib/filterCopy.ts`): `No sessions match the filters and
“dep”` (or `the filters` / `“dep”` alone), with a hint naming the way back. aria-live too.
- Drawn only when the workspace has sessions (stays when filter hides all); the `Filter` button
  shows whenever it is drawn (folder and time need no tag). No tag: the Tag list offers
  `Create tags` when a Tags dialog exists.
- **Calendar** (`components/Calendar/`): Popover.Surface, under the trigger that opened the list;
  Monday first; today outlined; the pick LIT; a since-range tinted `--bg-hover`; future days off;
  12 months back; hint `Pick one day.` / `From the picked day up to today.`
- `Sort` / `⋯` not built (IdeasBoard) — not rendered.

## Header ☰ menu (`components/AppMenu/AppMenu.tsx`)

The header holds the `Goals` icon button (lucide `circle-check-big`, a Button `reveal`: its name
`Goals` slides out on hover or focus, lit while the sheet is open, with the active workspace's open-task count as a `CountPill` between the icon and the name, none at 0; it opens AND closes the Goals sheet,
`ManageDialog.Frame size="drop"`: rendered inside `<main>`, it floats a page gutter under the header
(never touching it), centred, 75% of the body each way (goals rail 2fr : tasks 3fr), and the header stays in view — only its other controls go inert), `+ New session` and this ☰ menu, last. The menu filters nothing.
The Goals sheet's rail starts with `Daily tasks` (the tasks with no goal): it is open on every open
of the sheet and where a deleted goal leaves it, so the sheet has no placeholder (like Settings,
which opens on its first category). Every task, in the sheet and in the focused task panel, is the
one boxed `TaskRow` (44px, `md` `Done` / `Undo`, `md` ghost ✕). In the focused task panel the rows
sit `--gap-section` under the `Tasks` head; on the sheet the progress bar, the rows, `+ New task`
and the start bar sit in ONE darker box (`--bg-inset`, `--gap-group` apart), and `Plan with Claude`
sits `--gap-section` below it, outside.
A goal's form: `Default folder` with `Choose…` (a goal's folder is never cleared; a new goal's
`Create` opens the picker first), then the `Save to GOALS.md` `Switch` and its hint; a file
problem is a danger `Callout` with `Try again`. A goal with no folder (made before folders were
required) shows a danger `Callout` instead, and no switch, `Plan with Claude` or select boxes.
On the sheet only, a ghost `▸` / `▾` before ✕ opens a row: the title wraps in full and `Edit`
shows; `Edit` swaps the title for a 3-row `TextArea` (the title wraps) with `Save` / `Cancel`
(Enter saves, a pasted line break becomes a space, Escape cancels the edit only, empty or
unchanged saves nothing). Also on the sheet only: an OPEN task's row has
`Link session` before `▸` / `▾` (a `Popover` menu of the task workspace's live sessions not linked
yet, Needs you first, each `StatusDot` + name; the same link as the rail's `Link task`), and under
its title each live linked session is a ghost button (`StatusDot` + name, `title` `Open <name>`):
a click closes the sheet, then opens the session (`openFromNotification`). A session that ended
drops off the row; the task panel draws no such line.
`TaskRow` (sheet and task panel) draws under its first line, the full row wide, `Check: <recipe>`
when the task has a check and, while it is open, `Reported done by "<session>" <date>` with the
evidence line under it. A report only FLAGS the task: the row is not drawn done and `Done` stays
the operator's. A long session name is cut with `…`, never the date.

- Rows: `Settings` (sliders), `Shortcuts` (keyboard), `Tags ›` (`Manage tags` /
  `Manage rules`), `Memory` (bookmark), `Sessions ›` (clock; `Active sessions` / `Past sessions` /
  `Templates` / `Import session`) ALWAYS LAST. New rows go before it. Icons: one line set (16 grid,
  1.5 stroke, 14px) in a fixed-width slot; `›` at right; submenus still open LEFT.
- Submenus are `Popover.Submenu` (`components/Popover/PopoverSubmenu.tsx`, side `left` here; the
  filter's type menu is its other caller): open LEFT, level with their row; hover opens, click
  OPENS (never toggles); ArrowRight opens and focuses the first row (of any `menuitem*` role),
  ArrowLeft back; ONE open at a time. ArrowDown / ArrowUp move between the rows of the menu level
  that has focus and stop at its ends (`moveMenuRow`, called from the anchor's keydown).
- Escape peels one layer (submenu, then menu), listens on the whole menu; closed → passes through.
- Every row opens a dialog under the single-modal rule (`settingsDialogOpen`, `sessionsDialog`,
  `tagsDialog`, `memoryDialogOpen` in `boardStore` join `isModalOpen()`).

## Past sessions and exits

- Past sessions is the Past PAGE of the Sessions dialog (☰ → Sessions). Nothing selected →
  placeholder "Select a session on the left." Load failure → danger Callout
  `Could not load past sessions` in the rail (local state, not the dialog's error toast),
  suppresses the empty sentence.
- **Every exit is Archive or Delete.** Card + focused bar carry Archive (no confirm, reversible) and
  red-at-rest Delete. Delete opens `StopConfirm`: "Delete session? The session is stopped and
  nothing is kept in Past sessions. Claude's own files are not touched." — Cancel default-focused.
  When the session saved memory items it adds an info `Callout` (`This session saved <n> items to
memory.` / `Kept in Memory, marked Session deleted.`) and a `Checkbox` `Also delete from memory`,
  unticked (owner, 2026-11-12); ticked, the detail reads `Deleted with the session. This cannot be
undone.` The Sessions dialog's armed Delete does not offer the box.
- A Past record's form edits ONE field: its tags, with the Memory form's tag button and
  `TagPicker` (the workspace's tags and the global ones), through `setSessionTags` with the
  `window.pastSessions.setTags` writer; the rest is read-only. A refusal is the dialog's one
  result toast, never a board toast.
- A Past record's form shows how saving memory from it went (`Memory: <counts>`,
  `Memory: nothing new`, `Memory: failed`, `Memory: saving…`, `Memory: off`) and, under it, the
  title and body of the episode the session left (read from memory by id; nothing when it is gone).
- **Sessions → Active** (spec 2026-10-03 D): the live sessions of a scope, Needs you → Working →
  Idle, oldest first; a `RowCheck` per row + `Select all` (indeterminate) for the bulk bar
  (`ListBottomDivided`: `N selected [Archive] [Delete]`), the row itself for the details
  (`[Delete] [Archive] [Open]`). Delete ARMS IN PLACE (keyed: `armKey="bulk"` vs the footer's) with
  StopConfirm's sentence as a `Hint` — StopConfirm cannot open over a dialog. Results are the
  dialog's own result toast, through the quiet exit core (`archiveTerminalCore` /
  `deleteTerminalCore` / `exitSessions`): no board toast, no jump to the board. `Open` closes the
  dialog, then `openFromNotification`.
- **No key archives** (R27); Archive button label names no chord.
- `Esc to return` only while focus is outside the terminal.
- Rail foot: "Keeps the 200 most recent sessions" (UX-15) — a `ListNote` in `ListBottomDivided`
  (behind a divider: a different region from the list). Importing a session the app did not
  launch is the Sessions dialog's **Import** page (`pages | form`: `Claude session id`,
  `Workspace` opening on the active one, `[Import]`; no explaining text).
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

1. A dialog's result (a save, delete, forget, restore, start or import that landed or was
   refused) → its ONE result toast (`dialog:<testIdPrefix>`; the name prompt `dialog:session-name`;
   Settings' `Saved`), inside the dialog's panel, bottom-right. Delete confirm and Quit guard
   toast refusals too.
   A field error or standing notice stays inline (a danger Callout by what it describes).
2. Small action on a control that stays (Copy, Reload themes, Regenerate) → Button `feedback` for
   1.5 s.
3. Board-level or off-screen result → toast.

Copy mapped from a CODE (`includes` — Electron wraps rejections), never `error.message`. This holds
until `maintainability.md` rule 3's guard lands; then copy maps from `ipcErrorCode(err)`.

- **Callout (`components/Callout`, spec `2026-10-01-feedback-callout-design.md`) is the ONE in-page
  message.** Tinted box (`--success-fill`/`--danger-fill`/`--info-fill`), 1px tinted border, 3px
  `--success`/`--danger`/`--info` left bar, icon disc drawn in CSS (text = the words),
  `--text-primary` title, optional `detail` (`--text-secondary`) and `action`. `size="block"` (a
  field or pane error, small forms, banners) or `"compact"` (one line: the expander). Success and
  info `role="status"`, danger `role="alert"`; `announce={false}` inside something already live
  (dead pane). `tone="info"` (light blue, owner 2026-11-12) is the neutral tone: a standing state
  the operator chose or should know (`Memory is off.`), never a result and never an error.
- A dialog's success toast lasts the toast time (`TOAST_MS`); its error stays until the next
  action, a ✕ or the dialog closing. Success copy names the THING (`Rule deleted.`,
  `Session forgotten.`), never a typed value. Green = `--success`; themes override it (Paper: dark green — `#a6e3a1` on white fails 3:1).
- Toast mark: a success and an error draw the Callout disc (`[data-toast-mark]`, 16px,
  `--success` `✓` / `--danger` `!`, glyph in CSS); info draws none.

- **Toasts:** `stores/toastStore.ts` (`toast.success/error/info`) + `<Toaster />` mounted ONCE in
  `App.tsx`, outside the `inert` subtree. Max 3 (4th drops oldest); success/info 5 s (6 s with
  action); error stays; hover/focus pauses. Bottom-right, `--space-4`, `z-index: 70`. TWO stacks
  (owner, 2026-11-12). A BOARD toast (any toast that is not a dialog's result) keeps the window
  corner, dialog open or not: it never moves into a dialog that opens. A DIALOG's toast
  (`isDialogToast`: its key comes from `dialogToastKey`) sits, while a dialog is open, whole
  INSIDE its panel (`[data-toast-anchor]`), a `--space-4` in
  from the panel's bottom-right corner and never wider than the panel, and rises a `--space-4`
  above its button row (`[data-toast-clearance]`) only when it would cover it
  (`Toaster/toastPlacement.ts` → `--toast-right` / `--toast-bottom` / `--toast-room`), so it
  never floats half outside the dialog or covers `[Delete] [Save]`. Anatomy: disc
  (success and error), title, optional `detail`, optional action (`Button primary sm` with its
  icon, `ToastAction.icon`), ✕ (`Button secondary xs icon="round"`, `aria-label="Dismiss"`).
  Success/info `role="status"`, error `role="alert"`, in `<section aria-label="Notifications">`.
  Themes: `[data-toast]`, `[data-toast-kind]`, `[data-toast-mark]`, `[data-toast-key]`,
  `[data-toast-anchor]`, `[data-toast-clearance]`.
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
- Settings: every change says `Saved` in the dialog's success toast (one at a time: quick changes
  replace it); a refused change rolls back (`persistSettingsPatch` → `settings_persist_failed`)
  and toasts `Could not save <setting>.`
- **Name prompt stays open while main answers** (`lib/namePromptFlow.ts`): busy `Starting…` /
  `Renaming…`; refusal keeps the name and toasts mapped copy (`dialog:session-name`;
  `folder_missing`, `claude_version`, `template_not_found`). No answer in 15 s → close + `Still starting "<name>"…` toast. Late result
  never takes the view (success → registry only + toast with `Open`; failure → error toast).
- **Archive/Delete wait for main:** view goes to board at once, registry only after main answers.
  Archive toasts `Archived "<name>"` with `Resume` (only once the record exists and with a bound id).
- **A save from a session is a BOARD toast** (`lib/memoryToasts.ts`, on `memory:extract-result`):
  `Memory saved from "<name>".` with the counts on its detail line
  (`<n> saved to memory, <m> tasks`, a 0 part left out) and `Show` only when n > 0 (opens Memory
  on that session; nothing while a modal is open); `Nothing new to remember from "<name>".`
  (info); `Could not save memory from "<name>".` (error; `claude_version` adds
  `Needs claude <version> or newer.`). The title stays short so only a long name is cut.
- Settings → Memory: the `Memory` Switch; while it is on, `Memory recall` (Switch, first),
  `Memory checkpoint` (Select `Off` / `10 turns` / `15 turns` / `25 turns`), `Save open work as
  tasks` (Switch) and `Memory model` (Select `Haiku` / `Sonnet`), each with its hint; off, the
  four are not rendered.
- Context → Memory: `Injected` starts with the index the session got (`Index: <n> tokens · <m>
  items`), then one row per reason the index listed or counted keys for, in its order (`Pinned`,
  `Same task`, `Same goal`, `This folder`, `Folders above`, `Whole workspace`, `Same template`,
  `Same tags`, `Folders below`, `Episodes`; details `<n> items`, `<n> pulled` when claude read any
  with `memory_get`, `<n> not listed` when the group had a count line), then lists each item
  recall gave while the session ran (`With a prompt` / `With a file`); `Nothing injected.` only when it got neither; a session that runs without recall for a
  reason the operator did not choose shows an info `Callout` above the lists (`claude_too_old`,
  `mod_not_installed`; none for `setting_off`).
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
  `TextInput.test.tsx` fails on any other `.input`/`.search`/`.textField` class. An on/off setting is
  `components/Switch` (guard in `Settings.test.tsx`); a checkbox that SELECTS things is
  `components/Checkbox` (lit square, 4px corners in every theme, its text `--gap-field` after the
  box), and a radio is `components/Radio` (lit circle in every theme; what it names sits
  `--gap-field` beside it in the caller's `<label>`). Guard for both:
  `components/choiceInputs.guard.test.ts`. Ranges stay bare.
- **`<button className=…>` → `components/Button/Button.tsx`.** Variants: `primary` (ONE main
  action: RAISED `--bg-surface-raised` fill + strong border + 600 weight, never an accent colour —
  a blue primary was rejected 2026-09-23), `secondary` (outlined), `danger`, `ghost` (borderless icons). Sizes
  (fixed heights): `md` 32px, `sm` 28px, `xs` 20px; `icon` = square, `icon="round"` = circle
  (`data-shape="round"`): a standalone icon control (dialog ✕, rail « / tag toggle, toast ✕) is a
  ROUND `secondary` — the ☰'s look as a circle in every theme; `ghost` stays for icons inside a
  card or row. `reveal="<name>"` = an icon button whose name slides out to the right of the icon on
  hover or keyboard focus (the focused bar's Context / Shell / Tasks / Archive / Delete, the
  header's Goals); the name is the button's text, so it needs no `aria-label`. `count={{ value, label, kind }}` (reveal only) adds a `CountPill` between the icon and the name (Goals' open tasks), `aria-hidden` with `, {label}` in the name; nothing at 0; on a `lit` button a grey pill (`[data-fill='grey']`, stamped by `CountPill`) swaps its fill and ink. `lit` = toggle ON
  (`data-lit` present only when on — test `hasAttribute`). The favorite pin (`FavoriteToggle`) is
  `ghost xs icon` with `aria-pressed`; its filled pin IS the on look, never `lit`. **No `className`** — layout goes on a
  wrapper. Refs via `buttonRef`. `Button.test.tsx` fails on any other button class.
  Workspace switcher is NOT a Button (compound pill, matches `md` height); its menu lists only the
  OTHER workspaces (none → just `Manage workspaces`). Menu rows are Popover rows.
  The guard bans a module's BUTTON-LOOK classes, not a raw `<button>`: a part of a compound control
  that is not a free-standing button stays a raw `<button className>` with its own class (the
  `Select` trigger, Popover rows, the `FilterChips` pill halves and the dashed `+ Add filter` /
  rail `+ tag` pills, `TagChip` /
  `TagIndicator`, and the Calendar's day cells, dense grid cells). A free-standing button inside
  one is a `Button` (the Calendar's month arrows).
- **Hand-made menu/list popup → `components/Popover`** (spec
  `2026-10-01-popover-standard-design.md`). Parts: `Surface` (box, never scrolls), `List` (only
  scrolling part, `--popover-max-height` on the caller's wrapper; `--popover-max-width` caps the
  Surface the same way), `Item`, `CompactItem`,
  `QuietItem`, `ItemIcon`, `ItemEnd`, `Divider`, `Note`, and `Submenu` (a row whose list opens
  beside it; the only part that also behaves: hover / click / ArrowRight / ArrowLeft). Draws only —
  roles, keys, open/close, position stay with the caller (`moveMenuRow` is the shared ArrowDown /
  ArrowUp helper a caller's keydown calls); no `className`. Row states read from ARIA
  (`aria-selected`, `aria-checked`, `aria-expanded`) + `active` (`data-active`). `tone` → WorkspaceTint +
  `data-tone`. Themes target `[data-popover]`, `[data-popover-list]`, `[data-popover-item]`
  (+ `[data-density='compact']`, `[data-quiet]`, `[data-tone]`), `[data-popover-divider]`.
  `Popover.guard.test.ts` fails on a raw `role="menu"`/`listbox`/`option` or a `--shadow-pop` box
  elsewhere.
- **Menu rows: an icon, never `…`** (owner, 2026-10-15). Every ACTION row (`Popover.Item` /
  `QuietItem` that opens a dialog or runs a command: `Settings`, `Manage tags`, `Pick a folder`,
  `Create tags`, `Manage workspaces`) puts a 14px icon in `Popover.ItemIcon`, from
  `components/Icon/MenuIcons.tsx` (16 grid, 1.5 stroke), `TagGlyphIcon` or `LucideIcon`. Same
  thing, same icon (Templates and `Manage templates` share one). A new icon goes in `MenuIcons.tsx`.
  The label never ends in `…`, and no other option does either (a `Select` option, `Custom`).
  Exempt: DATA rows (a template, a workspace, a tag, a Select option) — their name, tint or chip
  is the mark; and `CompactItem` rows (Copy / Paste, card move) keep their compact look. Busy and
  progress words (`Starting…`, `Loading…`) are not options and keep their `…`.
  `Popover.guard.test.ts` fails on a static-label action row with no `ItemIcon` or with a `…`.
- **Overlay motion** (spec `2026-10-04-overlay-motion-design.md`; values in `styles/motion.css`, not
  theme tokens). A popover or modal renders through `<Presence value={x}>` (`open || null` for a
  boolean), never `open && <…>`: it stays mounted `MOTION_EXIT_MS` with `data-leaving` + `inert`
  after a POINTER close, and unmounts at once after a keyboard close or under reduced motion
  (`lib/inputModality.ts` → `data-input` on `<html>`). `Popover.Surface` and the dialog frames read
  the leaving state from context; the caller's positioned wrapper takes `leavingProps(leaving)` or
  it swallows clicks during the exit (guard). Payload a fading dialog shows (busy label, error)
  rides IN the Presence value. A surface that holds a submenu never fades its own opacity (it
  cuts Liquid Glass's `::before` blur — measured).

## UX canon (owner, 2026-10-12)

Our rules, taken from the community's accepted UX practice (Gestalt, Nielsen's heuristics, Laws
of UX, WCAG, Refactoring UI, design systems). The sections above are the detail; this is the WHY a
new screen is checked against. `Gap:` = the app does not meet the rule yet; fix it when you touch
that area, never cite it as precedent.

**Grouping and spacing**

1. **Proximity groups.** Close = one group, apart = different roles (Regions and breathing).
2. **A shared edge or fill groups**, and beats distance (Regions rule 7).
3. **Outside ≥ inside.** The space around a group is at least the space inside it; ours is ≥ 2×
   (Regions rule 2).
4. **One spacing scale.** Every gap is a role token on the 4/8 scale, never a raw length (Spacing
   roles).
5. **Spacing climbs with level:** rows < groups < sections < page.
6. **Separate with space or fill first; a border last.** A border is thin and quiet.
7. **No double separation.** No divider inside a box whose edge already separates; no line where
   space already separates. Bare controls get more air than containers (Regions rule 9).
8. **Crowded? Add space, not a line.**
9. **Measure what the eye sees**, ink to ink, not box to box; icons beside text need less gap.
10. **Start with too much space, then take it away.** Too much is easier to see than too little.
11. **Window-edge margin and gap between panes are separate choices**, each picked on purpose.
12. **Spacing and hierarchy come first in a spec**, before colours and effects.

**Feedback and status**

13. **Always show what is going on** (Nielsen 1): every action ends in a visible result (Feedback).
14. **Fast or busy.** Answer within ~400 ms (Doherty); slower work shows `busy` at once. Gap: no
    response-time budget is measured.
15. **Errors in plain words with a way out** (Nielsen 9): copy mapped from a code, a refused change
    rolls back and says so.

**Errors and destructive actions**

16. **Prevent errors over explaining them** (Nielsen 5): make the wrong state impossible; a button
    never runs twice.
17. **Reversible = instant, irreversible = confirm.** Archive has no confirm; Delete is red, confirms,
    keeps nothing (but the session's memory items, marked `Session deleted`). A confirm on everything teaches people to click through it. Gap: no `Undo` on the
    Archive toast.
18. **Always a way out** (Nielsen 3): Esc / Cancel / Back from every state; a background event
    never takes the view.

**Choices and memory**

19. **Show, don't make people remember** (Nielsen 6). Gap: shortcut aliases are recall; the
    expander should list what matches.
20. **Fewer choices, faster decisions** (Hick): no new key bindings, one ☰ menu.
21. **Core first, advanced on demand** (progressive disclosure): e.g. filter chips behind `Filter`.
22. **Work like what people know; same thing, same word** (Jakob, Nielsen 4): `copy/terms.ts`,
    "Reuse before you draw", one ManageDialog shell.

**Targets and input**

23. **Big, close targets** (Fitts): clickable size ≥ 24×24 px (WCAG 2.5.8), 36 px for rows. Gap:
    not guarded; the smallest `xs` buttons were never measured.
24. **Everything works from the keyboard and focus is always visible** (WCAG 2.1.1, 2.4.7):
    `:focus-visible` on every control; focus lands in the terminal on a switch.

**Visual accessibility**

25. **Text ≥ 4.5:1** (WCAG 1.4.3), tested, on every theme and wallpaper.
26. **Icons, edges and state marks ≥ 3:1** (WCAG 1.4.11), in every state (hover, focus, active).
    Gap: glass bubble borders are not checked.
27. **Colour never alone** (WCAG 1.4.1): a meaning also has words, an icon or a shape. Check status
    dots when you touch them.

**Motion**

28. **Motion explains a change or a place; never decoration.** Only needs-you pulses loop.
29. **Short:** 150–300 ms for UI (ours: 150 ms overlays); keyboard-opened = instant.
30. **Reduced motion removes the movement, keeps the information** (`prefers-reduced-motion`).

**Content**

31. **Every element competes; keep only what earns its place** (Nielsen 8). Gold stays the loudest.
32. **An empty state says why and what next**; never a dead end. Gap: the three empty sentences
    have no action.
33. **Help sits where it is needed** (Nielsen 10): a hint next to the control, not a manual.

## Testing CSS

`vitest.config.ts` sets no `css` option, so a `*.module.css` import returns a string for EVERY key —
`expect(styles[x]).toBeTruthy()` is vacuous. Read the stylesheet's text and assert on it. New CSS
tests read it through `test/cssRule.ts`: `cssRule(file, selector)` for one rule (throws when it is
missing), `cssRules` for every rule, `readCss` for the whole sheet. Older tests still use
`readFileSync` plus an inline regex.

## Don't

- Don't use `alert()`, `confirm()` or any browser-drawn popup widget.
- Don't hard-code a colour a token names (`--danger`, `--working`, `--text-*`,
  `--workspace-<color>-*`). Never copy WorkspaceTint colours into another module.
- Don't assert a workspace name via container `textContent` — the scope dropdown contains every
  name. Query a `data-testid` or assert structure.
- Don't build a new dialog shell. `ManageDialog.Frame` is z-60, single-modal (add the open flag to
  `isDialogOpen()` in `lib/modals.ts`; `maintainability.md` rule 1 replaces the flags with one
  `modal` union), Escape-closable. Delete confirm and Quit guard are modals too (R9):
  nothing opens over them, the page behind is `inert`, Quit guard closes an open Delete confirm.
