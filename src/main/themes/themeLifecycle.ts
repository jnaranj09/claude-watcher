// Custom themes — `apply(id)`: load → on failure fall back to Default and KEEP the setting (D-7)
// → validate the bundle AT SOURCE → nativeTheme follows its scheme → push to the renderer.
// A pure state machine over injected `load` / `push` / `setNativeTheme` (the apiLifecycle
// pattern), so index.ts holds one line per event and nothing from Electron is in reach here.
// Nothing here throws: this runs inside the settings handler and did-finish-load.
import {
  DEFAULT_THEME_BUNDLE,
  ThemeBundleSchema,
  type ColorScheme,
  type ThemeApplyResult,
  type ThemeBundle
} from '../../shared/schemas/theme'
import type { ThemeLoadResult } from './themeCompose'

const LOG_PREFIX = '[claude-watcher][themes]'

export interface ThemeLifecycle {
  apply(id: string): ThemeApplyResult
  /** The last bundle pushed (Default until the first apply). */
  current(): ThemeBundle
}

export function createThemeLifecycle(opts: {
  load: (id: string) => ThemeLoadResult
  push: (bundle: ThemeBundle) => void
  setNativeTheme: (scheme: ColorScheme) => void
  log?: (message: string) => void
}): ThemeLifecycle {
  const log = opts.log ?? ((message: string): void => console.warn(message))
  let current: ThemeBundle = DEFAULT_THEME_BUNDLE

  function send(bundle: ThemeBundle): void {
    current = bundle
    try {
      opts.setNativeTheme(bundle.colorScheme)
    } catch {
      log(`${LOG_PREFIX} code=theme_native_theme_failed`)
    }
    try {
      opts.push(bundle)
    } catch {
      log(`${LOG_PREFIX} code=theme_push_failed`)
    }
  }

  function apply(id: string): ThemeApplyResult {
    let loaded: ThemeLoadResult
    try {
      loaded = opts.load(id)
    } catch {
      loaded = { ok: false, code: 'theme_read_failed' }
    }
    if (!loaded.ok) {
      log(
        `${LOG_PREFIX} code=theme_load_failed id=${id} reason=${loaded.code}${loaded.path !== undefined ? ` path=${loaded.path}` : ''}`
      )
      send(DEFAULT_THEME_BUNDLE)
      return { ok: false, id, code: loaded.code }
    }
    const checked = ThemeBundleSchema.safeParse(loaded.bundle)
    if (!checked.success) {
      const issue = checked.error.issues[0]
      log(`${LOG_PREFIX} code=theme_bundle_invalid id=${id} path=${issue?.path.join('.') ?? ''}`)
      send(DEFAULT_THEME_BUNDLE)
      return { ok: false, id, code: 'theme_manifest_invalid' }
    }
    send(checked.data)
    return { ok: true, id }
  }

  return { apply, current: () => current }
}
