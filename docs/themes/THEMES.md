# claude-watcher themes

A theme is a folder you drop into the app's themes folder. The app reads it, checks it, and
offers it in **☰ → Settings… → Theme**. Nothing in a theme can crash the app: a package that
breaks a rule is listed with the reason and never applied.

The themes folder is `themes/` inside the app's data folder — on Linux
`~/.config/claude-watcher/themes/`. **Open themes folder** in Settings opens it.

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
| `focus-ring` | The keyboard focus outline on every control | `#b4befe` |
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
| `space-1` | 4px spacing step | `4px` |
| `space-2` | 8px spacing step | `8px` |
| `space-3` | 12px spacing step | `12px` |
| `space-4` | 16px spacing step | `16px` |
| `space-5` | 20px spacing step | `20px` |
| `space-6` | 24px spacing step | `24px` |
| `space-8` | 32px spacing step | `32px` |
| `topbar-height` | Height of the rail header and the focused view bar (they meet at the rail edge) | `45px` |
| `rail-width` | The attention rail width when expanded | `240px` |
| `rail-width-collapsed` | The attention rail width when collapsed | `70px` |
| `card-min-height` | Minimum session card height | `92px` |
| `gutter` | The board gutter on each side | `16px` |
| `card-gap` | The gap between cards in a column | `12px` |
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
  { "id": "graphite", "name": "Graphite", "file": "ground.png" },
  { "id": "aurora", "name": "Aurora gradient", "file": "aurora.jpg" }
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

## The CSS file

Loaded AFTER the tokens block, so it wins over everything — `!important` is never needed. The
cascade is: the app's own `tokens.css` → your `tokens` → your CSS file. Up to 1 MB.

What you can target:

- **Tokens.** Most looks are a token set. Translucent surfaces are just `rgba()` token values.
- **Elements and roles.** `body`, `[role="dialog"]`, `[role="menu"]`, `[role="listbox"]`.
- **Test ids.** `[data-testid="app-header"]`, `[data-testid="settings-panel"]`,
  `[data-testid="embedded-terminal"]` and the other `data-testid` attributes in the app. They are
  pinned by the app's tests, so they are stable.
- **Not class names.** CSS-module classes are hashed at build time and change between builds.

`url(...)` inside the CSS may name a file in the theme folder — `url(bg.png)`, `url("bg.png")` —
with one of these extensions: `png jpg jpeg gif webp svg woff woff2 ttf otf`. The app inlines it
as a `data:` URI. Every `url(...)` in the file must resolve this way; anything else (`http://…`,
`data:` already, `/abs`, `../x`, `sub/dir/x`, another extension) fails the theme. All assets
together may weigh at most 5 MB.

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
these on a CONTAINER (`[data-testid="app-header"]`, `body`, a wrapping element) and every popover
that lives inside it — a menu, a dropdown, a tooltip — gets trapped at that container's paint
position, no matter how high its own `z-index` is. `liquid-glass`'s header blur
(`[data-testid="app-header"] { backdrop-filter: blur(12px) }`) is exactly this: the app's own CSS
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
[`examples/paper`](examples/paper/theme.json): tokens only, no CSS.

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
  panels, `backdrop-filter`, a transparent terminal, and three wallpapers (Graphite; Aurora
  gradient by Mohammed Kareem on Unsplash; Warm smoke by SplitShire on Pexels).
- [`examples/paper`](examples/paper/) — a light theme, tokens only.

## Editor support

Point `$schema` at [`theme.schema.json`](theme.schema.json) (the URL in the example above) and your
editor autocompletes every field and token name.
