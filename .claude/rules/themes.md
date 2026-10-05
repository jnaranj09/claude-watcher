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
  in `settings.wallpaperByTheme`; unknown → first (`code=theme_wallpaper_not_found`).
- `nativeTheme.themeSource` + root `color-scheme` follow the theme's `colorScheme`
  (`themeLifecycle.ts`, `hooks/useApplyTheme.ts`).
- **Every renderer colour is a token** (`styles/noHexLiterals.test.ts`); `TOKENS` in
  `shared/theme/tokens.ts`.
- xterm `allowTransparency` follows the theme LIVE (set before `theme`). Creation-only left a
  Liquid-Glass-born terminal with thin text under Paper (the WebGL atlas draws see-through glyphs).
- Generated SDK (`docs/themes/THEMES.md`, `theme.schema.json`, `examples/builtin-dark`) is
  drift-tested: `npm run gen:theme-docs`. Rescan on start / Settings open / `Reload themes`.
