---
paths:
  - 'src/main/themes/**'
  - 'src/shared/theme/**'
  - 'src/shared/schemas/theme.ts'
  - 'docs/themes/**'
  - 'src/renderer/src/hooks/useApplyTheme.ts'
  - 'src/renderer/src/styles/**'
---

# Rule: custom themes (`src/main/themes/`)

Moved from CLAUDE.md on 2026-10-01 (context budget, technical-taste §5b-19); unchanged.

- Theme = `<userData>/themes/<id>/theme.json` (`shared/schemas/theme.ts`, `.strict()` — unknown
  key/token fails the whole theme) + optional CSS + assets. Main composes ONE stylesheet (tokens,
  CSS with `url()` inlined as `data:`, 5 MB cap) and pushes `ThemeBundle` over `CH.themeApplied`.
  The only other `url()` passed is a same-document fragment `url(#name)` (`FRAGMENT_REF`): the SVG
  filters the app ships in `renderer/index.html` (`#cw-text-refraction`). A new shared filter goes
  there and in THEMES.md's filter table.
- **Liquid Glass and Paper are bundled read-only** (`extraResources` →
  `<resourcesPath>/themes`; dev reads `docs/themes/examples`). `BUNDLED_THEME_IDS` is the one
  list. A user folder with a bundled id is skipped (`code=theme_id_reserved`). Smoke's
  `main.themes.pass` uses a probe scanner over an empty user folder.
- **Fail closed → Default, keep the setting** (`settings.themeId`):
  `code=theme_load_failed id= reason=`, Settings shows the error. Logs: code + zod path only.
- **Wallpapers:** only the chosen one inlined as `--theme-wallpaper`; all validated; pick per theme
  in `settings.wallpaperByTheme`; unknown → first (`code=theme_wallpaper_not_found`). Bundled
  wallpapers are LOSSLESS WebP (the dither survives; lossy banded, 2026-09-24); every listed file
  counts toward the 5 MB cap. Photo licences: the theme folder's `WALLPAPERS-LICENSE.md`.
- **WebGL glass (spec 2026-10-08):** optional `glass` key (`GlassSpecSchema`: renderer `webgl`,
  five surface materials with ranges and a per-surface `lightFollowsCursor`, every field required)
  → `ThemeBundle.glass`.
  `renderer/src/glass/GlassLayer` draws one canvas behind the UI from the `data-glass` hooks; it
  sets `data-glass-on` on `<html>` only after a good frame and removes it on any failure, context
  loss or unmount. Theme CSS clears hooked surfaces ONLY under `:root[data-glass-on]`, so its CSS
  glass is always the fallback (no WebGL2, reduced transparency, more contrast). Overlays (modals,
  popovers, toasts) are never drawn by the layer; for them the layer writes `--glass-light: <deg>`
  on the one overlay surface under the pointer (`glass/overlayLight.ts`; row, overlay button or
  toast; never under reduced motion) and the theme's CSS moves its rim. Logs:
  `[claude-watcher][glass] code=glass_*`.
- **Liquid Glass "white glow" is ONE standard (owner, 2026-10-09).** When the owner says the
  panels' / bubbles' white glow (or "the white", "too white"), they mean EVERY glass surface
  together: the WebGL ones (header, columns, cards, controls, fields) AND the CSS overlays
  (popovers and their rows, overlay buttons). A change moves all of these at once, by the same
  ratio, never one surface alone:
  `theme.json` `glass.surfaces.*.glow` (top light) and `*.lift` (white haze); `theme.css` under
  `:root[data-glass-on]`: `--glass-pop-glow`, `--glass-row-fill`, `--glass-control-sheen`.
  Then re-match on the drive: popover panel ≈ header, popover rows ≈ ☰ / New session. Then check
  that text contrast stays ≥ 4.5:1 on all six wallpapers. Pins: `themeExamples.test.ts`.
  `exposure` is NOT the glow (it brightens what shows through); leave it unless asked.
- **Public hooks (every theme):** `data-glass="header|column|card|control|field"` (values pinned to
  `GLASS_SURFACES` by `glassHooks.guard`), `data-app-menu`, `data-column-header`,
  `data-column-mark` (hidden by the app), `data-count-sep`, `data-focused-bar` (the focused view's
  top bar), `data-favorite="on|off"` (the favorite pin toggle), `data-favorite-row` (a popover row holding a pin; its row hover also covers `:has([data-favorite]:hover)`). Custom properties `--rail-surface` / `--rail-surface-top` (the rail's surface and its
  top bar row; the only way to change it — `AttentionRail.surface.styles.test`). `control` = enabled primary/secondary
  `Button` (not lit, busy or disabled), the workspace switcher and its elsewhere tab.
- `nativeTheme.themeSource` + root `color-scheme` follow the theme's `colorScheme`
  (`themeLifecycle.ts`, `hooks/useApplyTheme.ts`).
- **Every renderer colour is a token** (`styles/noHexLiterals.test.ts`); `TOKENS` in
  `shared/theme/tokens.ts`.
- xterm `allowTransparency` follows the theme LIVE (set before `theme`). Creation-only left a
  Liquid-Glass-born terminal with thin text under Paper (the WebGL atlas draws see-through glyphs).
- Generated SDK (`docs/themes/THEMES.md`, `theme.schema.json`, `examples/builtin-dark`) is
  drift-tested: `npm run gen:theme-docs`. Rescan on start / Settings open / `Reload themes`.
