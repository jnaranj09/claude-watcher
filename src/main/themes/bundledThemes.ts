// Bundled themes (spec docs/superpowers/specs/2026-09-25-bundled-themes-design.md) — the themes
// that ship READ-ONLY inside the app and update with it. electron-builder copies them from
// docs/themes/examples into <resourcesPath>/themes (`extraResources`); an unpackaged run (dev,
// drive, e2e — all execute out/main/index.js) reads the same folders straight from the repo.
// builtin-dark is NOT here: it is a copy of Default, kept as the docs' starting point.
import { join } from 'node:path'

/** The ONE list. `electron-builder.yml`'s extraResources filter must name the same ids
 *  (bundledThemes.test.ts); the scanner takes only these from the bundled folder. */
export const BUNDLED_THEME_IDS = ['liquid-glass', 'paper'] as const

export function bundledThemesDir(opts: {
  isPackaged: boolean
  resourcesPath: string
  /** `__dirname` of the built main bundle — `<repo>/out/main` in every unpackaged run. */
  mainDir: string
}): string {
  return opts.isPackaged
    ? join(opts.resourcesPath, 'themes')
    : join(opts.mainDir, '..', '..', 'docs', 'themes', 'examples')
}
