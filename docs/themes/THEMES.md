# claude-watcher themes

A theme is a folder you drop into the app's themes folder. The app reads it, checks it, and
offers it in **☰ → Settings → Theme**. Nothing in a theme can crash the app: a package that
breaks a rule is listed with the reason and never applied.

The themes folder is `themes/` inside the app's data folder — on Linux
`~/.config/claude-watcher/themes/`. **Open themes folder** in Settings opens it.

Two themes ship with the app: **Liquid Glass** and **Paper**. They are read-only, live inside the
app, and update with it. A folder in your themes folder with the same id (`liquid-glass`,
`paper`) is ignored — to customise one, copy it from [examples](examples/) under a NEW id.
`builtin-dark` is not shipped: it is the Default theme written out as a starting point.

## A theme in 5 minutes

1. Make a folder. Its NAME is the theme id: lower-case letters, digits and `-`, up to 64 chars,
   starting with a letter or digit (`my-theme`, not `My Theme`). `default` is taken.
2. Put a `theme.json` in it:

   ```json
   {
     "$schema": "https://raw.githubusercontent.com/jnaranj09/claude-watcher/main/docs/themes/theme.schema.json",
     "version": 1,
     "name": "My theme",
     "tokens": { "bg-base": "#101418", "working": "#7aa2f7" }
   }
   ```

3. Open Settings, press **Reload themes**, pick **My theme**. The app repaints in place.
4. Edit the file, press **Reload themes** again. There is no file watcher.

Copy one of the [examples](examples/) to start from a full package.

## The folder

```
themes/
  my-theme/
    theme.json      required — the manifest
    theme.css       optional — raw CSS, named by the manifest
    bg.png          optional — assets referenced from theme.css
```

## `theme.json`

| Field         | Required | Meaning                                                                                            |
| ------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `$schema`     | no       | For your editor. Accepted and ignored.                                                             |
| `version`     | yes      | The literal `1`.                                                                                   |
| `name`        | yes      | 1–80 characters. What the picker shows.                                                            |
| `author`      | no       | Up to 80 characters. Display only.                                                                 |
| `colorScheme` | no       | `"dark"` (default) or `"light"`. Sets the app's native colour scheme too (scrollbars, checkboxes). |
| `tokens`      | no       | Token name → value. Only the names in the table below; an unknown name fails the theme.            |
| `terminal`    | no       | xterm palette keys → value, plus `allowTransparency`. Unknown keys fail the theme.                 |
| `css`         | no       | A file NAME in the theme folder ending in `.css`. No folders, no `..`.                             |

`theme.json` itself is capped at 64 KB; over that the theme fails to load.

Unknown fields fail the theme. Every rule fails the WHOLE theme: nothing partial is ever applied.

### Values

A token value is up to 500 characters; a terminal value up to 100. A value may not contain
`url(`, `;`, `{`, `}`, `/*`, a newline or a backslash — it is a value inside the generated `:root`
block, never a piece of CSS. The backslash is refused for the same reason the CSS file refuses one
(below): CSS lets an escape sequence like `\75 rl(https://…)` be read as `url(`, which would
otherwise smuggle a remote reference into a value that looks harmless. `rgba(...)`, gradients and
font stacks are fine.

### Tokens

Every token is a CSS custom property (`--bg-base`, `--rounded-md`, …). Set any subset.

<!-- generated:tokens:start -->
| Token | Meaning | Default |
| --- | --- | --- |
| `bg-base` | The window ground: the board behind the columns and the ground the active rail row opens onto | `#1a1a18` |
| `bg-surface` | Panels and fields: the dialog body, text inputs, the Select box | `#232220` |
| `bg-surface-raised` | A panel floating above the surface: the Settings dialog, popovers, menus | `#2c2b27` |
| `bg-col-hero` | The needs-you column background | `#201f1c` |
| `bg-col-calm` | The working and idle column backgrounds | `#151513` |
| `bg-card-hero` | A session card in the needs-you column | `#2a2925` |
| `bg-card-calm` | A session card in the working and idle columns | `#1e1e1b` |
| `bg-row-rest` | A rail row you are NOT viewing (the active row paints bg-terminal) | `#3a3833` |
| `bg-terminal` | The terminal frame and the active rail row (the two must match) | `#141312` |
| `scrim` | The translucent overlay behind every dialog | `rgba(10,10,8,0.62)` |
| `bg-hover` | The hover layer painted over a hovered control or row. Keep it translucent so it shows on every surface | `color-mix(in srgb, var(--text-primary) 10%, transparent)` |
| `border` | The default 1px line: rows, fields, buttons at rest | `#34332e` |
| `border-strong` | A stronger line: panel edges, a hovered button | `#423f39` |
| `border-card` | The session card outline | `#403e37` |
| `text-primary` | Body text and labels | `#d6d3ca` |
| `text-secondary` | Helper lines, placeholders, secondary labels (the floor on raised panels) | `#a4a094` |
| `text-muted` | Muted text on bg-base only (too low-contrast on a panel) | `#6b685e` |
| `text-dim` | Dividers and the dimmest text (bright-black in the terminal) | `#47453d` |
| `text-on-accent` | Ink on a working-coloured (primary) button | `#11111b` |
| `text-on-danger` | Ink on a danger-coloured (armed delete) button | `#ffffff` |
| `text-on-lit` | Ink on a lit toggle (text-primary fill) and on the needs-you count pill | `#1a1a18` |
| `working` | The working status colour, the primary button fill and the selection accent | `#89b4fa` |
| `needs-you` | The needs-you status colour (gold): the rail badge, the hero column accent | `#ffcf29` |
| `done` | Defined for completeness; no component uses it | `#a6e3a1` |
| `idle` | The idle status colour | `#807d72` |
| `danger` | Delete and quit: border at rest, fill when hovered or armed | `#db4b4b` |
| `success` | Success callout bar and icon disc | `#a6e3a1` |
| `text-on-success` | The check mark on the success disc | `#11111b` |
| `success-fill` | Success callout fill | `color-mix(in srgb, #a6e3a1 10%, var(--bg-surface-raised))` |
| `success-border` | Success callout border | `color-mix(in srgb, #a6e3a1 35%, var(--bg-surface-raised))` |
| `danger-fill` | Error callout fill | `color-mix(in srgb, #db4b4b 10%, var(--bg-surface-raised))` |
| `danger-border` | Error callout border | `color-mix(in srgb, #db4b4b 40%, var(--bg-surface-raised))` |
| `focus-ring` | The keyboard focus outline on every control | `rgba(255,255,255,0.55)` |
| `focus-ring-width` | Width of the keyboard focus outline | `1px` |
| `tag-slate-fill` | Slate tag chip fill (opaque, composited over bg-surface) | `#373739` |
| `tag-slate-border` | Slate tag chip border and rail indicator stroke | `#5b5e65` |
| `tag-slate-text` | Slate tag chip text | `#c4c9d4` |
| `tag-blue-fill` | Blue tag chip fill | `#333943` |
| `tag-blue-border` | Blue tag chip border and rail indicator stroke | `#516482` |
| `tag-blue-text` | Blue tag chip text | `#a9c7fb` |
| `tag-green-fill` | Green tag chip fill | `#384135` |
| `tag-green-border` | Green tag chip border and rail indicator stroke | `#5e795a` |
| `tag-green-text` | Green tag chip text | `#b7e4b2` |
| `tag-amber-fill` | Amber tag chip fill | `#443629` |
| `tag-amber-border` | Amber tag chip border and rail indicator stroke | `#7f5b3a` |
| `tag-amber-text` | Amber tag chip text | `#f0b98a` |
| `tag-violet-fill` | Violet tag chip fill | `#3e3742` |
| `tag-violet-border` | Violet tag chip border and rail indicator stroke | `#6f5d81` |
| `tag-violet-text` | Violet tag chip text | `#d7bff9` |
| `tag-rose-fill` | Rose tag chip fill | `#443336` |
| `tag-rose-border` | Rose tag chip border and rail indicator stroke | `#81515d` |
| `tag-rose-text` | Rose tag chip text | `#f5a9be` |
| `tag-red-fill` | Red tag chip fill | `#44322e` |
| `tag-red-border` | Red tag chip border and rail indicator stroke | `#804f48` |
| `tag-red-text` | Red tag chip text | `#f5a59a` |
| `tag-lime-fill` | Lime tag chip fill | `#3c402f` |
| `tag-lime-border` | Lime tag chip border and rail indicator stroke | `#6b7749` |
| `tag-lime-text` | Lime tag chip text | `#d1e79d` |
| `tag-teal-fill` | Teal tag chip fill | `#35413d` |
| `tag-teal-border` | Teal tag chip border and rail indicator stroke | `#567871` |
| `tag-teal-text` | Teal tag chip text | `#afe9e0` |
| `tag-cyan-fill` | Cyan tag chip fill | `#334040` |
| `tag-cyan-border` | Cyan tag chip border and rail indicator stroke | `#51767b` |
| `tag-cyan-text` | Cyan tag chip text | `#a6e5f0` |
| `tag-indigo-fill` | Indigo tag chip fill | `#373742` |
| `tag-indigo-border` | Indigo tag chip border and rail indicator stroke | `#5a5c81` |
| `tag-indigo-text` | Indigo tag chip text | `#b6baf9` |
| `tag-pink-fill` | Pink tag chip fill | `#453c40` |
| `tag-pink-border` | Pink tag chip border and rail indicator stroke | `#826a7a` |
| `tag-pink-text` | Pink tag chip text | `#f8d1ed` |
| `workspace-slate-fill` | Slate workspace tint fill — the switcher, its menu rows, the Workspaces dialog rows and every workspace name box (default: the hue mixed 14% over the theme bg-surface-raised; the borders 40%) | `color-mix(in srgb, #7f849c 14%, var(--bg-surface-raised))` |
| `workspace-slate-border` | Slate workspace tint border | `color-mix(in srgb, #7f849c 40%, var(--bg-surface-raised))` |
| `workspace-blue-fill` | Blue workspace tint fill | `color-mix(in srgb, #89b4fa 14%, var(--bg-surface-raised))` |
| `workspace-blue-border` | Blue workspace tint border | `color-mix(in srgb, #89b4fa 40%, var(--bg-surface-raised))` |
| `workspace-green-fill` | Green workspace tint fill | `color-mix(in srgb, #a6e3a1 14%, var(--bg-surface-raised))` |
| `workspace-green-border` | Green workspace tint border | `color-mix(in srgb, #a6e3a1 40%, var(--bg-surface-raised))` |
| `workspace-amber-fill` | Amber workspace tint fill | `color-mix(in srgb, #f9e2af 14%, var(--bg-surface-raised))` |
| `workspace-amber-border` | Amber workspace tint border | `color-mix(in srgb, #f9e2af 40%, var(--bg-surface-raised))` |
| `workspace-violet-fill` | Violet workspace tint fill | `color-mix(in srgb, #cba6f7 14%, var(--bg-surface-raised))` |
| `workspace-violet-border` | Violet workspace tint border | `color-mix(in srgb, #cba6f7 40%, var(--bg-surface-raised))` |
| `workspace-rose-fill` | Rose workspace tint fill | `color-mix(in srgb, #f38ba8 14%, var(--bg-surface-raised))` |
| `workspace-rose-border` | Rose workspace tint border | `color-mix(in srgb, #f38ba8 40%, var(--bg-surface-raised))` |
| `workspace-red-fill` | Red workspace tint fill | `color-mix(in srgb, #f28779 14%, var(--bg-surface-raised))` |
| `workspace-red-border` | Red workspace tint border | `color-mix(in srgb, #f28779 40%, var(--bg-surface-raised))` |
| `workspace-lime-fill` | Lime workspace tint fill | `color-mix(in srgb, #c2df7c 14%, var(--bg-surface-raised))` |
| `workspace-lime-border` | Lime workspace tint border | `color-mix(in srgb, #c2df7c 40%, var(--bg-surface-raised))` |
| `workspace-teal-fill` | Teal workspace tint fill | `color-mix(in srgb, #94e2d5 14%, var(--bg-surface-raised))` |
| `workspace-teal-border` | Teal workspace tint border | `color-mix(in srgb, #94e2d5 40%, var(--bg-surface-raised))` |
| `workspace-cyan-fill` | Cyan workspace tint fill | `color-mix(in srgb, #89dceb 14%, var(--bg-surface-raised))` |
| `workspace-cyan-border` | Cyan workspace tint border | `color-mix(in srgb, #89dceb 40%, var(--bg-surface-raised))` |
| `workspace-indigo-fill` | Indigo workspace tint fill | `color-mix(in srgb, #9ea3f7 14%, var(--bg-surface-raised))` |
| `workspace-indigo-border` | Indigo workspace tint border | `color-mix(in srgb, #9ea3f7 40%, var(--bg-surface-raised))` |
| `workspace-pink-fill` | Pink workspace tint fill | `color-mix(in srgb, #f5c2e7 14%, var(--bg-surface-raised))` |
| `workspace-pink-border` | Pink workspace tint border | `color-mix(in srgb, #f5c2e7 40%, var(--bg-surface-raised))` |
| `font-ui` | The UI font stack | `system-ui, 'Noto Sans', 'Segoe UI', sans-serif` |
| `font-mono` | The monospace stack for paths, ids and the terminal chrome | `'JetBrains Mono', ui-monospace, 'Hack', 'Noto Sans Mono', monospace` |
| `font-size-display` | Display size: the empty-board headline | `20px` |
| `font-weight-display` | Display weight | `600` |
| `line-height-display` | Display line height | `1.3` |
| `font-size-heading` | Heading size: dialog titles, column headers | `14px` |
| `font-weight-heading` | Heading weight | `600` |
| `line-height-heading` | Heading line height | `1.3` |
| `letter-spacing-heading` | Heading letter spacing | `0.01em` |
| `font-size-body` | Body size: card names, form fields, buttons | `13px` |
| `font-weight-body` | Body weight | `500` |
| `line-height-body` | Body line height | `1.4` |
| `font-size-label` | Label size: form labels, chips | `12px` |
| `font-weight-label` | Label weight | `500` |
| `line-height-label` | Label line height | `1.3` |
| `font-size-meta` | Meta size: timestamps, counts, helper lines | `11.5px` |
| `font-weight-meta` | Meta weight | `400` |
| `line-height-meta` | Meta line height | `1.3` |
| `font-size-mono` | Monospace size | `12.5px` |
| `font-weight-mono` | Monospace weight | `400` |
| `line-height-mono` | Monospace line height | `1.45` |
| `rounded-sm` | Small corner radius: chips, badges | `4px` |
| `rounded-md` | Medium corner radius: buttons, fields | `6px` |
| `rounded-lg` | Large corner radius: cards, panels, the terminal frame | `8px` |
| `rounded-full` | Pill radius | `9999px` |
| `space-half` | 2px spacing step | `2px` |
| `space-1` | 4px spacing step | `4px` |
| `space-2` | 8px spacing step | `8px` |
| `space-3` | 12px spacing step | `12px` |
| `space-4` | 16px spacing step | `16px` |
| `space-5` | 20px spacing step | `20px` |
| `space-6` | 24px spacing step | `24px` |
| `space-8` | 32px spacing step | `32px` |
| `gap-stack` | Title over subtitle inside one row | `var(--space-half)` |
| `gap-row` | Between rows of one list or menu | `var(--space-1)` |
| `gap-row-filled` | Between rows that are filled boxes (workspace-tinted rows) | `var(--space-2)` |
| `gap-inline-tight` | Icon beside text; small tool clusters | `var(--space-1)` |
| `gap-inline` | Controls side by side; button rows | `var(--space-2)` |
| `gap-group` | Between groups in a menu, rail or pane | `var(--space-3)` |
| `gap-field` | A label to the control it names, above it or beside it | `6px` |
| `gap-section` | One form field block to the next; section to section | `var(--space-5)` |
| `gap-actions` | The last field to a dialog button row | `var(--space-6)` |
| `gap-page` | Page edge; header, filter bar and board; column gaps | `var(--gutter)` |
| `gap-card` | Between cards in a board column (reads card-gap) | `var(--card-gap)` |
| `inset-item-y` | Vertical padding inside a row, field or menu item | `var(--space-2)` |
| `inset-item-x` | Horizontal padding inside a row, field or menu item | `var(--space-3)` |
| `inset-compact-y` | Vertical padding inside a compact control | `var(--space-1)` |
| `inset-compact-x` | Horizontal padding inside a compact control | `var(--space-2)` |
| `inset-pill` | Side padding of a tag or workspace pill | `var(--space-2)` |
| `inset-pill-tight` | Side padding of a count or badge | `var(--space-1)` |
| `inset-popover` | Padding inside a menu box | `var(--space-2)` |
| `inset-card` | Padding inside a card or board column | `var(--space-3)` |
| `inset-panel` | Padding inside a dialog panel | `var(--space-6)` |
| `inset-empty` | Padding around the empty board | `var(--space-8)` |
| `topbar-height` | Height of the rail header and the focused view bar (they meet at the rail edge) | `45px` |
| `rail-width` | The attention rail width when expanded | `240px` |
| `rail-width-collapsed` | The attention rail width when collapsed | `70px` |
| `card-min-height` | Minimum session card height | `92px` |
| `gutter` | The board gutter on each side | `var(--space-4)` |
| `card-gap` | The gap between cards in a column | `var(--space-3)` |
| `shadow-dialog` | The shadow under a dialog panel | `0 12px 32px rgba(13,14,20,0.55)` |
| `shadow-pop` | The shadow under a popover or menu | `0 6px 18px rgba(13,14,20,0.45)` |
<!-- generated:tokens:end -->

### Terminal

The keys of xterm's `ITheme`, plus `allowTransparency`. Set any subset.

<!-- generated:terminal:start -->
| Key | Default |
| --- | --- |
| `background` | `#141312` |
| `foreground` | `#d6d3ca` |
| `cursor` | `#d6d3ca` |
| `cursorAccent` | `#141312` |
| `selectionBackground` | `rgba(60,58,48,0.85)` |
| `selectionForeground` | unset |
| `selectionInactiveBackground` | unset |
| `black` | `#1a1a18` |
| `red` | `#f38ba8` |
| `green` | `#a6e3a1` |
| `yellow` | `#f9e2af` |
| `blue` | `#89b4fa` |
| `magenta` | `#cba6f7` |
| `cyan` | `#94e2d5` |
| `white` | `#a4a094` |
| `brightBlack` | `#47453d` |
| `brightRed` | `#f38ba8` |
| `brightGreen` | `#a6e3a1` |
| `brightYellow` | `#f9e2af` |
| `brightBlue` | `#89b4fa` |
| `brightMagenta` | `#cba6f7` |
| `brightCyan` | `#94e2d5` |
| `brightWhite` | `#d6d3ca` |
| `allowTransparency` | `false` |
<!-- generated:terminal:end -->

`allowTransparency` is read when a terminal is CREATED (xterm needs it before it opens). A theme
that turns it on reaches terminals opened after it was applied; Settings says so while it is on.
It costs paint performance; use it only with a translucent `background`.

### Wallpapers

A theme may ship up to 8 predefined wallpapers. The operator picks one in Settings (the
`Wallpaper` row appears when a theme lists 2 or more); nobody picks a file from disk.

```json
"wallpapers": [
  { "id": "lake", "name": "Lake", "file": "lake.webp" },
  { "id": "graphite", "name": "Graphite", "file": "graphite.webp" }
]
```

- `id` follows the theme-id rule (lower-case letters, digits, `-`); ids are unique. `name` is what
  the dropdown shows (1–40 characters). `file` is a `.png`, `.jpg`, `.jpeg` or `.webp` in the
  theme folder.
- The FIRST entry is the default.
- The app inlines only the chosen image, as `--theme-wallpaper`. Use it in your CSS:
  `body { background: var(--theme-wallpaper) center / cover no-repeat, #000; }`.
- Every listed file must exist and they all count toward the 5 MB asset limit, even the ones not
  picked. A missing file lists the theme as broken.
- If the operator's pick disappears from the list (you renamed it), the first wallpaper is used
  and their setting is kept.
- Want a darker or blurrier image? Change the file. There is no darken or blur setting.

### Glass

An optional `glass` key asks the app to draw the board's glass with WebGL: the wallpaper bends,
frosts and lights itself under each surface. The app owns the renderer; the theme owns the numbers.

```json
"glass": {
  "renderer": "webgl",
  "surfaces": {
    "header":  { "refract": 14, "edge": 16, "blur": 12, "chroma": 0.25, "tint": "#0e0e10", "tintAmount": 0.30, "rim": 0.35, "exposure": 1.6, "lift": 0.05, "glow": 0.08, "lightFollowsCursor": false },
    "column":  { "...": "same fields", "tintNeedsYou": "#2a2414" },
    "card":    { "...": "same fields" },
    "control": { "...": "same fields" },
    "field":   { "...": "same fields" }
  }
}
```

- `renderer` is `"webgl"`, the only value.
- `lightFollowsCursor` (per surface): `true` lights that surface from the pointer's side while the
  pointer is over it; `false` keeps the fixed top-left light. Always fixed under reduced motion.
  Liquid Glass keeps it off on the header.
- The five surfaces: `header` (the app header), `column` (each board column and the focused-view
  bubble), `card` (a session card), `control` (the workspace switcher, the elsewhere tab and
  enabled primary/secondary buttons), `field` (the board search field).
- Every surface needs every field; there are no defaults. Ranges: `refract` 0–40, `edge` 1–60,
  `blur` 0–40, `chroma` 0–1, `tintAmount` 0–1, `rim` 0–1, `exposure` 1–3, `lift` 0–0.3,
  `glow` 0–0.3; `lightFollowsCursor` is `true` or `false`. Colours (`tint`, `tintNeedsYou`) are
  `#rrggbb`.
- `tintNeedsYou` is allowed on `column` only: the tint of the needs-you column.
- A bad value, a missing field or an unknown key fails the WHOLE theme closed, like any other
  rule: Default is applied, your setting is kept, and the error shows in Settings.
- The glass needs a wallpaper and WebGL2. Without WebGL2 (or under reduced transparency or more
  contrast) nothing is drawn and your theme's CSS glass is what shows, so keep that CSS good.
  While the WebGL glass is drawing, `<html>` carries `data-glass-on`; make the hooked surfaces
  transparent only under that attribute.
- Overlays (popovers, dialogs, toasts) are never drawn by WebGL. For them the app writes
  `--glass-light: <deg>` (135 = lit from the top-left) on the ONE overlay surface under the pointer:
  a popover row, an enabled primary/secondary button inside an overlay, or a toast. Use it to move
  that element's rim with the pointer, e.g. `cos(var(--glass-light))`; select on
  `[style*='--glass-light']` and declare angle-based variables on that element itself (a variable
  defined on `:root` would freeze the angle there). It is never set under reduced motion, and only
  while a theme with a `glass` key is applied.

## The CSS file

Loaded AFTER the tokens block, so it wins over everything — `!important` is never needed. The
cascade is: the app's own `tokens.css` → your `tokens` → your CSS file. Up to 1 MB.

What you can target:

- **Tokens.** Most looks are a token set. Translucent surfaces are just `rgba()` token values.
- **Elements and roles.** `body`, `[role="dialog"]`, `[role="menu"]`, `[role="listbox"]`.
- **Popovers.** Every menu and list popup is drawn by one component and carries the same hooks:
  `[data-popover]` (the box — menus, dropdown lists, the `+ New session` popover, the tag lists,
  the shortcut expander), `[data-popover-list]` (rows inside a box), `[data-popover-item]` (every
  row; `[data-density="compact"]` for the tight ones, `[data-quiet]` for a secondary action,
  `[data-tone]` for a row tinted with its workspace, whose `--ws-fill` / `--ws-border` are set),
  `[data-popover-divider]`, and `[data-popover-note]` (a muted line inside a popover: an empty list or a note). Row states are ARIA: `[aria-selected="true"]`,
  `[aria-checked="true"]`, `[aria-expanded="true"]`, plus `[data-active]`. Style popovers here,
  not by role: a new list in the app picks your look up with no change to your theme.
- **Favorite pin.** `[data-favorite="on"]` / `[data-favorite="off"]` is the pin toggle on a
  template or shortcut row (Manage dialogs and the `+ New session` popover). It is a `ghost`
  button; its filled shape is the on look, so it never carries `[data-lit]`. In the popover the
  pin sits over its row's top-right corner, inside `[data-favorite-row]`; the pointer on the pin
  is still on the row, so a theme that restyles the row hover also lists
  `[data-favorite-row]:has([data-favorite]:hover) > [data-popover-item]` in that rule.
- **Settings groups.** `[data-settings-group]` wraps the fields of one Settings pane. The app draws
  nothing there; a theme may give it a fill, an edge and padding (Liquid Glass draws an inset glass
  group).
- **Surface hooks.** The focused view's rail and its top bar are drawn by several layers (the rail
  above, around and below the active tab, and the bar). Change their surface with two custom
  properties, never by styling the layers: `--rail-surface` (the whole rail; unset = `--bg-surface`)
  and `--rail-surface-top` (only the top bar row: the rail's header and the focused bar; unset =
  `--rail-surface`). Both take a colour (no gradient or image). Set them on an ancestor of both the
  rail and the bar, normally `:root`. Liquid Glass sets both under `:root[data-glass-on]`.
- **Motion states.** A popover, dialog or toast that is closing keeps its box for 150 ms with
  `[data-leaving]`; a modal overlay carries `[data-motion="dialog"]`. `<html>` carries
  `[data-input="keyboard"]` or `[data-input="pointer"]` (the last input), and anything opened or
  closed from the keyboard does not animate. If you add your own motion, gate it the same way and
  under `prefers-reduced-motion`. Do not put `opacity` below 1 on an element whose child blurs
  with `backdrop-filter` (or a `::before` that does): Chromium then cuts that blur off.
- **Not test ids.** `data-testid` attributes exist for the app's tests and change with them, so
  a theme never selects one. Use the public `data-*` hooks in this list. Liquid Glass still selects
  test ids; it moves to named hooks in a later change.
- **Board and focused-view hooks.** All are bare attributes except where a value is shown.
  - `[data-glass="header|column|card|field|control"]` — the glass surfaces: the app header, a
    column, a session card, the search field, and a control (an enabled button, the workspace
    switcher and its tab).
  - `[data-column="working|needs-you|idle"]` — a board column; `[data-column-grid]` — the group
    holding the three; `[data-column-body]` — the stack of cards inside one column.
  - `[data-column-header][data-accent]` — a column's header, `data-accent` its status;
    `[data-column-label]` — its name; `[data-column-mark]` — its status dot (hidden by the app);
    `[data-count-sep]` — the `·` before its count.
  - `[data-count="total|working|needs-you"]` — every count badge: the workspace switcher, its
    tab and menu rows, the column headers, the Filter count.
  - `[data-session-count]` — the Filter bar's count of sessions shown.
  - `[data-app-title]` — the `Claude Watcher` brand in the header.
  - `[data-workspace-switcher]` — the switcher button; `[data-workspace-tab]` — the elsewhere tab
    beside it (rendered whenever other workspaces hold at least one session card, unlike `[data-tucked]`).
  - `[data-card-title]`, `[data-card-path]`, `[data-pending-tool]`, `[data-card-meta]` — a session
    card's name, folder path, pending tool name and pid / tasks line.
  - `[data-session-id][data-status]` — a session's card and rail row, with its status;
    `[data-selected]` — the selected card (set only while selected) and, in Manage dialogs, a
    rail page row or a list row (set always, `"true"` or `"false"`).
  - Rail: `[data-rail]` is the `<nav>`, `[data-collapsed]` its collapsed state, `[data-rail-head]`
    its top row, `[data-rail-title]` the `Sessions` title, `[data-rail-heading]` a group divider
    (Needs you, Working, ...), `[data-rail-row]` every session row (also the starting row; the
    open one adds `[data-active]`).
  - Focused view: `[data-focused-bar]` is the top bar, `[data-focused-title]` the session title,
    `[data-focused-hint]` the `Esc to return` hint, `[data-focused-frames]` the container whose
    children are the terminal frames.
- **Menu hooks.** `[data-popover-icon]` and `[data-popover-end]` are a popover row's icon and
  trailing slot. In the `+ New session` popover: `[data-menu-pick-folder]` is the folder row,
  `[data-menu-manage]` the `Manage templates` row, and a template row holds `[data-template-name]`,
  `[data-template-path]` and `[data-template-flags]`.
- **Dialog hooks.** `[data-manage-panel]` is the dialog box, `[data-manage-head]` its header,
  `[data-manage-title]` the title, `[data-manage-close]` the ✕, `[data-manage-body]` the rail and
  form columns, `[data-manage-list]` the left rail, `[data-manage-pane]` a right column with no
  form (Settings), `[data-manage-footer]` the action row, `[data-manage-row-select]` a rail row's
  select button. `[data-callout]` is a message with `[data-callout-tone]` and
  `[data-callout-size]`. Controls use ARIA: a switch is `[role="switch"]`, the Select box is
  `[aria-haspopup="listbox"]`.
- **Terminal panels.** `[data-terminal-panel]` is every box drawn as a terminal: the terminal's
  frame, or — while a card's shell is open — claude's half and the shell, each its own panel, with
  the resize divider in the gap between them. Style the terminal's border, radius, shadow and glass
  here, not on `embedded-terminal`: that element is then a plain column holding both panels.
- **Not class names.** CSS-module classes are hashed at build time and change between builds.

`url(...)` inside the CSS may name a file in the theme folder — `url(bg.png)`, `url("bg.png")` —
with one of these extensions: `png jpg jpeg gif webp svg woff woff2 ttf otf`. The app inlines it
as a `data:` URI. Every `url(...)` in the file must resolve this way; anything else (`http://…`,
`data:` already, `/abs`, `../x`, `sub/dir/x`, another extension) fails the theme. All assets
together may weigh at most 5 MB.

The one other form allowed is a **same-document fragment**, `url(#name)` (a letter, then letters,
digits, `_` or `-`): it names an element already in the page, so it cannot load anything, and it
passes through unchanged. The app ships these SVG filters for themes (Chromium resolves only
same-document filter URLs, so a theme cannot ship its own):

| Filter                         | What it does                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filter: url(#cw-text-refraction)` | The element's bright pixels (its label and icons) as faint grey light, 12px down and right, warped and blurred, kept inside the element's own shape and drawn under it. Liquid Glass puts it on its controls. The shape comes from the element's alpha: a fully clear element needs a near-invisible fill (Liquid Glass uses 0.4% white). |

The whole CSS file is ALSO refused, whole, if it contains a **backslash**, `@import`, or
`image-set(` anywhere in it — each one fails the theme with the same code a bad `url(...)` does.
Why: CSS lets an escape sequence like `\75 rl(https://…)` be read by the browser as `url(`, which
would otherwise smuggle a remote reference past the check above, and `@import` / `image-set(` are
separate constructs that can reach a network address without ever spelling `url(` at all. The
practical cost: a legitimate CSS escape (e.g. `content: "\201C"`) is refused too — write the
literal character instead of escaping it. (The app's content-security policy also refuses a
remote fetch if one ever slipped past this scan — a backstop, not a second rule an author needs
to reason about: the scan above is what actually decides whether your theme loads.)

### The stacking-context trap

`backdrop-filter`, `filter`, `transform`, `perspective`, `contain` and `will-change` each create a
new stacking context on the element they're applied to — not just a visual effect. Put one of
these on a CONTAINER (the app header, `body`, a wrapping element) and every popover
that lives inside it — a menu, a dropdown, a tooltip — gets trapped at that container's paint
position, no matter how high its own `z-index` is. `liquid-glass`'s header blur
(`backdrop-filter: blur(12px)` on the app header) is exactly this: the app's own CSS
already accounts for it, so the example still works, but a theme that puts one of these six
properties on a container the app does NOT already harden could bury a popup under the board
again.

If you need the effect, put it on a `::before`/background layer, or on a LEAF element (something
with no floating children of its own — a card, a panel) rather than a container that hosts a menu
or dropdown.

### No token needs to be opaque — the rail's wall is a genuine hole, not paint

This used to say the opposite: **`--bg-base` must be opaque.** That constraint is gone as of
2026-09-20 and nothing in this file replaces it — no token in a theme's `tokens` block has to be
one flat, opaque colour any more.

The sessions rail draws the highlighted row as a tab cut THROUGH the rail's right-hand wall. It
used to do that by painting over the wall: the tab overran it and filled those pixels with
`--bg-base`, plus two small radial-gradient "flares" to carry that fill around the concave corner
at each shoulder. Painting over a line only erases it if the paint is opaque, so a translucent
`--bg-base` showed the wall straight through the tab — the wall ran unbroken top to bottom with a
faint arc stranded inside it, a right-angled corner where the design has a curve. That is why this
section used to tell you to keep `--bg-base` opaque.

The rail no longer paints a wall on itself at all, and the active tab no longer paints over
anything. The rail's surface and its wall are drawn by three tiled layers instead, and the middle
one — the layer for the pinned active row's own slot — has the tab's silhouette, its shoulders and
the wall's column **cut out of it with a CSS mask**. A mask makes a hole; there is nothing under a
hole to be opaque or translucent, so the interruption holds regardless of what any token names.

**Everything may be as translucent as you like, `--bg-base` included** — `rgba()`, `transparent`,
whatever your design wants. `examples/liquid-glass` is built that way now: `"bg-base": "transparent"`,
with its `body` gradient (`theme.css`) showing straight through every panel that sits on it,
including the rail's own notch.

That is also the practical payoff: because `--bg-base` no longer has to be flat, **a theme may put
a gradient or an image behind the whole app** (a fixed `background` on `body` in your CSS file,
as `examples/liquid-glass/theme.css` does) instead of reaching for `backdrop-filter` alone (see
the stacking-context trap above, which still applies to any blur you layer on top).


## Light themes

`"colorScheme": "light"` plus a light token set. The app's own widgets follow it. See
[`examples/paper`](examples/paper/theme.json): tokens plus a small CSS file (ring shadows,
4/6/8 corners on controls, 10-14 px on floating layers, one joined board panel, Familjen Grotesk
and Martian Mono).

## Recovering from a broken theme

- A theme that fails a rule is listed under the picker as `Could not load: <id> (<reason>)`.
- If the CHOSEN theme fails, the app falls back to Default and keeps your choice; the Settings
  error line reads `Theme "<name>" could not be loaded, using Default`. Fix the file and press
  **Reload themes**.
- If a raw-CSS theme made the app unusable: rename or delete its folder and restart. The folder
  is re-read at start, and a missing theme falls back to Default.
- The terminal (`npm run dev`) or the app log prints `[claude-watcher][themes] code=<code> id=<id>
path=<field>`. Never the values.

## Examples

- [`examples/builtin-dark`](examples/builtin-dark/) — the built-in look as a package: every token and
  terminal key at its default. Generated; copy it and change values.
- [`examples/liquid-glass`](examples/liquid-glass/) — what the CSS file makes possible: translucent
  panels, `backdrop-filter`, a transparent terminal, and six lossless WebP wallpapers (Lake, the
  default; Bridge; Subway; Graphite; Aurora gradient; Warm smoke). Credits and licences:
  [`WALLPAPERS-LICENSE.md`](examples/liquid-glass/WALLPAPERS-LICENSE.md).
- [`examples/paper`](examples/paper/) — a light theme: ring shadows instead of borders, 4/6/8 corners on
  controls and 10-14 px on floating layers, one joined board panel, Familjen Grotesk + Martian Mono
  (bundled fonts).

## Editor support

Point `$schema` at [`theme.schema.json`](theme.schema.json) (the URL in the example above) and your
editor autocompletes every field and token name.
