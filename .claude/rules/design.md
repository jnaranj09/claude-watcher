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
        <ManageDialog.New testId="template-new" /> {/* bottom of the rail */}
      </ManageDialog.List>
      <ManageDialog.Form onSubmit={submit}>
        …fields…
        <ManageDialog.Footer>
          {/* flex, justify-content: flex-end */}
          <ManageDialog.Delete testId="template-delete" onConfirm={remove} />
          <ManageDialog.Save testId="template-save" disabled={!canSave} />
        </ManageDialog.Footer>
      </ManageDialog.Form>
    </ManageDialog.Columns>
    <ManageDialog.Error testId="template-error" />
  </ManageDialog.Frame>
</ManageDialog.Provider>
```

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
  `Delete` → `Confirm delete`; the class goes `.deleteButton` → `.dangerButton`. Blur
  disarms it, and Escape disarms it and STOPS THERE (it must not also close the dialog —
  Escape peels one layer). Never a second Cancel/Confirm pair: it adds a control, moves
  the layout, and buries the primary action.
- **Delete is red at rest, filled on hover/focus.** `.deleteButton` = `--danger` border
  and text on a transparent background; `:hover`/`:focus-visible` fills `--danger` with
  white text. `.dangerButton` (solid `--danger`) is the ARMED state only, so arming
  reads as the same button changing, not a new one appearing. Both classes live in
  `ManageDialog.module.css` and nowhere else: render `<ManageDialog.Delete>`, which owns
  the arm / blur / Escape behaviour once. `ManageDialog.styles.test.ts` fails if any other
  module declares either class.
- **One error line per dialog**, `role="alert"`, shared by every flow in it. Never a
  second error surface per section, and never render a thrown `error.message` — map the
  code to operator copy first (see the `copyFor`/`templateErrorMessage` precedent).
- **Every interactive control gets `:focus-visible`** in the module's shared outline
  group. Adding a button class means adding it to that selector list too.
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
- **The swatch sits inside the control, and on every row.** The trigger shows the selected
  scope's dot; each option in the list carries its own. This is `Select`'s `adornment`, and it is
  one of the reasons the native control had to go.

## Naming a workspace in the UI

`components/WorkspaceDot/WorkspaceDot.tsx` is the ONE swatch that stands for a workspace
anywhere in the app — the header switcher, the Workspaces dialog rows, its color picker, the
scope dropdown.

- **`tone` is a flat union**: a `WorkspaceColor`, `'global'` (hollow ring), or `'orphan'` (dim
  disc). A caller cannot pass a color for Global or forget the color for a real workspace. The
  six color classes live in `WorkspaceDot.module.css` and nowhere else.
- **The dot is never the only cue.** A name is always beside it, and the two non-workspace tones
  differ by SHAPE (ring vs disc), so they survive greyscale and color blindness.
- **Any operator-typed name truncates and keeps a `title`.** Workspace names are unbounded (a
  domain like `docs.example.app` overflows a rail a short name fits): `overflow:hidden` +
  `text-overflow:ellipsis` + `white-space:nowrap`, `min-width:0` on the flex parent or the
  ellipsis never engages, and `title` so the full value stays reachable.
- **Text on a raised panel is `--text-secondary`, never `--text-muted`.** Muted `#6b685e` on the
  dialog panel `#2c2b27` measures **2.54:1** — under the 4.5:1 body floor and under even the
  3:1 large-text floor. Secondary measures 5.41:1. `--text-muted` is for text on `--bg-base`.

## Naming a tag in the UI

`components/TagChip/TagChip.tsx` is the ONE drawing of a tag's name — board card footers, rail rows
(peek and "Show all tags"), the tag filter, the `Tags…` picker and the Tags dialog.
`components/TagIndicator/TagIndicator.tsx` is its compact form, used only by the rail's default view.

- **A tag is a label pill, never a dot.** A rounded rectangle with a tinted fill and the name in it.
  The workspace dot and the status dot are circles; the rail's tag indicator is a tag OUTLINE.
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
- **A tag name truncates and keeps its `title`**, like every operator-typed name.
- **A trigger that opens `TagPicker` uses `aria-expanded` + `aria-controls`** (pointed at the
  picker's own id), **never `aria-haspopup`** — the popup is a checkbox `group`, not a menu.
- **A card and an untagged rail row can always reach tagging, even before a tag exists.** With no
  tag to offer, the same button (`Create tags`) opens the Tags dialog instead of an empty picker,
  so it carries `aria-haspopup="dialog"` and no `aria-expanded`. It is hidden only when there is
  no Tags dialog to open.

## The board's filter bar

`components/FilterBar/FilterBar.tsx` is the ONE place the board is filtered. It sits above the
columns, never in the header: a header button reading "All tags" did not read as a filter.

- **It says what it is.** A filter toggle, the active filter as a pill (`Tag is <chip>`: click it
  to change the tag, `×` to remove it), `+ Add filter` while none is on, and the count on the right
  (`5 sessions`, or `3 shown · 2 hidden by the filter`).
- **The toggle is an ICON, never the word, in the header ☰ button's box.** An uppercase `FILTERS`
  label was tried first and read as bad UI; then a 22px funnel + `▾` read as too small. It is the
  "filter list" icon (three lines getting shorter) in the ☰ button's exact box: 26px tall, a 16px
  icon on the ☰ icon's grid and stroke, `--border`, `--rounded-md` — and ≥ 24px, the WCAG 2.2
  target minimum. Named `Filters` by its `aria-label`, titled `Show filters` / `Hide filters`.
  A stylesheet test in `FilterBar.test.tsx` pins the box.
- **No chevron: open reads as PRESSED** (`--bg-surface-raised` fill, `--border-strong`).
- **It starts COLLAPSED to that toggle** — a 28px row instead of the 38px bar, so it costs the board
  less height until it is used. The toggle opens the bar in place and stays at its left; collapsing
  closes an open list. Open/closed is not persisted.
- **It sits tight: 8px under the header, 8px above the columns** (not the 16px gutter either side,
  which read as a gap around the toggle). The grid trims its top padding only while the bar draws
  (`Board.module.css` `.filterSlot`). Never pull the grid up with a negative margin: its box would
  cover the lower part of the toggle and take its clicks.
- **Collapsed with a filter on, the toggle LIGHTS UP** — `--text-primary` fill, `--bg-base` ink,
  the count inside (named `Filters, 1 on`). The loudest thing on the board's edge, on purpose: cards
  are hidden and the pill that says so is out of sight. (A corner count badge was the quieter
  option; the operator chose this one.)
- **Tag is the only filter type, so `+ Add filter` opens the tag list directly.** Add a type step
  (`Tag ▸`, `Status ▸`) only once a second filter type exists.
- **One tag at a time.** While a tag filter is on, the pill is where it changes, and `+ Add filter`
  is not rendered.
- **It draws only when the workspace has sessions**, and it stays when the filter hides them all,
  so the operator removes the filter right where they see the empty board.
- **No tag yet:** the list offers `Create tags…` (the Tags dialog), never an empty popup.

## The header ☰ menu

`components/AppMenu/AppMenu.tsx` is the ONE header control besides `+ New session`. It replaced three
icon buttons (⚙ settings, ⌨ shortcuts, the tag icon) and it filters nothing.

- **Rows, in this order:** `Settings…`, `Shortcuts…`, then `Tags` — a SUBMENU holding
  `Manage tags…` / `Manage rules…`. The tag rows stay grouped under `Tags`; do not flatten them
  into the top level.
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

## A native `<select>` is BANNED. Use `components/Select/Select.tsx`.

Every dropdown in this app is that component. Not "prefer" — there is no case where a native
`<select>` is acceptable here, and `eslint`/review should treat one as a defect.

Why, with the receipts: on Linux, Chromium draws a `<select>`'s popup list from the DESKTOP's GTK
theme, not from the page. On a light desktop it drops a white list with a blue highlight on top of
this dark app. Three fixes were tried and all three failed — styling the `<select>` and its
`<option>`s, `:root { color-scheme: dark }` in `main.css`, and
`nativeTheme.themeSource = 'dark'` in the main process. The popup stayed light through all of
them. A popup we render ourselves is the only one we can style. (Both the `color-scheme` and
`themeSource` declarations were KEPT — they do fix Chromium's other surfaces, scrollbars included
— they just never reach that popup.)

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
- Options can carry an `adornment`, which is how every scope dropdown shows its workspace swatch
  on every row — something a native `<option>` can never do.

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
- Don't introduce a fourth button style. There are three: `primaryButton`,
  `ghostButton`, `deleteButton` (+ its armed `dangerButton`) — all in
  `ManageDialog.module.css`; render `ManageDialog.Save` / `GhostButton` / `Delete`.
- Don't reach for a native `<select>`, `alert()`, `confirm()`, or any other browser-drawn widget
  with a popup. They are painted by the platform and cannot be themed.
- Don't hard-code a color that a token already names (`--danger`, `--working`,
  `--border-strong`, `--text-*`). The workspace dot colors are the ONE exception, and
  they are documented as such at their definition.
- Don't render a workspace as bare text, and don't copy the dot CSS into another module.
- Don't group a scoped list into sections. The dropdown narrows it; the form names the scope.
- Don't assert UI text by searching the container's `textContent` for a workspace name — the
  scope dropdown's own `<option>` labels contain every one of them, so such an assertion passes
  whether or not the thing you meant to check rendered. Query a `data-testid`, or assert on
  structure (row count vs container child count).
- Don't reach for a new dialog shell. A Manage dialog is `ManageDialog.Frame`: `z-index: 60`,
  single-modal (App.tsx `isModalOpen()` guards it against the other modals — a new dialog
  adds its open flag there), and Escape-closable.
