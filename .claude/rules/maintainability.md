---
paths:
  - 'src/**'
  - 'tests/**'
  - 'docs/**'
  - '*.md'
  - 'package.json'
  - '.claude/**'
  - 'eslint-rules/**'
---

# Rule: maintainability (seven rules every change keeps)

Every change keeps these rules. Each one has an enforcement block below: **landed** (its guard
exists) or **planned** (_to write_, lands with its migration step).

## The rules

1. **One owner per shared value.** A value that two places must agree on (changing one without
   the other is a bug) is defined once, and a guard fails on the raw copy elsewhere. Where one
   side cannot import the other (CSS and TS), it is written twice and a rule-2 test pins the pair
   (`MOTION_EXIT_MS` and `--motion-exit`). Shared values include a stacking rung, a control or row
   height, a radius, a colour, a default port, the set of modals and the overlay hooks; the list
   is not closed. A value that is only _equal_ by chance goes on an allow-list with a reason,
   never onto the token.
2. **Every cross-file contract has a drift test that reads both sides.** A contract is anything
   one file must match in another that the type checker cannot see: a selector, a `data-*` name,
   a channel, a `code=` token, a wire string, or a list that one side mirrors (what a cascade
   deletes).
3. **An IPC refusal is a registered code.** A refusal is a rejection main sends for the renderer
   to show, including a schema check whose `error:` code the renderer maps (`prompt_invalid`);
   any other failed argument parse is a bug, not a refusal. Main throws it through one factory,
   the renderer reads it through one helper, and copy maps from the code, never from the message.
4. **When three or more call sites carry the same obligation, one helper carries it and a guard
   keeps them on it.** An obligation is a step every caller must take to be correct (run inside
   `guarded`, validate before sending, clear the old error first). This never applies to
   look-alikes, and such a helper never serves one caller. A seam moved out for testing
   (`hooks/renameLaunched.ts`) or a named `as` helper (technical-taste §5b-9) is a different kind
   of helper and may have one caller.
5. **Nothing stale survives the change that made it stale.** A dead path (no shipped code reaches
   it, and no comment says a test keeps it on purpose) is deleted. Run `npm run find-name --
<name>…` for every name the change renames, moves, removes or redefines (a bare `rg` misses
   most of what it finds; `tests/tools/findName.mjs` says why, and `tests/main/findName.test.ts`
   pins every place it must reach). Fix every comment and living-doc line the change makes false
   in the same commit, including a line that describes the old behaviour without naming anything:
   run `find-name` on the old behaviour's words too (the old value, default, key or copy: `9281`,
   `off by default`, `Ctrl+Alt+X`), and read the living-doc section that owns the feature.
   Living docs are the tracked guidance files (CLAUDE.md, AGENTS.md, `.claude/rules/`,
   technical-taste.md, `docs/themes/THEMES.md`, README.md; the list is not closed). Dated records
   (specs, plans, reviews, incident notes), tracked or not, are history: their body is not
   rewritten, but one the change makes false gets a dated "Superseded: <what changed>, see
   <commit or living doc>" line at its top (on disk only when untracked; never `git add`).
   `.superpowers/` is scratch, not a record, so no comment cites it. Docs name things, not counts
   or line numbers, unless a test pins the number.
6. **A failure is never silent: not in the app, not in the gate.** A failure of what the operator
   asked for (a click, a key, an API call) or of their data reaches a surface they see (a Callout,
   a toast, a notice, an HTTP status; a log is not a surface), and its caller sees a failure,
   never a success. A change kept in memory while a notice reports the disk (CLAUDE.md
   `persistOrReport()`) is a success. When no surface is left (quit, window close), a `code=` log
   is the floor and nothing throws (`code=teardown_archive_failed`). A failure handed back as a
   value the caller can tell from every real result (`{ ok: false, code }`, a `null` that means
   nothing else) is not contained; its caller owns it. Any other contained failure, including one
   that passes for a real result (`[]`, a default, a `null` that also means "none"), logs a
   `code=` where it was caught. A yes/no or match check whose throw is its answer (`statSync` on a
   folder that may not exist → `false`) has not failed. A drop with no log is allowed only on a
   list that only shrinks (`catchBlocks.guard.test.ts`, the quiet rows of `zod-boundaries.md` and
   its transcript tail). A guard, or a test written for a fix, that stays green when the code it
   protects is broken is not a guard.
7. **A leaving overlay is not there.** An overlay is a dialog, a popover (menus included) or a
   toast; in this rule, a dialog is any element with `role="dialog"` or `role="alertdialog"` (so the
   `+ New session` popover counts as one). A DOM question "is an overlay open" or "does a dialog
   hold focus" excludes `data-leaving` through that question's one shared selector; focus stays a
   dialog-only question (CLAUDE.md "Focused-view keys"). A store question (`lib/modals.ts`) needs
   no selector. Painting still counts a leaving overlay.

_Conditional (spike first):_ themes win by cascade layer instead of specificity hacks, but only
if the spike shows themes need not restate every app state. Until then, today's theme selectors
stand.

Until a rule's guard lands (its enforcement block below is still marked planned), follow the principle
the way the closest existing sibling does (technical-taste §0, house pattern), and do not build
the rule's own factory, helper, token or hook outside its migration step. For rule 3 this means a
new refusal code goes into the surface's existing copy map, which still matches the code inside
the message.

## Enforcement

**How to read this part.** Each block or bullet is **landed** (the guard, test or tool it names
exists today) or **planned** (_to write_). The rule file carries both, the planned ones with
their _(to write)_ marks; a planned block is what the closing paragraph of the rules above calls a guard that
has not landed. A block's **migration step** is a one-time change that moves today's code onto
the rule and lands the planned guard in the same commit, dropping the block's _(to write)_ marks.
Until it lands, do what the closest sibling does, and do not build the planned helper, token or
hook outside its migration step. The guard must go red when the rule is broken and stay green on
the migrated code.

**Where a planned guard lives.** Vitest runs `src/**` and `tests/unit/**` (`*.test.tsx` too), split
by environment: `src/shared/**`, `src/__fixtures__/**` and `tests/unit/**` run under node (the
`shared-node` project), `src/main/**` and `tests/main/**` under node (the `main-unit` project), and
the rest of `src/**` under jsdom (the `unit` project). A planned guard test goes under `tests/main/`
or `tests/unit/` (node, named `*.test.ts`: a `*.test.tsx` there would run under jsdom), or under
`src/renderer/**` (jsdom) when it needs the DOM, never beside a harness in `tests/drive/`,
`tests/e2e/` or `tests/tools/`, where it would never
run. A guard that walks files also fails when its walk finds no files.

**Non-test files.** Landed walks each read their own set, and keep it until a change rewrites
them. `catchBlocks.guard.test.ts` uses `sourceFiles()` in `tests/main/sourceScan.ts`: all of
`src/`, with no `*.test.*` file, nothing under a `test/` or `__fixtures__` folder, and no `.d.ts`.
`noHexLiterals.test.ts` (CSS, TS and TSX), `bridgeCatch.test.ts` (TS and TSX) and
`Popover.guard.test.ts` (TSX and `*.module.css`) walk `src/renderer/src` and skip only `*.test.*`
files, so they also read `src/renderer/src/test/`; `noHexLiterals` and `bridgeCatch` also read
`.d.ts` files. `spacing.guard.test.ts` reads
every `*.module.css` under `src/renderer/src`. Planned walks share one meaning of "non-test": the
skips of `sourceFiles()` (no `*.test.*` file, nothing under a `test/` folder, so not the helpers
in `src/renderer/src/test/`, nothing under `__fixtures__`), with `.d.ts` files read
(`sourceFiles({ declarations: true })`). A planned walk that also reads CSS or `.mjs` files skips
the same paths. A bullet below that widens this says so.

**Scope of raw-value walks.** Unless a bullet below widens it, a walk reads app source only:
non-test files under `src/renderer/src`. It also skips the files `noHexLiterals.test.ts`
allows: `styles/tokens.css`, `styles/xtermTheme.ts` and `SmokeCockpit.tsx`. The bundled theme
CSS (`docs/themes/examples/`) is outside that root. A walk that reads CSS only does not see a TSX
inline style (`style={{ zIndex: 60 }}`); a raw copy of a token value there is a review item.

**Comments.** Every planned walk that matches code reads it with its comments removed. These planned
guards read comments on purpose, through the parser's comment ranges: the scratch-citation guard
(rule 5), which fails on a comment, and the `.catch`-arm check (rule 6), which must tell a
comment-only arm from an empty one. A TS or TSX walk that matches code parses the
file with the TypeScript parser (`ts.createSourceFile`, as `tests/main/sourceScan.ts` does) and
matches nodes, so a comment is never seen and a comment marker inside a string cannot hide code.
In a TSX file, do not strip comments with the bare TypeScript scanner: it does not know JSX text,
so a `//` in JSX text (`http://`) eats the code after it. A `.mjs` walk may use the parser or the
scanner. A CSS walk removes `/* … */` comments before it matches. Do not copy `stripComments` from
`noHexLiterals.test.ts`: it does not see strings or `//` lines, so a `/*` there would eat real code
up to the next `*/`, and it keeps a `//` comment at the end of a code line. `env.d.ts` already
holds a `/*` inside a `//` line, with no `*/` after it.

Landed walks today:

- `catchBlocks.guard.test.ts` parses with `sourceScan.ts`. The comment inside a `catch` is what it
  counts, on purpose.
- `Popover.guard.test.ts`: the menu-role check parses JSX, so comments do not reach it. The
  `--shadow-pop` check reads raw CSS text, so a comment can only add a hit. Known weakness: the
  `leavingProps` check reads raw text, and a caller whose only `leavingProps(` sits in a comment
  passes. Planned _(to write)_: that check parses the file and picks its `Popover.Surface` callers by
  JSX element, keeps its listed extra and exempt files, and requires a `leavingProps(…)` call node
  in each, and its non-vacuity test adds a probe whose only
  `leavingProps(` is in a comment.
- `bridgeCatch.test.ts` reads raw text. Its match needs `.catch(`, or a two-argument `.then`,
  after the call's `.then` links, so a comment can make it flag correct code; no case tried lets a comment hide a hit.
- `spacing.guard.test.ts` reads raw CSS text. Known weakness: a `;` inside a comment in a value
  (`padding: /* x; */ 4px;`) ends the match early and hides the raw length. Planned: it removes
  `/* … */` comments before it matches.
- `noHexLiterals.test.ts` uses the flawed `stripComments` above. Planned: it follows these rules
  (the parser for its TS and TSX files, block comments for its CSS). Its file set does not change:
  it keeps reading `env.d.ts`.

**1 — one owner per shared value**

- **Tokens live in `tokens.ts` and `tokens.css`.** Landed: `TOKENS` in `src/shared/theme/tokens.ts` and
  `styles/tokens.css` hold the same set, and `styles/tokens.test.ts` fails when one has a key the
  other lacks, or a value differs. A new radius or height token goes in both, then `npm run gen:theme-docs`. Every
  `TOKENS` key is themeable. Planned: the `--z-*` rungs are not themeable, because
  stacking order is app behaviour, not look. They follow the landed sibling `styles/motion.css`
  (non-theme custom properties in their own `:root`, imported from `assets/main.css`, pinned by
  `motion.test.ts`): the rungs go in `styles/stacking.css` _(to write)_, imported from
  `assets/main.css`, with a header that says they are not theme tokens on purpose. `tokens.css`
  stays 1:1 with `TOKENS`. The stacking order test reads `stacking.css`, owns the rungs and pins
  the import.
- **Colours.** Landed: `src/renderer/src/styles/noHexLiterals.test.ts` fails on a hex literal.
  Planned: it also fails on `rgb(`, `rgba(`, `hsl(`, `hsla(`, `oklch(`, `oklab(`, `lab(` and
  `lch(`. `color-mix()` passes only when every colour in it is a `var()`, `transparent` or
  `currentColor`; `transparent` and `currentColor` pass anywhere. Named colours (`black`, `white`) are not
  walked: a mask's `black` is alpha, not a colour (`ManageDialog.module.css`). Today's raw
  `rgba(` in `Board.module.css` and `QuitGuard.module.css` move to tokens first.
- **Spacing.** Landed: `src/renderer/src/styles/spacing.guard.test.ts`. Its allow-list gives a
  reason for each entry; every new walk's allow-list copies that shape.
- **Radii.** Planned: a walk over `border-radius` (and its corner forms) in CSS files fails on any
  raw length or percentage other than `0`; a TSX inline style is not walked. Its non-vacuity probe
  holds a `50%`. `999px` and `9999px` become `--rounded-full`. `50%` becomes `--rounded-full`
  only on a square box (`Button.module.css` `.round`); on a box that is not square, `50%` draws
  an ellipse, so it goes on the allow-list with that reason.
- **Heights.** Planned: tokens _(to write)_ `--control-md` (32px), `--control-sm` (28px),
  `--control-xs` (20px), `--row` (36px), `--row-active` (40px), `--rail-square` (the collapsed
  rail's row, 40px) and `--rail-square-active` (its active starting row, 44px). A height token's
  value is a shared value wherever it is used: a raw copy of it in a width, a padding, a
  `scroll-padding`, a custom property or a `calc()` is a rule-1 copy, owned by the token. So the
  walk reads every declaration in the CSS files, custom properties included, except `font-size`
  and `line-height` (type sizes, not boxes). It fails on a raw length equal to one of those
  tokens' values, inside a `calc()` too (`calc(32px + …)` becomes `calc(var(--control-md) + …)`).
  Any other length passes. A length equal to a token by chance goes on the allow-list, keyed by
  file, property and value, with a reason. It reads CSS files only; a TSX inline style is not
  walked. Its migration step moves these to tokens: the Button heights and its square `.icon`
  widths; the `TextInput` toolbar height and the `WorkspaceSwitcher` pill's height and
  `--switcher-line` (both match the md Buttons beside them); the `calc(32px + …)` in
  `ManageDialog.module.css` `scroll-padding-block` (the sticky footer's md Button); the 36px rows
  (`ManageDialog` `.rowSelect`, the `Popover` item, the open rail row); the rail's active row
  (40px), collapsed squares (40px) and active collapsed square (44px, also in `--rail-tab-inset`);
  and the pencil's 20px in `--rail-tools-width`. On the allow-list: the `Switch`, `TagIndicator`
  and workspace swatch 20px; the 32px end fade in `ManageDialog.module.css` (its
  `scroll-padding-bottom` and the mask); the 36px field height in `Settings.module.css` and
  `ShortcutsDialog.module.css`; and the rail's 28px tag reserve (`.row[data-has-tags]`). The
  same step adds `--control-md` to `GEOMETRY_VARS` in `spacing.guard.test.ts` and removes that
  file's allow-list entry for the `scroll-padding-block` line, which no longer holds a raw length.
- **Stacking.** Planned: every rung of 4 or more is a `--z-*` token. A raw −1 to 3 is allowed
  anywhere as a local tie-break. An order test reads every `--z-*` and fails on a token missing
  from the pinned order. A TSX inline `zIndex` is not walked. This walk also reads renderer test
  files, because some pin a raw rung, but it skips its own file and the order test's file (its
  probe and fixtures hold raw rungs on purpose). The
  walk matches each form a pin takes: `z-index:` then optional whitespace
  then a number of 4 or more, inside a string (test titles included) or a regex source (where
  the whitespace is written `\s*`: `Select.test.tsx`, `ExpanderBox.test.tsx`); and a constant named
  `*_Z_INDEX` set to a number (`App.styles.test.ts`). Each pin switches to reading the token, and a
  title that names a rung is reworded. The only allow-list entries are the parser fixtures in
  `App.styles.test.ts` (the `const css = '…'` lines that feed its `z-index:\s*(-?\d+)` reader),
  listed by line content with that reason; the rest of the file is walked.
- **Ports.** Landed: `DEFAULT_API_PORT` (`src/shared/schemas/settings.ts`) owns the settings
  default for the API port. Planned: `API_DEFAULT_PORT` in `src/main/api/apiContract.ts` (what
  `apiServer.ts` listens on when no port is passed) is deleted and `apiServer.ts` uses
  `DEFAULT_API_PORT`. `DEFAULT_PROFILE.apiPort` in `src/main/profile.ts` becomes that constant
  too (each is a raw number today). The profiles in `profile.ts` (`DEFAULT_PROFILE`,
  `DEV_PROFILE`, `DRIVE_PROFILE`, `E2E_PROFILE`) own the hook ports and the dev, drive and e2e API ports. A raw-port
  walk (comments stripped) reads non-test files under `src/` and the harnesses that talk to a
  running app (`tests/e2e`, `tests/drive`, `tests/smoke`), and fails on any port a profile in
  `profile.ts` sets, outside `profile.ts` and `settings.ts`. Landed: the e2e imports
  `E2E_PROFILE` from `profile.ts` (not `PROFILE`, which resolves from the importing process's
  env), which is safe because `profile.ts` imports no electron (its header says so), and that
  stays true once it imports `settings.ts`. `driveApp.mjs`
  cannot import TypeScript, so it keeps its `HOOK_PORT` on the allow-list, and a test under `tests/main/` pins it to
  `DRIVE_PROFILE.hookPort`. A unit test that feeds a port as data is exempt.
- **Modals.** Planned: `BoardState` holds one union, `modal: Modal | null`, and an exhaustive
  switch is its guard. The name prompt's busy flag and error ride in its `modal` payload
  (`design.md`: the payload a fading dialog shows rides in the Presence value). A test fails when
  any non-function `BoardState` key other than `modal` matches
  `/Dialog|Guard|Confirm|Prompt|Open$|Visible$|Shown$/`. The caller list is by component, not by
  file: every component in a non-test renderer file that renders `<ManageDialog.Frame` or sets
  `aria-modal` as a JSX attribute (comments stripped; the shell `ManageDialogParts.tsx` itself is
  skipped). A test pins that `App.tsx` renders each caller component from a `modal.kind` case,
  and that no other non-test renderer file renders one. Today the `Settings` gear in
  `Settings.tsx` (mounted only by the `#terminals` proof view) opens `SettingsPanel` from its own
  `useState`, outside the store; its migration step opens it through `openModal` or deletes it.
  Today `lib/modals.ts` lists the modal flags by hand.
- **Overlay hooks.** Planned: `data-overlay` on every dialog, popover and toast root, and
  `data-dead-pane` on the dead terminal pane. In `glass/surfaces.ts`, `OVERLAY` becomes
  `OWN_GLASS = '[data-overlay], [data-dead-pane]'`, and its import in `glass/overlayLight.ts`
  follows. `OWN_GLASS` keeps leaving overlays, because
  they still paint. Today `OVERLAY` covers a new dialog by its role alone; `OWN_GLASS` covers only
  a stamped root, so a guard lands in the same change as the rename. The guard (TS AST, non-test
  renderer files): every JSX element whose `role` is the literal `"dialog"` or `"alertdialog"`, or
  that carries `data-popover` or `data-toast`, also carries `data-overlay`. A `Popover.Surface`
  passes, since the part stamps its own root. An element whose `role` comes from an expression,
  that is not a `Popover.Surface` and carries no `data-overlay`, goes on an allow-list naming the
  roles it can take (`Callout`: `alert` or `status`; the `TagMenu` item: `menuitemradio` or
  `checkbox`). It must go red when the stamp is removed from any of today's roots: the
  ManageDialog shell, `SessionNameDialog`, `QuitGuard`, `StopConfirm`, `Popover.Surface` and the
  `Toaster` toast.
- **Test ids are not hooks.** App code should never use a test id as a hook, but today these
  do: `OVERLAY` selects the dead pane by `[data-testid='dead-terminal']`, and
  `TagChip/fitCount.ts` selects `[data-testid="tag-chip"]` and `[data-testid="tag-chip-more"]`.
  Planned: they move to `data-dead-pane` and to `data-tag-chip` and `data-tag-chip-more`
  _(to write)_, and a guard fails on any string that holds `[data-testid` in a non-test
  renderer TS or TSX file (comments removed). It reads string literals, templates with no
  substitution, and every template head and span text; its probes include one written as a
  template. An object key `'data-testid'` is not a selector and passes.

**2 — drift tests**

- **(a) Themes.** Owner decision: a theme targets public `data-*` hooks and roles only, never
  `data-testid` (technical-taste §8). Test ids are retired as a theme hook. Liquid Glass
  still selects test ids and moves to named hooks in its migration step. When a theme needs a hook that does
  not exist, add a `data-*` attribute to the component. Planned: a test reads every bundled
  theme (`docs/themes/examples/*/theme.css`) and fails when it names `data-testid`, or selects a
  `[data-*]` name that no non-test renderer file sets. A file sets `data-x` when, comments
  stripped, it holds a `data-x=` JSX attribute, a bare `data-x` JSX attribute with no value
  (`ColumnHeader.tsx` sets `data-column-header` that way), a `'data-x'` string literal anywhere (an
  object key, a constant such as `GLASS_ON_ATTR` in `glass/glassDom.ts`, a `setAttribute`
  argument) or a `dataset.x` write, camel-cased (`root.dataset.input` sets
  `data-input`). A `[data-x]` inside a selector string or a CSS file does not count.
- **(a) Drive locators.** Planned, a test under `tests/main/`: every literal `data-testid` in `tests/drive/*.mjs` is set in a
  non-test renderer file: the id appears there, comments stripped, as a whole string literal or
  JSX attribute value. That covers `data-testid="x"`, a `testId="x"` or `armedTestId="x"` prop and
  a default (`testId = 'header-new-session'`); an id seen only inside a longer selector string
  does not count. Ids the ManageDialog shell builds count too: the test collects each
  `testIdPrefix` literal (an option to `useManageDialog` or a prop) and adds the suffixes the shell
  sets in `ManageDialogParts.tsx` (`-overlay`, `-panel`, `-close`, `-message`, `-success`), read
  from that file. A page row's id is a prefix, `-`, and a page id: it passes when the page id is
  an `id:` string literal in a page list in a non-test renderer file (`'rules'` in
  `TagsDialog.tsx`, `'past'` in `SessionsDialog/sessionsPages.ts`). A template `${…}` selector in the drive script is skipped. A prefix locator
  (`[data-testid^="workspace-select-"]`) passes when a non-test renderer file holds a template
  literal that starts with that prefix (`` `workspace-select-${w.id}` `` in `WorkspacesDialog.tsx`).
- **(b) Channels.** Landed nearby: `src/shared/ipc/contract.test.ts` (no duplicate channel
  names) and the `local-ipc/no-literal-channels` ESLint rule. Planned: every `CH.*` key has an
  identifier reference (AST, or comments stripped) in a non-test file (the shared meaning above)
  in `src/main` and in one in `src/preload`. An unreferenced channel is deleted, together with
  every doc line that names it (rule 5). Today `CH.watchSnapshot` is unreferenced; its migration
  step deletes it and its doc lines.
- **(c) Log codes.** Planned, scoped to the harnesses that wait on a running app's log
  (`tests/e2e`, `tests/drive`, `tests/smoke`): every exact `code=<token>` there (the whole
  token, so `interrupt_key` is not passed by `interrupt_key_seen`) is emitted by a non-test file
  in `src/` that holds the same exact token. On both sides the walk reads string literals,
  templates with no substitution, and every template head and span text: every harness wait and
  many emitters are templates with a substitution (`` `code=… session=${id}` ``). Its probe is
  written as such a template. A token built at run time (`code=${code}`) goes on an
  allow-list naming its emitter file, and the test checks that the file holds the token as a
  string literal (`'interrupt_key'` in `window/watchFeed.ts`). Unit tests are out of scope: they
  call the emitter and assert its output, so a lost emitter already turns them red.
  `tests/tools/` emits its own codes. It lands with its migration step.
- **(d) Wire shape.** Planned: every test stand-in for an IPC rejection is built by
  `wrappedIpcError(code)` _(to write)_ in `src/renderer/src/test/`, which produces Electron's
  real wire shape. No other test file contains `Error invoking remote method`; the guard imports
  the prefix from `lib/ipcError.ts`, so it does not hold the string itself. The prefix has one
  owner: `src/renderer/src/lib/ipcError.ts` _(to write)_ exports it and `wrappedIpcError` imports
  it. (d) creates that file holding only the exported prefix, with a comment that the test helper
  keeps it until rule 3's step adds `ipcErrorCode` and its test. Once rule 3 lands, a renderer test that builds
  `new Error('<code>')` with a registered code fails, except in `lib/ipcError.test.ts`, which
  tests the bare-code path. `lib/ipcError.test.ts` builds its prefixed inputs with
  `wrappedIpcError` too. Land (d) before rule 3.
- **(e) Cascade.** Planned: a test reads `cascade()` in `src/main/index.ts`, collects each store
  it calls `removeByWorkspace` on, maps each store to its word (a map in the test; a store with no
  entry fails), and checks that the delete warning in `WorkspacesDialog.tsx` names every word. It parses
  that file (so comments, which name the same words, are never read) and matches the words only
  inside the warning's own template literal, the one that starts `Delete ${…}?`. It fails when it
  finds no `cascade` function, no store or no such template, and a probe that drops one word from
  the template turns it red. When `cascade` hands the work to another
  function, the test follows that call (or reads the seam file once one exists).
  Today `WorkspacesDialog.test.tsx` checks a hard-coded word list and never reads main.

**3 — refusal codes** (planned)

- `IPC_ERROR_CODES` and `ipcRefusal(code)` _(to write)_ in `src/shared/ipc/errorCodes.ts` are the
  only way main throws a refusal. A `{ ok: false, code }` that an IPC handler returns to the
  renderer uses a code from the same list. API results, theme loads and renderer-local results
  keep their own lists. What counts is how a code reaches the renderer, not the folder that throws
  it: `token_write_failed` is thrown in `src/main/api/apiToken.ts` but reaches the renderer as an
  IPC refusal, so it goes in `IPC_ERROR_CODES`.
- A schema check whose `error:` code the renderer maps is a refusal: `prompt_invalid`,
  `param_pattern_invalid` and `params_mismatch` in `src/shared/schemas/template.ts`, mapped in
  `TemplatesDialog/templateForm.ts`. Their codes go in `IPC_ERROR_CODES`. Any other failed
  argument parse is a bug: it gets no code and no copy.
- Copy-map check: every renderer copy map for IPC refusals is typed
  `Partial<Record<IpcErrorCode, string>>` _(to write)_ (or `satisfies` it), whatever its shape
  today (a tuple array, a `Record`, an inline map), so the type checker fails on an unregistered
  code. Maps for codes that are not IPC refusals keep their own key type: `lib/themeCopy.ts`
  (theme load codes), `lib/storageHealthCopy.ts` (the storage health report) and
  `lib/serverHealthCopy.ts` (the API server's health).
- Such a refusal still leaves main through the one factory. Today `src/main/persistence/templatesIpc.ts` calls
  `TemplateSaveSchema.parse(raw)`, so the renderer gets Zod's issue list, not a code. Planned: the
  handler calls `safeParse`; on failure it takes the first issue whose message is a registered
  code and throws it through `ipcRefusal`. With no such issue it is a bug: it rethrows the Zod
  error (not a `new Error`, so the throw guard does not apply). A `main-unit` test sends a bad
  prompt, a bad pattern and mismatched params through `createTemplatesIpcHandlers` and gets an
  error whose message is exactly each code; it goes red while the handler still calls `parse`.
- The renderer reads a refusal through `ipcErrorCode(err): IpcErrorCode | null` _(to write)_ in
  `src/renderer/src/lib/ipcError.ts`, tested by `lib/ipcError.test.ts` _(to write)_: the exact registered token after Electron's prefix, or a
  bare registered code, never a substring; anything else is `null`. Copy maps from the code,
  never from the message. A renderer-local code (such as `settings_persist_failed`, thrown by
  `stores/settingsStore.ts`) has no reader today, because no caller tells it apart. When a caller
  must tell a renderer-local code apart, it reads it through a typed reader in the file that owns
  its list.
- Throw guard (AST walk over every non-test file in `src/main`): every `new Error(…)` takes a
  string literal or a template literal with no substitutions, and that literal is not a registered code. So a refusal thrown
  through a constant (`new Error(TEMPLATE_ERROR.notFound)`, `new Error(STORE_WRITE_FAILED)`), a
  variable (`new Error(out.code)`), a template with a substitution
  (``new Error(`${TEMPLATE_ERROR.notFound}`)``) or a literal registered code fails; it goes through
  `ipcRefusal`. A bug throw stays a literal message that is not registered, sentence or
  snake-case (`'launch service not initialized'`, `'workspaces_store_not_initialized'`); never
  register a bug's text. A refusal written as a new literal that nobody registered is caught by
  the copy-map check above only when the renderer maps it in a typed map. Nothing checks a map's
  type: a new map typed `Record<string, string>` compiles, and the refusal shows fallback copy.
  So the reviewer checks that every new or changed refusal copy map is typed.
- `.message` guard: no `.message` read, `String(…)`, `.toString()` or template substitution
  (`` `${err}` ``) on a caught value (a `catch` param, a `.catch` param, or a value narrowed by
  `instanceof Error`) in a non-test file in `src/renderer`, outside `lib/ipcError.ts` and the files that own a
  renderer-local code's reader. `SmokeCockpit.tsx` (the smoke diagnostic, which hands the raw
  error to the smoke report) is on the allow-list with that reason.
- The comments that explain the wire shape next to today's mappers move into `lib/ipcError.ts` in
  the same change.

**4 — obligations**

- **Guard shape.** Landed example: `src/renderer/src/components/Popover/Popover.guard.test.ts`
  (each caller file holds `leavingProps(`: the `Popover.Surface` callers, plus its listed extra,
  minus its listed exempt). A rule 4 guard is a caller list
  like that one, or a ban on the raw call outside the helper. A new guard parses the file and
  matches nodes, so a comment never satisfies it, even though `Popover.guard`'s `leavingProps`
  check still reads raw text (see "Comments" above; its fix is planned).
- **Send ban.** Planned: an AST walk over non-test files in `src/main` (a text match misses a
  call that prettier wraps after `.send(`). It fails on any `.send(…)` call, on any receiver,
  whose first argument is a `CH.*` member, or is not a string literal at all (a channel held in a
  variable), unless the call is inside `sendValidated` _(to write)_. One allow-list is by
  channel, each with a reason: `ptyData` and
  `ptyExit` (smoke bytes), `themeApplied` (its `push` sink in `index.ts` only receives a bundle
  `themes/themeLifecycle.ts` has already checked with `ThemeBundleSchema.safeParse`, or the
  built-in default), and `attentionActivate` and `attentionReminder` (DI
  `send` seams in `window/watchFeed.ts`; validation lives in the sink). The other is by file, for
  a sink that calls an injected `send` with only a payload, no channel: `kde/notificationActivate.ts`
  and `kde/reminderSink.ts`, each with the reason "calls an injected `send` with a payload it just
  validated (`safeParse`)". The by-file entry exempts only a call whose first argument is not a
  `CH.*` member. A `.postMessage(…)` call whose first argument is a `CH.*` member (a
  `webContents.postMessage` on a channel) is a send too and is banned the same way: it goes through
  `sendValidated` or on the by-channel allow-list. `terminalOpen` is on it, because its payload is
  built in place from two ids (`ipc/registerTerminalIpc.ts`). A MessagePort `port.postMessage`
  takes no channel, is not a send and is out of scope. Preload sends are not covered: main parses
  them at its handler (`zod-boundaries.md`). Today's precedent for a validated send is
  `src/main/ipc/sendLaunchCorrelated.ts`.
- technical-taste §5b-14 holds: search for the existing helper first. Adopt rule 1's stacking
  ladder before any consolidation that touches stacking.

**5 — stale and dead**

- **Search.** Landed: `npm run find-name -- <name>…` (`tests/tools/findName.mjs`, pinned by
  `tests/main/findName.test.ts`). It reads each name as an exact string, never a regex or a flag.
  It searches tracked files and untracked files git does not ignore (so `.claude/rules/`, but not
  the gitignored `.claude/skills/`), and the records (`docs/superpowers`, `docs/reports`,
  `_bmad-output`) in every worktree. It also finds a moved file by its basename, and a name of two
  or more words split by a hard wrap, a string join or a JSX `{' '}` break. It reports a file it
  cannot read or a missing worktree on stderr (`code=find_name_*`), and exits 1 when nothing is
  found. Run it on every name the change renames, moves, removes or redefines, and on the old
  behaviour's words. Then read the
  living-doc section that owns the feature: no tool finds a line that only paraphrases.
  `.superpowers/` is scratch and never searched: the tool skips the top-level `.superpowers/`
  folder by name, whether or not git ignores it, and `findName.test.ts` pins that. A
  `.superpowers/` folder nested deeper is searched.
- **Fix.** No guard; the reviewer checks it. The change that makes a comment or living-doc line
  false fixes it in the same commit. That includes generated docs: regenerate them
  (`npm run gen:theme-docs`). "No test proves it wrong" is not an exemption. A dated record the
  change makes false gets the "Superseded:" line from rule 5.
- A commit that removes a constraint or incident comment says so (technical-taste §5b-18).
- **Scratch citations.** Planned: a guard fails on a comment under `src/` or `tests/` that cites
  a path inside `.superpowers/` (`.superpowers/` followed by a folder or file name). The tool and
  test of `find-name`, which name `.superpowers/` itself, pass. Today these comments cite it
  (`kde/reminderSink.ts` and its test, `AttentionRail.flare.styles.test.ts`,
  `hooks/useSessionSeen.test.tsx`); its migration step drops or replaces each citation.
- **Dead code.** Landed: `knip` (run by `npm run lint`) finds unused value exports. Types are off
  in `knip.json`, so an unused exported type is a review item. `knip.json` treats `tests/**` as
  entry points, so knip never flags an export only a test reads. Such an export is kept only when
  a comment says a test keeps it on purpose; otherwise it is dead and deleted.
- **Prompt, not a guard.** Search the changed files for "harmless", "unverified", "never
  observed" and "not yet wired"; each hit is a claim to check.
- **Doc paths.** Landed in part: `tests/unit/agentContext.guard.test.ts` checks that every
  `rules/<x>.md` CLAUDE.md points to exists. Planned: every code span whose text starts with `src/`
  or `tests/`, and every `CH.<key>` in CLAUDE.md and `.claude/rules/*.md` exists. A path that ends in `/`
  or names a folder passes when that folder exists (`src/main/themes/`, `tests/e2e`). Any other
  path with no extension resolves as a module (`.ts`, `.tsx`, `/index.ts`). Skipped, each with its
  reason on an allow-list: the placeholder `CH.x`, any `CH` name that holds `<` or `…` (a
  placeholder), any `CH` name ending in `*` (a family, such as `CH.watch*`), any path holding a glob character (`*`, `?` or `{`) anywhere, such as
  `src/shared/schemas/*.ts` and `src/main/ipc/register*.ts` in `ipc.md`, a placeholder path (one
  holding `…` or `<x>`), and a path in a bullet that still carries a _(to write)_ mark (this
  file names files its planned blocks will create).

**6 — failures and guards**

- **What needs a surface.** No single guard; per-surface tests check it. A failure of an operator
  action (a click, a key, an API call) or of the operator's data reaches `StorageNotice`,
  `ServerHealthBanner`, a `Callout`, a toast or an HTTP status, and its caller sees a failure.
  `persistOrReport()` (CLAUDE.md "Storage health") keeps the change and reports the disk: that is
  a success.
- **No surface left.** On quit or window close a `code=` log is the floor and nothing throws
  (`code=teardown_archive_failed`, `session-engine.md`). An API event stream after its headers
  has no error slot either, so a dropped frame logs `code=session_projection_failed` and the
  stream goes on (`api.md`).
- **Value or log.** A failure handed back as a value the caller can tell from every real result
  (`{ ok: false, code }`, a `null` that means nothing else) is not contained; its caller owns it.
  The place that made it may still log (a theme that fails to load logs `code=theme_load_failed`,
  then returns `{ ok: false }`). A failure that passes for a real result (`[]`, a default, a
  `null` that also means "none") logs a `code=` where it was caught.
- **Not a failure.** A yes/no or match check whose throw is its answer (`statSync` on a folder
  that may not exist → `false`) logs nothing.
- **Quiet drops.** Landed: `tests/main/catchBlocks.guard.test.ts` names each file allowed a
  comment-only `try`/`catch`, with a count and a reason. It does not see a promise `.catch` arm. Planned: it
  treats a `.catch` arm, and the second argument of a `.then`, as it treats a `catch`: an empty
  arm fails, and a comment-only arm needs a listed file and reason. An arm is empty when its
  block holds nothing, or its body is a bare literal or `undefined` (`() => null`). An arm that
  is an identifier (`.catch(noop)`) fails too, except `undefined`, which adds no handler (a Zod
  `.catch(undefined)` is a fallback value). A file's count covers its comment-only `catch` blocks
  and arms together. Today `stores/toastStore.ts`
  holds an empty arm, and `audio/attentionSound.ts` and `terminal/EmbeddedTerminal.tsx` each hold
  a comment-only one; its migration step gives the empty arm a `code=` log (or a comment and a
  list entry) and logs or lists the comment-only arms.
  Quiet drops are also listed elsewhere: the quiet rows of `zod-boundaries.md` and the
  transcript tail: `hooks/transcriptSignal.ts` drops a
  line that fails `TranscriptEntrySchema` with no log, because the line holds the operator's
  conversation. Each list only shrinks. Today nothing stops the `catchBlocks` list from growing,
  so the reviewer rejects a new entry. Planned: the guard pins its entry count. The pin sits in
  the same file as the list, so it is a review tripwire, not a block: a new entry must also raise
  the pin, and the reviewer rejects that.
- **Defects.** A `void` on a call that can reject, with no `.catch` and no catch inside; a raw
  `err` or `err.message` in a log; an `onError` nobody collects. Landed:
  `src/renderer/src/lib/bridgeCatch.test.ts` fails on `void window.<a>.<b>(…)` with no
  `.catch(`. It cannot see into a wrapper, so a per-caller refusal test covers wrappers.
  - Allowed: a function that catches every path (`drain` in `hooks/transcriptWatcher.ts`).
  - Allowed: `void x.run()` from `useAsyncAction` only when its `fn` catches, because `run`
    passes rejections through.
- **(b) Untested main logic.** Logic in a main file that no `main-unit` test imports (`index.ts`,
  an untested registrar or window file) gets a seam or a test. The house pattern is a DI seam
  tested in the `main-unit` project; `vi.mock('electron')` serves a module that imports Electron
  (`persistence/electronBlobStore.test.ts`). Planned: a test pins the `index.ts` line count with
  20 lines of headroom. No change raises the pin, a feature included: a change that would go over
  it moves logic into a seam. Only the release clean-up pass moves the pin, and only down: the
  migration step that lands the pin also adds that duty to `release.md` step 0, in the same
  commit.
- **(c) A guard that stays green when broken is not a guard.** No automated check; the
  `code-reviewer` subagent repeats it. Before the commit, break the code each new guard (or each
  test written for a fix) protects and watch it turn red (technical-taste §5b-2).

**7 — leaving overlays**

- Landed in part: `dialogHoldsFocus` in `lib/terminalFocus.ts` already skips a dialog or
  alertdialog with `data-leaving`, through an inline selector.
- Planned: `lib/liveOverlay.ts` _(to write)_ exports these shared selectors:
  - `LIVE_DIALOG` = `[role="dialog"]:not([data-leaving]), [role="alertdialog"]:not([data-leaving])`.
    `terminalFocus` imports it. Focus stays a dialog-only question (CLAUDE.md "Focused-view
    keys"); the `+ New session` popover counts because it has `role="dialog"`.
  - `LIVE_OVERLAY` = `[data-overlay]:not([data-leaving])`, for any "is an overlay open" DOM
    question. It needs rule 1's overlay hooks first.
- Not used by `glass/surfaces.ts` or `glass/overlayLight.ts` (a leaving overlay still paints). Not
  used by `lib/modals.ts`: a store question needs no selector.
- Guard, planned: no selector string that selects role `dialog`, `alertdialog`, `menu` or
  `listbox` (`[role="…"]`, `[role='…']` or unquoted `[role=…]`), any `[aria-modal` (any quoting or
  value), `[data-popover]`, `[data-toast]` or `[data-overlay]` in a non-test `src/renderer/**/*.{ts,tsx}` file outside
  `lib/liveOverlay.ts`, `glass/surfaces.ts` and `glass/overlayLight.ts`. Comments are stripped
  (see "Comments" above), since comments name these hooks today. The role value must equal one
  of those roles exactly (a closing quote or `]` follows it), so `[role="menuitem"]` and
  `[role="option"]` pass. Each hook name matches exactly too (a `]` or `=` follows it), so
  `[data-popover-list]` passes. A JSX attribute that sets a role (`role="menu"`) is not a selector and passes. Tests are
  exempt.
- Drive, planned: a Vitest test under `tests/main/` reads every `tests/drive/*.mjs` and requires
  `:not([data-leaving])` on each such locator used to wait or click (same exact role match as
  above; a locator chained under one that already passes is not checked again). That form only
  works when the element with the role is the one that gets `data-leaving`. Dialogs, menus and
  `Popover.Surface` get it today; `Popover.List` does not, and it carries `role="listbox"` in
  `Select` and `ExpanderBox`. So, in the same change, `PopoverList` sets
  `leavingProps(useLeaving())` the way `PopoverSurface` does, and a Select test pins that its
  listbox carries `data-leaving` while it fades. A locator that only measures painting goes on an
  allow-list with that reason, since a leaving overlay still paints: the `shot()` crop in
  `driveApp.mjs`. The modal locator in `glassCheck.mjs` both waits for an open dialog and
  measures it, so it splits: the open wait uses a live locator (`:not([data-leaving])`), and the
  selector the measurement reads goes on the allow-list. The `detached` wait after Escape uses
  the allow-listed selector, since it waits for the paint to go; on a live locator it would
  resolve as soon as `data-leaving` appears.

**Conditional (spike), planned.** App `*.module.css` goes in `@layer app`, and theme CSS stays
unlayered. Then the `[data-glass][data-glass][data-glass]` and `:where()` specificity hacks in
the bundled themes are deleted, and a guard bans them. The spike asks: once app CSS is layered,
any theme rule beats `.button[data-lit]`, `:hover` and `[data-selected]`, so does every theme have
to restate every state? Commit `11a29a2` is a live case. The pins of the triple chain in
`src/main/themes/themeExamples*.test.ts` change with it. The spike also checks whether a Vite
`transform` or an inline `css.postcss.plugins` works without a PostCSS config file.
