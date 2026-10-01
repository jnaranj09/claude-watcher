# Rule: UI shape (one shell, don't invent a second layout)

This app's "Manage X" dialogs — Templates, Shortcuts, Workspaces, and the Tags and Rules
dialogs to come — do the same job: pick a row, edit it. They must look and behave like one
another, so they are all built on ONE shell: `components/ManageDialog/` (import
`ManageDialog` and `useManageDialog` from `ManageDialog.ts`). Compose its parts; read a
sibling dialog first to see how. Two dialogs that do the same job in two different layouts
is a defect, even when each one is internally fine.

(The `UX-DR<n>` ids in code comments come from the original design docs, which are not
in this tree. This file is the design rule set that IS.)

## Canonical example (the Manage-dialog shape)

```tsx
const dialog = useManageDialog({ title: 'Templates', testIdPrefix: 'templates', onClose })
const formOpen = dialog.state.creating || selected !== null

<ManageDialog.Provider {...dialog}>
  <ManageDialog.Frame>
    {/* overlay z-60, role=dialog, Escape closes */}
    <ManageDialog.Header>
      <ScopeFilter … /> {/* beside the title */}
    </ManageDialog.Header>
    <ManageDialog.Columns>
      {/* grid: fixed rail | 1fr form */}
      <ManageDialog.List>
        <ManageDialog.Rows>
          <ManageDialog.Row id={t.id} testId="template-row">
            {t.name}
            {/* <ManageDialog.RowActions> ONLY for actions the form does not own */}
          </ManageDialog.Row>
        </ManageDialog.Rows>
        <ManageDialog.New testId="template-new" /> {/* bottom of the rail; startNew() */}
      </ManageDialog.List>
      {formOpen ? (
        <ManageDialog.Form onSubmit={submit}>
          …fields…
          <ManageDialog.Footer>
            {/* flex, justify-content: flex-end */}
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
    <ManageDialog.Error testId="template-error" />
  </ManageDialog.Frame>
</ManageDialog.Provider>
```

## Two-column dialogs (the standard)

Every configuration surface in this app is `rail | right column` on `ManageDialog` — the Manage
dialogs, Past sessions, Shortcuts and Settings (spec 2026-09-29). There is no second layout.

- **The right column is one of three things**: the PLACEHOLDER (nothing open), a FORM (a row, or
  the New form), or a PANE of controls (a settings-like surface with no Save). It is **never an
  empty form**: an empty form with nothing selected reads as "is this a record or a create?".
- **Nothing open ≠ New form.** `select(null)` closes what was open (→ `ManageDialog.Placeholder`);
  `+ New` calls `startNew()` (`state.creating`). A dialog renders its form only while
  `state.creating || selected !== null` — a `selectedId` whose row is gone counts as nothing open.
- **Where each flow lands:** opening → the placeholder; `+ New` → the New form; a save → that row
  (the scope follows it); a delete / forget → the placeholder; a scope change → the placeholder.
- **The placeholder is ONE sentence**, `--text-secondary`, centred: `Select a <thing> on the left,
or create a new one.` (no `+ New` → `Select a <thing> on the left.`). No button in it: `+ New`
  at the bottom of the rail is the only create control.
- **A settings-like surface uses CATEGORIES as its rail rows** (Settings: Notifications,
  Appearance, Terminal, Keyboard, API) and opens on the first one (`initialSelectedId`), so it
  never shows a placeholder. Its right column is `ManageDialog.Pane` (same scroll region as
  `Form`, no submit), headed by the category name. A new setting goes into an existing category;
  a new category is a design question.
- **No exceptions.** Shortcuts was one (a table with an editor card above it) and was rebuilt;
  a new surface that "needs" a table or a card is a design question, not a reason for a second
  layout.

## The rules

- **A row may carry actions only inside `ManageDialog.RowActions`, and never an action the
  form already owns (Delete, rename).** The row itself selects. `RowActions` is a
  fixed-width slot revealed on hover / focus-within, so the rail never goes ragged and
  nothing shifts when a control arms. An action the form has stays in the form — a second
  control for the same job is the defect. (Rules' ↑/↓ reorder is the case this exists
  for: it has no form equivalent.)
- **Destructive actions live in the form footer, left of the primary button.** The
  footer is ONE `flex-end` row: `[Delete] [Save]`. The operator reads the object they
  are about to destroy (the form) right above the button that destroys it.
- **Destructive actions arm IN PLACE — one button, two presses.** The label goes
  `Delete` → `Confirm delete`; the button goes `variant="danger"` → `armed`. Blur
  disarms it, and Escape disarms it and STOPS THERE (it must not also close the dialog —
  Escape peels one layer). Never a second Cancel/Confirm pair: it adds a control, moves
  the layout, and buries the primary action.
- **The workspace Delete warning names EVERY store the cascade empties** — today templates,
  shortcuts, tags, rules and past sessions (main's `cascade()`). A new store that joins the cascade
  owes a word in that sentence and in its test (UX-09: rules and past sessions went silently).
  Deleting the ACTIVE workspace also re-points the focused view (`focusWorkspace`, UX-18), the way
  an explicit switch does — a dead pane of the deleted workspace must not stay on screen.
- **Delete is red at rest, filled on hover/focus.** `<Button variant="danger">` = `--danger`
  border and text on a transparent background; `:hover`/`:focus-visible` fills `--danger` with
  white text. `armed` (solid `--danger`) is the ARMED state only, so arming reads as the same
  button changing, not a new one appearing. Both looks live in `Button.module.css` and nowhere
  else: in a Manage dialog render `<ManageDialog.Delete>`, which owns the arm / blur / Escape
  behaviour once. `Button.test.tsx` fails if any other module declares a button class.
- **The panel is capped to the viewport and the FORM is what scrolls.** `.panel` is
  `max-height: calc(100vh - 2 * var(--space-6))`, `.columns` carries
  `grid-template-rows: minmax(0, 1fr)`, and `.form` is the one `overflow-y: auto` region — so the
  header (with ✕) and the rail never move and `[Delete] [Save]` stays reachable by mouse. Before it,
  a centred panel taller than the window overflowed BOTH edges: the Templates form's API fields put
  Save at `rect.bottom` 747 against a 700px window, unclickable. A form that has grown past the cap
  is a form to shorten, not a reason to grow the panel. (`ManageDialog.styles.test.ts` pins all
  three declarations; the Select popups inside a scrolled form scroll with it.) **`overflow-y: auto`
  makes `overflow-x` compute to `auto` too, so the form clips on EVERY side**: it carries
  `padding-left` AND `padding-right` (`--space-2`) plus `scroll-padding-block`, or the 3px
  `:focus-visible` ring is cut off every full-width field in it. Any new scroll region owes the same
  buffer.
- **One error line per dialog**, `role="alert"`, shared by every flow in it. Never a
  second error surface per section, and never render a thrown `error.message` — map the
  code to operator copy first (see the `copyFor`/`templateErrorMessage` precedent).
  Editing any field of the form clears it (R26). A refused Delete says so too — a store that
  swallows the rejection closes the form as if it had worked.
- **A greyed Save says why**: once the form is dirty, a muted `ManageDialog.Hint` (NOT the
  `role="alert"` line) names the failing field — Templates, Rules, Shortcuts (`shortcut-hint`,
  R26). Pick the sentence by the Zod issue PATH plus the draft's own shape, never the message.
- **A scope change in a form resets what the new scope cannot see** (R15, Rules: `rescopeDraft`).
  A dropdown left on a value it no longer offers draws blank and the save fails out of scope.
- **Every interactive control gets `:focus-visible`** in the module's shared outline
  group. A button gets it from `Button`; a non-button control (a row select, a menu item) joins
  its module's selector list.
- **A control the operator must not use is not rendered.** Do not render it disabled and
  refuse it on click (the Default workspace has NO delete button at all). Main refusing
  the operation is the backstop, not the UI's excuse to offer it.
- **The one exception: a reorder arrow in a `RowActions` slot.** ↑ on the first row and ↓ on
  the last are rendered DISABLED, with a screen-reader label saying why (`Already first`,
  `Already last`), not omitted. The slot has a fixed width that must be identical on every
  row; drop one arrow and that row carries a single off-centre button, and the rail goes
  ragged. (The Rules dialog.) Nothing else earns this exception.

## Scoped lists (the header filter)

A Manage dialog that lists rows from more than one workspace carries a **scope dropdown in its
header, beside the title** — `components/ScopeFilter/ScopeFilter.tsx`, one component for every
such dialog, so they all offer the same entries in the same order.

- **Entries, in this order:** the unfiltered entry, `Global`, one per workspace, then
  `(no workspace)` — and that last one ONLY when a row's workspace is actually gone
  (`hasOrphans`). Offering it always advertises a state that normally cannot happen.
- **The `Past sessions` dialog is the one scoped list with NO `Global` entry and no
  `(no workspace)` entry** (`ScopeFilter showGlobal={false} showOrphans={false}`): every record
  has a workspace, and the workspaces cascade keeps it that way.
- **The unfiltered entry is named after the LIST, not the workspaces:** `All templates`,
  `All shortcuts` — passed in per dialog as `allLabel`. It was `All workspaces` first, and beside
  `Global` the two read as siblings, so the honest question came back: _aren't these two the
  same?_ They are not — `Global` is a SUBSET of it (the rows in no workspace). `Global` cannot be
  the one to rename, because it is the same word the item's own `Workspace` field uses when you
  save it, and the filter has to match what you picked. So the two entries are told apart by what
  they are ABOUT: one names the list, the other names a property of a row.
- **It opens on the ACTIVE workspace**, the rows the operator most likely came to edit. If the
  active id names no known workspace, fall back to the unfiltered entry — a dropdown must never
  sit on a value it does not offer.
- **Filtering is STRICT both ways.** A workspace shows its own rows only, never the global ones
  it can also run; `Global` shows global rows only. These dialogs edit rows where they LIVE, and
  a global row edited from inside a workspace view is how a shared template gets broken for
  everyone. (The `+ New session` popover is the opposite by design — it answers "what can I run
  here", so it merges global + active.)
- **The list is FLAT in every scope, the unfiltered one included.** No section headers, ever. The
  scope a row belongs to is the form's own `Workspace` field, one click away; a header repeated
  that and cost the rail a third of its height. `All` is simply the widest filter, not a
  different rendering.
- **Changing the scope closes whatever was open** — a form or editor holding a row from the old
  view outlives the list it came from.
- **A save that moves a row to another scope follows it.** Re-point the filter at the row's new
  scope; a row that vanishes on save reads as a save that failed.
- **Three empty states, three sentences:** nothing at all / nothing in this scope / nothing
  matching the search box. One shared "No matches" sends the operator hunting for a typo when
  the answer is the dropdown.
- **`+ New` sits at the BOTTOM of the rail** (`margin-top: auto`), not directly under the last
  row — the list stops at its max-height, so without it the button floats mid-column whenever the
  form is the taller side.
- **The name sits in its tint, in the trigger and on every row.** Each option passes a
  `WorkspaceLabel` as `display` — something a native `<option>` can never do, and one of the
  reasons the native control had to go.

## Naming a workspace in the UI

A workspace is a LIGHT TINT of the control that names it — never a dot (spec
`2026-09-29-workspace-tint-design.md`). A small coloured circle reads as a session STATUS in this app
(the status dot, the rail): a blue workspace dot on the switcher's tab was read as "a card is working
over there" (operator, 2026-09-29), which is why the dot was removed everywhere.

- **`components/WorkspaceTint/` is the ONE tone → colour mapping.** `workspaceTintClass(tone)` sets
  `--ws-fill` / `--ws-border` from the `--workspace-<color>-{fill,border}` tokens; a tinted control
  reads them in its OWN rule (`background: var(--ws-fill, <its default>)`), so it keeps its shape and
  only takes the colour. Where it is used: the switcher button, its menu rows, the Workspaces dialog
  rows (`ManageDialog.Row tint`), the colour swatches.
- **A workspace listed by name is `components/WorkspaceLabel/WorkspaceLabel.tsx`**: the name in a
  small tinted box (`--rounded-sm` — a pill is a tag). The scope dropdowns pass it as the option's
  `display`; the Past sessions form shows it.
- **`tone` is a flat union**: a `WorkspaceColor`, `'global'` or `'orphan'`. The last two are NOT
  workspaces and are UNTINTED: their class RESETS `--ws-fill`/`--ws-border` to `initial`, because
  custom properties inherit and a Global label inside a tinted row must not take the row's colour.
- **The tint is light** (default fill 14% / border 40% over `--bg-surface-raised`) and text on it
  stays `--text-primary`. The tokens are separate from `--tag-*`: a workspace must not look like a tag.
- **Hover on a tinted control moves the BORDER** (`--text-secondary`), never the fill — the fill IS
  the colour. A selected tinted row: border `--text-primary`.
- **The name is never absent.** Colour is not the only cue: Global and `(no workspace)` differ by
  their NAME, which is always shown.
- **Any operator-typed name truncates and keeps a `title`.** Workspace names are unbounded (a
  domain like `docs.example.app` overflows a rail a short name fits): `overflow:hidden` +
  `text-overflow:ellipsis` + `white-space:nowrap`, `min-width:0` on the flex parent or the
  ellipsis never engages, and `title` so the full value stays reachable.
- **Text on a raised panel is `--text-secondary`, never `--text-muted`.** Muted `#6b685e` on the
  dialog panel `#2c2b27` measures **2.54:1** — under the 4.5:1 body floor and under even the
  3:1 large-text floor. Secondary measures 5.41:1. `--text-muted` is for text on `--bg-base`.

## Naming a tag in the UI

`components/TagChip/TagChip.tsx` is the ONE drawing of a tag as a CHIP — board card footers, rail
rows (peek and "Show all tags"), the tag filter's pill, both tag LISTS (below), the past-sessions
rows, and the Tags dialog's colour-preview swatch. `components/TagIndicator/TagIndicator.tsx` is its
compact form, used only by the rail's default view. The Tags dialog RAIL names a tag among its
siblings with `TagPathLabel` instead, never a chip (below).

- **A tag is a label pill, never a dot.** A rounded rectangle with a tinted fill and the name in it.
  The status dot is a circle, a workspace is a tinted square box; the rail's tag indicator is a tag
  OUTLINE.
  Nothing else draws a tag.
- **Colours come from the `--tag-<color>-{fill,border,text}` tokens only.** The fills are OPAQUE (the
  hue pre-composited over `--bg-surface`), so a chip measures the same on every surface — the gold
  needs-you rail row included, where the old translucent tint fell to 3.78:1. Chip text is ≥ 4.5:1
  on its fill and the indicator's stroke is ≥ 3:1 on every rail row fill; both are pinned against
  `tokens.ts` in the component tests.
- **Chips render in TAG-LIST order** (the catalog's name order), never in a card's own id order, so
  one tag sits in the same place on every card.
- **One line, `+N` for the rest** (`TagChipRow`) on board cards and in "Show all tags"; the `+N`
  chip's `title` lists the hidden tags.
- **A tag never changes a rail row's height in the default view.** Only the operator's own clicks —
  the peek and "Show all tags" — add a chip line (TWO ROW SIZES in `components/attention/AttentionRail.module.css`).
- **The rail peek draws INSIDE the row's card.** Its chips are the row's own second line (the line
  "Show all tags" uses), never a panel under the row on the rail's background — that read as a
  separate thing.
- **The peek ends in a `+ tag` pill, never an `Edit` button.** The board filter's `+ Add filter`
  pill (dashed, round) at a chip's size, as the last item of the chip flow, so it reads as the next
  chip. An `Edit` stacked under the tag toggle was tried and read as clutter. The real button cannot
  nest in the row `<button>`: a hidden copy holds its place in the flow, and CSS anchor positioning
  lays the button over it (`anchor-scope` per `.rowWrap`). It needs `position-visibility: always`:
  the default force-hides a box whose anchor is invisible, and the copy is `visibility: hidden`.
- **An open peek toggle is LIT** — the filter toggle's lit state: `--text-primary` fill, `--text-on-lit`
  ink, and the tag mark redrawn in that ink (`TagIndicator mono`, same shape, so nothing shifts). It
  is the row's only sign that it is expanded and can be closed; its `title` reads `Hide tags`. The
  rail header's `Show all tags` toggle is lit the same way while on.
- **A tag name truncates and keeps its `title`**, like every operator-typed name — and it clips
  SIDEWAYS only (`overflow-x: clip`), centred on the x-height (`text-box: trim-both ex alphabetic`).
  `overflow: hidden` + `line-height: 1` cut every `p`/`g`/`y` tail flat and sat the text ~1px low.
- **A trigger that opens `TagPicker` uses `aria-expanded` + `aria-controls`** (pointed at the
  picker's own id), **never `aria-haspopup`** — the popup is a checkbox `group`, not a menu.
- **Every tag list popup is `components/TagMenu/TagMenu.tsx`** — the board filter's tag list AND
  `TagPicker` (a card's `Tags…`, the rail peek's `+ tag`): a chip per row, a `✓` at the right of a
  tag that is on, the row outlined, no native checkbox (2026-09-29 — the picker's checkboxes came up
  white from the desktop theme, and two lists doing one job had two looks). The look lives in
  `components/Popover` (TagMenu is drawn with it); `TagMenu.test.tsx` fails if a caller declares its own popup or row
  rule. Roles stay each caller's: the filter is a single-choice `menu` (`menuitemradio`), the picker
  a checkbox `group` (`role="checkbox"` rows). It is drawn with `Popover`, so themes reach both lists through the Popover hooks.
- **A rail row's name leaves room for BOTH tools while they show** (hover, focus in the row, or its
  peek open): the pencil and the tag toggle overlay the row's right edge, and a long name used to run
  under them. `AttentionRail.module.css` reserves `--rail-tools-width` then; it re-truncates a
  little on hover, which is the trade.
- **In the Tags dialog rail a tag's name is `TagPathLabel`**: `acme/` in `--text-secondary`, `prod` in `--text-primary`, indented
  `depth × --space-3`, accessible name = the full name. Display only — nothing filters or matches
  by the path. Chips keep the full name.
- **A card and an untagged rail row can always reach tagging, even before a tag exists.** With no
  tag to offer, the same button (`Create tags`) opens the Tags dialog instead of an empty picker,
  so it carries `aria-haspopup="dialog"` and no `aria-expanded`. It is hidden only when there is
  no Tags dialog to open.

## The board's filter bar

`components/FilterBar/FilterBar.tsx` is the ONE place the board is filtered or searched. It sits
above the columns, never in the header: a header button reading "All tags" did not read as a filter.

- **Two rows.** The CONTROLS row is always drawn, with no box around it: the search box, the
  `Filter` button, and the count on the right (`5 sessions`, or `3 shown · 2 hidden` whenever the
  tag or the search hides a card). The CHIP row — the boxed bar holding the active filter as a pill
  (`Tag is <chip>`: click it to change the tag, `×` to remove it), or `+ Add filter` while none is
  on — draws UNDER it only while the `Filter` button is pressed. Pressing it again closes the chip
  row and any open tag list. Open/closed is not persisted.
- **The search box matches the card NAME only**, case-insensitively, anywhere in the name; spaces
  around it are ignored and a blank box hides nothing. Folder and the other card fields are future
  filter TYPES in the chip row, never search. It is `<TextInput variant="inline">` with a leading
  magnifier `icon` — Select's `inline` box, never a text-field rule of its own. Escape in a box
  holding text clears it and stops there; in an empty box it passes through. The text is renderer
  view-state (`boardStore.searchQuery`), not persisted, and it survives a workspace switch: the box
  shows it, so nothing is hidden by a filter the operator cannot see.
- **The tag and the search narrow the same things**: the board, the column counts, and the rail's
  status groups — through ONE `BoardFilter` (`useBoardFilter`) every board and rail selector takes.
  The pinned rail row, the notifier, the badge and the sound ignore both.
- **The `Filter` button has the word beside the icon, at the toolbar's height.** 32px tall, the
  same as the search box beside it (TextInput's `toolbar` variant) — the operator asked for both a
  little bigger than the 26px ☰ box they started at. A 16px "filter list" icon (three lines getting
  shorter) on the ☰ icon's grid and stroke, `--border`, `--rounded-md`. (An uppercase `FILTERS`
  label and a bare icon were both tried before; the operator's toolbar mockup put `Filter` beside
  the icon.) Titled `Show filters` / `Hide filters`. It is `<Button variant="secondary" lit>`; a
  stylesheet test pins Button's `md` height to the search box's.
- **No chevron and no "pressed" look: open reads as LIT** (below). A second look for "open" would
  make the operator ask which of the two it is in.
- **It sits tight: 8px under the header, 8px above the columns** (not the 16px gutter either side,
  which read as a gap). The grid trims its top padding only while the bar draws (`Board.module.css`
  `.filterSlot`). Never pull the grid up with a negative margin: its box would cover the lower part
  of the bar and take its clicks.
- **The button is LIT while the chip row is open**, like the rail's open tag toggles, **and while
  it is closed with a filter on** — `--text-primary` fill, `--text-on-lit` ink (`data-lit`). Closed
  with a filter on it is the loudest thing on the board's edge, on purpose: cards are hidden and the
  pill that says so is out of sight. (A corner count badge was the quieter option; the operator
  chose this one.) With a filter on it also carries the count (named `Filter, 1 on`). The search is
  never counted on the button: the box already shows what it holds.
- **Every "why is this empty" sentence names what hides the cards** — the tag, the search, or both
  (`lib/filterCopy.ts`, shared by the empty board and the empty column): `No sessions tagged prod
match “dep” here.` The aria-live summary does the same (`1 hidden by the search`).
- **Tag is the only filter type, so `+ Add filter` opens the tag list directly.** Add a type step
  (`Tag ▸`, `Status ▸`) only once a second filter type exists.
- **One tag at a time.** While a tag filter is on, the pill is where it changes, and `+ Add filter`
  is not rendered.
- **It draws only when the workspace has sessions**, and it stays when the filter hides them all,
  so the operator removes the filter right where they see the empty board.
- **No tag yet:** the list offers `Create tags…` (the Tags dialog), never an empty popup. With no
  tag AND no Tags dialog, the `Filter` button is not rendered; the search box still is.
- **Not built yet:** the mockup's `Sort` and `⋯` buttons (IdeasBoard.md). A control with nothing
  behind it is not rendered, so neither is drawn until it does something.

## The header ☰ menu

`components/AppMenu/AppMenu.tsx` is the ONE header control besides `+ New session`. It replaced three
icon buttons (⚙ settings, ⌨ shortcuts, the tag icon) and it filters nothing.

- **Rows, in this order:** `Settings…`, `Shortcuts…`, then `Tags` — a SUBMENU holding
  `Manage tags…` / `Manage rules…` — and `Past sessions…` (a clock icon) ALWAYS LAST. New rows go
  before `Past sessions…`, never after it. The tag rows stay grouped under `Tags`; do not flatten
  them into the top level.
- **Every row keeps its icon** — ⚙ `Settings…`, ⌨ `Shortcuts…`, the tag glyph on `Tags` — the icons
  the three header buttons had, so they are still found by shape. The icon sits in a fixed-width
  slot so every label starts at the same x; the submenu chevron `‹` sits at the row's right edge.
- **The submenu opens to the LEFT, level with its row** — the menu sits at the window's right edge.
  Pointing at `Tags` opens it, pointing at another row closes it; ArrowRight opens it on its first
  row, ArrowLeft goes back. Clicking `Tags` OPENS it and never toggles: a mouse points at the row
  (opening it) before it clicks, so a toggle would shut it on the very click meant to open it.
- **Escape peels one layer**: the submenu, then the menu, and it stops there. It listens on the whole
  menu, so it also works while focus is still on the ☰ button. With the menu closed it passes
  through (Focused → Board still works).
- **Every row opens a dialog under the single-modal rule** — Settings included (`settingsDialogOpen`
  in `boardStore`), so it joins `isModalOpen()`, the Escape closer and the quit-guard closer.

## The Past sessions dialog and session exits

- **Nothing selected shows the placeholder** ("Select a session on the left."), never a disabled
  Open.
- **One error line, same rule as every Manage dialog:** a failed history load sets it to
  `Could not load past sessions` (`ManageDialog.Error`, `role="alert"`) — never a thrown
  `error.message` — and the load-failed state suppresses the empty-list sentence so the two never
  show at once.
- **Every exit is Archive or Delete, never a bare Stop.** The card (hover-revealed, always
  tab-reachable) and the focused bar each carry an Archive button — no confirm; it is reversible
  through `Past sessions…` — and a red-at-rest Delete button. Delete alone opens the reworded
  confirm (`StopConfirm`, its component/test-ids unrenamed): "Delete session? The session is
  stopped and nothing is kept in Past sessions. Claude's own files are not touched." — Cancel
  default-focused, Delete the danger button.
- **No key archives** (R27). Ctrl+W is claude's delete-word; archiving on it from a slipped focus lost
  sessions with no confirm, and an arm-in-place second press would not help (the reflex is to press
  it twice). The Archive button is the only path, and its label names no chord.
- **The focused bar promises only a key that works where focus is.** `Esc to return` draws only
  while focus is OUTSIDE the terminal (inside it Esc is claude's interrupt); the title stretches, so
  its coming and going moves nothing.
- **The rail's foot says the cap:** "Keeps the 200 most recent sessions" (UX-15), in
  `--text-secondary`, where `+ New` sits in the sibling dialogs — the 201st archive drops the oldest
  with no other notice. A live session is never listed and never counted against the cap.
- **`transcript_missing` points at Forget:** "Claude no longer has this conversation. Forget it to
  remove it from the list" — claude deleted the transcript, so a resume could only fail.
- **`session_running_elsewhere` names where to act:** "This session is running in another
  terminal. Close it there first" (the dead pane: "This conversation is running in another
  terminal. Close it there first.") — UX-14, a claude outside the app holds the id.
- **A pending rename draws `⟳` after the name**, in `--text-secondary`, titled "Claude applies
  this name on your next prompt" (`NameSyncMark`, on `SessionCard` and `FocusedSession`) — it
  clears itself the moment the hook server pushes the name to claude.
- **A dead pane says WHY claude stopped** (UX-10), by exit code or signal only, never pty
  content or a path: `Claude exited with code 1.` /
  `Claude was stopped by SIGKILL (signal 9).` (`terminal/exitReason.ts`). Its actions:
  `[Resume conversation]` (secondary) `[+ New session]` (the primary). **Resume REPLACES the dead pane**: main resolves the id the terminal last ran
  (`CH.pastSessionResumeTerminal`, the launch override's `lastSessionId`) and runs the Open
  checks; the renderer opens the new terminal, then forgets the dead one (`resumeDeadTerminal`).
  A refusal is mapped copy on the pane's own line. The plain-shell `#terminals` view has no Resume.

## Feedback — every action says what happened

Spec `2026-09-29-action-feedback-design.md`. Every operator action ends in a visible result — a
mapped success or failure — and no action can run twice by accident.

**Where feedback lands (the placement rule):**

1. **Inside a dialog** → the dialog's own surfaces: the ONE error line (`ManageDialog.Error`) for a
   failure; the row the save selected, or Settings' `✓ Saved` mark, for success. **A dialog never
   raises a toast for its own result.** (The Delete confirm and the Quit guard have no error line, so they report a refusal with a toast.)
2. **A small action on a control that stays on screen** (Copy, Reload themes, Regenerate) → the
   button's own `feedback` result for 1.5 s (`✓ Copied`, shown through `feedbackShown`).
3. **A board-level action, or a result off screen** (archive, move, a menu that closed, a failure
   with no dialog to hold it) → a toast.

Copy is always mapped from a CODE (matched with `includes` — Electron wraps an invoke rejection);
a thrown `error.message` is never rendered. The check mark `✓` is neutral ink (`--text-primary` /
`--text-secondary`); a failure uses `--danger`. There is no `--success` token.

- **Toasts are `stores/toastStore.ts` + `components/Toaster/`.** Push with `toast.success` /
  `toast.error` / `toast.info`. `<Toaster />` is mounted ONCE in `App.tsx`, outside the subtree that
  goes `inert` under a modal, so ✕ works over a dialog. At most 3 on screen (a 4th drops the
  oldest); success/info close after 5 s, 6 s with an action; an error stays until dismissed; hover
  or focus inside a toast pauses its timer. Bottom-right, `--space-4` gutter, `z-index: 70` (above
  the dialogs' 60, below the terminal context menu's 1000). Anatomy: glyph (`✓` / `!` in `--danger`
  / `i`), title, one optional `detail` line, one optional action (`Button secondary sm`), ✕ (`Button
ghost xs icon`, `aria-label="Dismiss"`). Success/info are `role="status"`, an error
  `role="alert"`, inside `<section aria-label="Notifications">`. Themes target `[data-toast]` and
  `[data-toast-kind]`, never a test id.
- **A toast's action is not rendered while a modal is open** (`modalOpenIn`, the single-modal rule —
  not rendered, never refused). ✕ and the timer are unaffected.
- **An action runs once and owns its errors.** The toast closes when `run` is called; the store
  never awaits it and contains a throw or rejection silently (nothing reaches the click handler),
  so a `run` that can fail maps its code and pushes its own error toast (the archive toast's
  `Resume` does).
- **A workspace named in a toast is a `WorkspaceLabel`** — pass `workspace: { name, tone }`, never
  the name in the title.
- **`Button` has `feedback`, `feedbackShown` and `busy`.** `feedback` is the CONSTANT result text
  (`✓ Copied`); while it is set, the label and the result are ALWAYS both in one grid cell (the one
  not shown is `visibility: hidden`), so the button is max(label, result) wide from the first paint
  and never changes width. `feedbackShown` picks the visible layer, and a hidden `role="status"`
  sibling carries `feedbackShown ? feedback : ''`. Pattern: `const [copied, flashCopied] =
useFlash<true>()` → `feedback="✓ Copied" feedbackShown={copied !== null}`. Tests read the result
  from that status sibling, never from the button's `textContent` (it always holds both layers).
  `busy` = `disabled` + `aria-busy`. `ManageDialog.GhostButton` / `Save` / `Delete` forward all
  three; a busy `Delete` keeps its armed look and ignores blur and clicks. `useFlash()` (1.5 s)
  drives `feedbackShown` and the `✓ Saved` mark.
- **Every async button uses `useAsyncAction` or a `busy` flag.** `useAsyncAction(fn)` → `{ run,
busy }`: a call while one is in flight starts nothing. It is what stops a second Regenerate, a
  double-Enter save, and a second native folder picker.
- **Every `void window.<a>.<b>(…)` ends in `.catch(`** (after any `.then` links) — guarded by
  `lib/bridgeCatch.test.ts`. The guard cannot see `void <wrapper>()`, so a wrapper that can fail
  either rethrows a code its caller maps, or reports itself.
- **Settings** shows `✓ Saved` beside the pane heading for 1.5 s after a change main stored. A
  refused change rolls the control back to main's last answer (`persistSettingsPatch` rejects with
  `settings_persist_failed` after re-hydrating from `authoritative`) and the error line says
  `Could not save <setting>.` until the next change that lands.
- **The name prompt stays open while main answers** (`lib/namePromptFlow.ts`): the confirm is busy
  (`Starting…` / `Renaming…`), a refusal keeps the typed name and shows mapped copy on its error
  line (`folder_missing`, `claude_version`, `template_not_found`). A launch that has not answered in
  15 s closes the prompt with a `Still starting "<name>"…` toast. A result that lands after the
  prompt closed never takes the view: a success is registered (registry only) and toasted with
  `Open`; a failure is an error toast.
- **Archive and Delete wait for main.** The view goes to the board at once, the terminal registry
  only after main answered, so a refused exit keeps the terminal and says so. A kept archive toasts
  `Archived "<name>"` with `Resume` (the Past sessions Open path, offered only once the record
  exists and only with a bound session id).
- **A startup load that fails** is ONE error toast naming every store (`Could not load templates,
tags and rules. Reopen the app to try again.`), and each Manage dialog says `Could not load <x>.`
  in place of its empty sentence.

## A native `<select>` is BANNED. Use `components/Select/Select.tsx`.

Every dropdown in this app is that component. Not "prefer" — there is no case where a native
`<select>` is acceptable here, and `eslint`/review should treat one as a defect.

Why, with the receipts: on Linux, Chromium draws a `<select>`'s popup list from the DESKTOP's GTK
theme, not from the page. On a light desktop it drops a white list with a blue highlight on top of
this dark app. Three fixes were tried and all three failed — styling the `<select>` and its
`<option>`s, `:root { color-scheme: dark }` in `main.css`, and
`nativeTheme.themeSource = 'dark'` in the main process. The popup stayed light through all of
them. A popup we render ourselves is the only one we can style. (`nativeTheme.themeSource = 'dark'`
in the main process was KEPT — it still fixes Chromium's other surfaces, scrollbars included, it
just never reaches that popup. Changed 2026-09-20 — this bullet used to say the fixed
`:root { color-scheme: dark }` in `main.css` was kept too; that declaration is GONE. Custom themes
(`src/main/themes/`) can be light, so a color-scheme fixed to `dark` would pin a light theme's page
to dark scrollbars/form controls. `hooks/useApplyTheme.ts` now sets
`documentElement.style.colorScheme` from the APPLIED theme's own `colorScheme` on every apply, and
`nativeTheme.themeSource` is re-set the same way by `themeLifecycle` — the `'dark'` in `index.ts` is
only the value before the first apply.)

What the component owes you, because a native select gave it for free:

- `role="listbox"` on the popup, `role="option"` + `aria-selected` on every row, `aria-haspopup`
  and `aria-expanded` on the trigger, and an `ariaLabel` (a `<label for>` cannot address a
  button, so the visible label beside it is a `<span>`, not a `<label>`).
- Keyboard: ArrowDown/ArrowUp open it; opening focuses the CURRENT row so the arrows start where
  the operator already is; arrows wrap; Home/End jump; Escape closes and returns focus to the
  trigger **and stops propagating** (UX-DR14 — these live inside modal dialogs whose own Escape
  would otherwise close the dialog out from under someone dismissing a list).
- Mousedown outside closes it.
- The trigger mirrors the chosen value on `data-value`, and each row on
  `data-testid="<testId>-option-<value>"`. Tests drive it through
  `src/renderer/src/test/selectHarness.ts` (`chooseOption` / `selectedValue` / `optionValues`) —
  there is no `.value` to set and no `change` event to fire.
- Options can carry an `adornment` (the Tags dialog's colour preview) or a `display` that replaces
  the label text (a workspace name in its tint) — something a native `<option>` can never do.

A sentinel option value is a WORD (`'global'`), never `''`: it becomes part of the option's
testid, and `template-scope-option-` with nothing after it is not a name anyone can read.

## A text field is `components/TextInput/TextInput.tsx`. Never a bare `<input type="text">`.

Five dialogs had each grown their own `.input` rule in their own CSS module, and by the time they
were collected they had already drifted: two backgrounds (`--bg-surface` in three,
`--bg-base` in one), a `::placeholder` color in exactly one of the five, and a focus treatment
that changed the border in one and not the others. Nobody chose any of that. It happened because
copying eleven CSS lines into the next dialog is easier than importing a component.

It is also how the fields broke: deleting the retired `.select` rule took the `.input` selector
that shared its rule block with it, and the Name and Search fields silently fell back to
**Chromium's own dark-scheme input** — a different border, a different focus ring, a different
placeholder. Nothing failed. It only showed up in a screenshot.

So: every single-line text field in the app is `<TextInput>`.

- It renders the **field only**. The `<label>`, the helper line and the error line stay at the
  call site — their layout differs per dialog, and the error line is one-per-dialog by rule.
- Name it: `id` when a `<label htmlFor>` sits above it, `ariaLabel` when nothing does (a search
  box in a rail, the custom-model box beside the Model dropdown). One or the other, always.
- `onChange` hands over the **string**, not the event. A call site never touches `e.target.value`.
- `inputRef` is for focus-on-open only. Whoever opens the surface owns the focus, not the field.
- `invalid` sets `aria-invalid` and reddens the border. It is never the only signal — the
  dialog's own error line says what is wrong (UX-DR29).
- Placeholders are `--text-secondary` (6.08:1 on `--bg-surface`), not `--text-muted` (2.85:1) and
  not `--text-dim`. A placeholder is sometimes the only copy a field carries.
- The box is deliberately identical to `Select`'s `field` variant, so a text field and a dropdown
  standing in the same form column are the same shape and the same height. Change one, change
  both.

`TextInput.test.tsx` guards this structurally: it walks every `*.module.css` under `components/`
and fails if any module other than `TextInput`'s declares an `.input`, `.search` or `.textField`
class. The next copy-paste turns it red before a screenshot has to.

Checkboxes, radios and ranges are still bare `<input>` — they are not text fields and they do not
share this box.

## A button is `components/Button/Button.tsx`. Never a bare `<button className=…>`.

Nine button looks had grown across the renderer and most were copies: the raised header button
pasted into four modules, the dialog Cancel/Confirm pair into three, the quiet outlined ☰ / ⚙ / ✕
into four with three different borders. None of them set a height, so the label sat on
`padding: 4px 12px` and looked squeezed. The operator's own mock (2026-09-23) had the buttons at a
fixed height with room around the text, and that is what Button draws.

- **Four variants.** `primary` is the ONE main action of a surface (`+ New session`, Save) and the
  only filled-with-accent button. `secondary` is every other outlined control (☰, Back, Cancel,
  Filter). `danger` is red at rest and fills when `armed` (the Delete contract above). `ghost` is
  borderless: the icon buttons on cards, rail rows and dialog headers. There is no fifth; a look
  that is not one of these is a design question, not a new class.
- **Three sizes, all FIXED heights.** `md` 32px (the header, the filter bar, dialog footers — the
  same height as TextInput's `toolbar` box), `sm` 26px (pills, the rail's controls), `xs` 20px (the
  icon buttons inside a card or a rail row). `icon` makes a square of that height.
- **`lit` is the ON state of a toggle** (`--text-primary` fill, `--text-on-lit` ink): the Filter
  button while its row is open or a filter is on, an open rail peek. It is a boolean `data-lit`
  attribute, present only while on — a test checks `hasAttribute`, never `=== 'true'`.
- **It has no `className`.** Layout — a footer's `flex-end`, `+ New`'s `margin-top: auto`, a
  card's reveal-on-hover — goes on a WRAPPER at the call site. The moment a button takes a class
  from its caller, the copies this replaced come back through it.
- **Refs go through `buttonRef`**; whoever opens a popover owns the refocus, not the button.
- **The workspace switcher's menu lists only the OTHER workspaces.** The button already names the
  active one with its counts; listing it again read as a duplicate (operator, 2026-09-28). With no
  other workspace the menu is `Manage workspaces…` alone, with no divider.
- **The workspace switcher is not a Button.** It is a compound pill (its workspace tint, name,
  counts, the "elsewhere" tab) with its own glass in the liquid-glass theme; it only matches Button's `md`
  height.
- **The dashed pills** (`+ Add filter`, `+ tag`) and the menu / list popup rows (AppMenu items,
  Select options) are not buttons in this sense: they are `Popover` rows, and `components/Popover`
  owns their look. ManageDialog row selects keep their own rules.

`Button.test.tsx` walks every `*.module.css` under `src/renderer/src` and fails if any module other
than Button declares a button class (`.button`, `.primaryButton`, `.cancelButton`, `.closeButton`,
…). The next copy-paste turns it red before a screenshot has to.

## A popover is `components/Popover`. Never a hand-made menu box or row.

Ten popovers (the workspace menu, ☰ and its submenu, `+ New session`, Select, the tag lists, the
shortcut expander, the starting list, the card's move menu, the terminal's context menu) each drew
their own box and rows, and they had drifted: three selected looks, two radii, two paddings. A theme
reached the boxes by role and test id and the rows not at all, so liquid-glass could not make the
rows glass (operator, 2026-10-01). Spec `2026-10-01-popover-standard-design.md`.

- **Parts** (`import { Popover } from '../Popover/Popover'`): `Surface` (the box — never scrolls,
  a submenu sits inside it), `List` (the rows; the ONLY scrolling part, capped by
  `--popover-max-height` on the caller's wrapper), `Item`, `CompactItem`, `QuietItem` (explicit
  variants, not booleans), `ItemIcon`, `ItemEnd`, `Divider`, `Note`.
- **It draws, it does not behave.** Roles, ARIA state, keys, open/close and POSITION stay with the
  caller: a positioned wrapper at the call site, `Popover.Surface` inside it. No part takes a
  `className`.
- **Row states are read from ARIA** — `aria-selected`, `aria-checked`, `aria-expanded` — plus
  `active` (→ `data-active`) for a highlight that does not follow focus. A visible state never
  disagrees with the accessible one.
- **`tone`** tints a row with its workspace (WorkspaceTint), and stamps `data-tone`.
- **Themes target** `[data-popover]`, `[data-popover-list]`, `[data-popover-item]` (+
  `[data-density='compact']`, `[data-quiet]`, `[data-tone]`), `[data-popover-divider]` and the ARIA
  states — never a test id. A new popover built from these parts is themed with no theme change.
- **The guard** (`Popover.guard.test.ts`): a raw element with a menu / list role outside Popover,
  or a CSS module drawing a popover box (`--shadow-pop`), turns it red.

## A note on testing CSS classes

`vitest.config.ts` sets no `css` option, so `import styles from './X.module.css'` resolves to a
proxy that returns a string for **every** key. `expect(styles[color]).toBeTruthy()` therefore
passes even when the stylesheet is empty — a completeness check written that way is vacuous (one
was, and it stayed green after its classes were deleted). Read the stylesheet with `readFileSync`
and assert on its text instead.

## Don't

- Don't put a per-row action anywhere but `ManageDialog.RowActions`, and never one the form
  already has.
- Don't write `<input type="text">` or a `.input` CSS rule. That is `<TextInput>`.
- Don't write `<button className=…>` or a button CSS rule. Every button is
  `components/Button/Button.tsx` (below). In a Manage dialog render `ManageDialog.Save` /
  `GhostButton` / `Delete`, which are thin wrappers over it.
- Don't reach for a native `<select>`, `alert()`, `confirm()`, or any other browser-drawn widget
  with a popup. They are painted by the platform and cannot be themed.
- Don't hard-code a color that a token already names (`--danger`, `--working`,
  `--border-strong`, `--text-*`). The workspace tints are tokens too
  (`--workspace-<color>-{fill,border}`).
- Don't draw a workspace as a dot, and don't render a tinted workspace without `WorkspaceTint` —
  never a copy of its colours in another module.
- Don't group a scoped list into sections. The dropdown narrows it; the form names the scope.
- Don't assert UI text by searching the container's `textContent` for a workspace name — the
  scope dropdown's own `<option>` labels contain every one of them, so such an assertion passes
  whether or not the thing you meant to check rendered. Query a `data-testid`, or assert on
  structure (row count vs container child count).
- Don't draw a menu or list popup by hand (a `role="menu"`/`listbox` element, a `--shadow-pop` box, a row class). That is `components/Popover`.
- Don't reach for a new dialog shell. A Manage dialog is `ManageDialog.Frame`: `z-index: 60`,
  single-modal (App.tsx `isModalOpen()` guards it against the other modals — a new dialog
  adds its open flag to `isDialogOpen()` there), and Escape-closable. The Delete confirm and the
  Quit guard count as modals too (R9): no opener fires over them, the page behind is `inert`, and
  the Quit guard closes an open Delete confirm.
