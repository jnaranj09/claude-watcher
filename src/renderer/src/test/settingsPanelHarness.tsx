// The Settings panel test harness: the `window.api` and `window.themes` stubs the panel reads, the
// helpers that drive its inputs and categories, and the store reset every case ends with. Used by
// Settings.test and Settings.theme.test.
//
// Usage:
//   afterEach(() => {
//     cleanup?.()
//     resetSettingsPanel()
//   })
//   stubApi()
//   stubThemes([paper])
//   const r = renderComponent(<SettingsPanel />)
//   cleanup = r.unmount
//   openCategory(r, 'appearance')
import { act } from 'react'
import { vi } from 'vitest'
import { click, q, type RenderResult } from './renderComponent'
import { settingsStore } from '../stores/settingsStore'
import { themeStore } from '../stores/themeStore'
import { DEFAULT_SETTINGS } from '../../../shared/schemas/settings'
import { DEFAULT_THEME_BUNDLE, type ThemeSummary } from '../../../shared/schemas/theme'

/** After each case: restore spies, drop the `serverHealth` stub and put the singleton stores back. */
export function resetSettingsPanel(): void {
  vi.restoreAllMocks()
  delete (window as unknown as { serverHealth?: unknown }).serverHealth
  act(() => {
    settingsStore.getState().hydrate(DEFAULT_SETTINGS)
    themeStore.getState().setBundle(DEFAULT_THEME_BUNDLE)
  })
}

// ── Programmatic API — the window.api bridge the block reads ─────────────────────────────────
interface ApiBridge {
  getToken(): Promise<{ token: string }>
  regenerateToken(): Promise<{ token: string }>
}

/** Stub window.api. `getToken` answers `token`; `regenerateToken` answers 64 `b`s by default. */
export function stubApi(
  token = 'a'.repeat(64),
  overrides: Partial<ApiBridge> = {}
): { regenerate: ReturnType<typeof vi.fn> } {
  const regenerate = vi.fn(() => Promise.resolve({ token: 'b'.repeat(64) }))
  const bridge: ApiBridge = {
    getToken: () => Promise.resolve({ token }),
    regenerateToken: regenerate,
    ...overrides
  }
  ;(window as unknown as { api: ApiBridge }).api = bridge
  return { regenerate }
}

/** Stub window.themes. `list` answers `summaries`; `reload` answers ok on the default id. */
export function stubThemes(summaries: ThemeSummary[] = []): {
  list: ReturnType<typeof vi.fn>
  reload: ReturnType<typeof vi.fn>
  openFolder: ReturnType<typeof vi.fn>
} {
  const list = vi.fn(() => Promise.resolve(summaries))
  const reload = vi.fn(() => Promise.resolve({ ok: true as const, id: 'default' }))
  const openFolder = vi.fn(() => Promise.resolve())
  ;(window as unknown as { themes: unknown }).themes = {
    list,
    reload,
    openFolder,
    onApplied: () => () => {}
  }
  return { list, reload, openFolder }
}

/** Type into a React-controlled field the way the DOM does, so onChange fires. */
export function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** React 17+ delegates onBlur to the native `focusout` event — a `blur` Event never reaches it. */
export function blur(el: Element): void {
  act(() => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

/** Open one settings category by id. */
export function openCategory(r: RenderResult, id: string): void {
  click(q(r, `[data-testid="settings-category-${id}"] button`))
}
