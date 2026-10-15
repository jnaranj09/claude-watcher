// Settings — the UI tests (jsdom `unit` project).
//
// Renders the SettingsPanel against a stubbed window.settings + the singleton settings store.
// Asserts:
//   - the two-column shell: five categories (Notifications, Appearance, Terminal, Keyboard, API),
//     opening on Notifications, each showing exactly its own controls (spec 2026-09-29 §3);
//   - NO global-hotkey control (FR-8 row CUT);
//   - every control persists through window.settings.set;
//   - every control is labeled (accessibility floor);
//   - the API block, the Theme group, and the Keyboard chord recorder (moved from Shortcuts).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { SettingsPanel } from './Settings'
import { settingsStore } from '../../stores/settingsStore'
import { click, flush, q, renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption, selectedValue, optionValues, optionLabel } from '../../test/selectHarness'
import { DEFAULT_SETTINGS, type Settings } from '../../../../shared/schemas/settings'
import { mergedSettings, stubSettings } from '../../test/settingsBridge'
import type { ThemeSummary } from '../../../../shared/schemas/theme'
import { themeStore } from '../../stores/themeStore'
import { DEFAULT_THEME_BUNDLE } from '../../../../shared/schemas/theme'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
  delete (window as unknown as { serverHealth?: unknown }).serverHealth
  // Reset the singleton store between tests.
  act(() => {
    settingsStore.getState().hydrate(DEFAULT_SETTINGS)
    themeStore.getState().setBundle(DEFAULT_THEME_BUNDLE)
  })
})

// ── Programmatic API — the window.api + window.clipboard bridges the block reads ──────────────
interface ApiBridge {
  getToken(): Promise<{ token: string }>
  regenerateToken(): Promise<{ token: string }>
}

/** Stub window.api. `getToken` answers `token`; `regenerateToken` answers 64 `b`s by default. */
function stubApi(
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
function stubThemes(summaries: ThemeSummary[] = []): {
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

/** Stub window.clipboard — the ONE OS-clipboard seam (env.d.ts: never navigator.clipboard). */
function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(() => Promise.resolve())
  ;(window as unknown as { clipboard: unknown }).clipboard = {
    writeText,
    readText: () => Promise.resolve('')
  }
  return writeText
}

/** Type into a React-controlled field the way the DOM does, so onChange fires. */
function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** React 17+ delegates onBlur to the native `focusout` event — a `blur` Event never reaches it. */
function blur(el: Element): void {
  act(() => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

describe('SettingsPanel — the controls it offers, no hotkey (AC-4)', () => {
  it('has NO hotkey/keybinding control (FR-8 row CUT)', () => {
    stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    const text = container.textContent?.toLowerCase() ?? ''
    expect(text).not.toContain('hotkey')
    expect(text).not.toContain('keybind')
    expect(text).not.toContain('shortcut')
  })

  it('every control is labeled (accessibility floor — label + control)', () => {
    stubSettings()
    stubApi()
    stubThemes()
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    const { container } = r
    expect(container.querySelector('label[for="settings-sound-enabled"]')).not.toBeNull()
    expect(
      container.querySelector('[data-testid="settings-reminder-count"]')?.getAttribute('aria-label')
    ).toBe('Reminders')
    expect(
      container
        .querySelector('[data-testid="settings-reminder-first-delay"]')
        ?.getAttribute('aria-label')
    ).toBe('First reminder after')
    openCategory(r, 'terminal')
    expect(container.querySelector('label[for="settings-terminal-font-size"]')).not.toBeNull()
    openCategory(r, 'api')
    expect(container.querySelector('label[for="settings-api-enabled"]')).not.toBeNull()
    expect(container.querySelector('label[for="settings-api-port"]')).not.toBeNull()
  })
})

/** Set a React-controlled input's value via the NATIVE prototype setter, then dispatch the
 *  event React listens for. React tracks the value on the element via its own descriptor, so a
 *  plain `el.value = x` is ignored by onChange — the native setter + an `input`/`change` event is
 *  the standard way to drive a controlled input in a jsdom test without React Testing Library. */
function setReactCheckbox(el: HTMLInputElement, checked: boolean): void {
  const proto = window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'checked')?.set
  setter?.call(el, checked)
  act(() => {
    el.dispatchEvent(new Event('click', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function setReactRange(el: HTMLInputElement, value: string): void {
  const proto = window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('SettingsPanel — controls persist via window.settings.set (AC-4/5)', () => {
  it('toggling sound calls window.settings.set({ soundEnabled })', () => {
    const stub = stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount

    const toggle = container.querySelector(
      '[data-testid="settings-sound-toggle"]'
    ) as HTMLInputElement
    // Default is ON; toggling sets it OFF.
    setReactCheckbox(toggle, false)
    expect(stub.setCalls).toContainEqual({ soundEnabled: false })
  })

  it('toggling desktop notifications calls window.settings.set({ notificationsEnabled }) (UX-13)', () => {
    const stub = stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount

    const toggle = container.querySelector(
      '[data-testid="settings-notifications-toggle"]'
    ) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    setReactCheckbox(toggle, false)
    expect(stub.setCalls).toContainEqual({ notificationsEnabled: false })
  })

  it('changing font-size calls window.settings.set({ terminalFontSize })', () => {
    const stub = stubSettings()
    stubThemes()
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'terminal')

    const range = r.container.querySelector(
      '[data-testid="settings-font-size"]'
    ) as HTMLInputElement
    setReactRange(range, '20')
    expect(stub.setCalls).toContainEqual({ terminalFontSize: 20 })
  })
})

// The panel is back to the TWO controls Story 2.4 froze it at. A third "background work
// gives up after" window shipped with the background-work latch and was removed once the
// probe showed claude announces the end of background work itself (a finished task wakes
// the session → a fresh `Stop` with an empty `background_tasks` → the card corrects itself
// in ~4s). This asserts the control is really GONE from the rendered panel, so it cannot
// come back by accident and leave operators a knob wired to nothing.
describe('SettingsPanel — the retired background-work window is not rendered', () => {
  it('renders no background-timeout control', () => {
    stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount

    expect(container.querySelector('[data-testid="settings-background-timeout"]')).toBeNull()
  })
})

describe('SettingsPanel — attention reminders (spec 2026-09-10)', () => {
  it('shows the stored values: 3 reminders, first after 2 min', () => {
    stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    expect(selectedValue(container, 'settings-reminder-count')).toBe('3')
    expect(selectedValue(container, 'settings-reminder-first-delay')).toBe('2')
  })

  it('offers Off and 1–5 reminders', () => {
    stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    expect(optionValues(container, 'settings-reminder-count')).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5'
    ])
    expect(optionLabel(container, 'settings-reminder-count', '0')).toBe('Off')
  })

  it('offers first delays of exactly 1, 2, 5, 10, 15 min', () => {
    stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    expect(optionValues(container, 'settings-reminder-first-delay')).toEqual([
      '1',
      '2',
      '5',
      '10',
      '15'
    ])
    expect(optionLabel(container, 'settings-reminder-first-delay', '10')).toBe('10 min')
  })

  it('the helper line reads the reminder times for the current values', () => {
    stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    expect(container.querySelector('[data-testid="settings-reminder-summary"]')?.textContent).toBe(
      'For permission prompts and questions: +2, +6, +14 min'
    )
  })

  it('choosing Off persists { reminderCount: 0 }, hides the delay row, and says Off', () => {
    const stub = stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    chooseOption(container, 'settings-reminder-count', '0')
    expect(stub.setCalls).toContainEqual({ reminderCount: 0 })
    expect(container.querySelector('[data-testid="settings-reminder-first-delay"]')).toBeNull()
    expect(container.querySelector('[data-testid="settings-reminder-summary"]')?.textContent).toBe(
      'Off — one alert per permission prompt or question'
    )
  })

  it('choosing 5 min persists { reminderFirstDelayMinutes: 5 }', () => {
    const stub = stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    chooseOption(container, 'settings-reminder-first-delay', '5')
    expect(stub.setCalls).toContainEqual({ reminderFirstDelayMinutes: 5 })
  })

  // Controller Ruling 8 (fix round 1): spec §4 says the two reminder rows go directly after
  // Attention sound — sound and reminders are both attention settings, so they belong together.
  it('the Notifications rows appear in order: sound, popups, reminders, first delay (spec §4)', () => {
    stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    const orderedIds = [
      'settings-sound-toggle',
      'settings-notifications-toggle',
      'settings-reminder-count',
      'settings-reminder-first-delay'
    ]
    const panel = container.querySelector('[data-testid="settings-panel"]')
    const seen = [...(panel?.querySelectorAll('[data-testid]') ?? [])]
      .map((el) => el.getAttribute('data-testid'))
      .filter((id): id is string => id !== null && orderedIds.includes(id))
    expect(seen).toEqual(orderedIds)
  })
})

// ── Programmatic API — the Settings block (spec 2026-09-15) ───────────────────────────────────
// The block is OFF by default. While off it shows only the toggle and the port; the token, its
// Copy/Regenerate buttons and the docs URL are not rendered at all (design.md: a control the
// operator must not use is not rendered). Regenerate is destructive, so it ARMS IN PLACE through
// the shared `ManageDialog.Delete` — the only place the armed-button classes live.
describe('SettingsPanel — the local API block', () => {
  function render(): RenderResult {
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'api')
    return r
  }

  it('shows the toggle off with the port, and hides the token while off', async () => {
    stubSettings()
    stubApi()
    stubThemes()
    const r = render()
    await flush()
    expect(q<HTMLInputElement>(r, '[data-testid="settings-api-enabled"]').checked).toBe(false)
    expect(q<HTMLInputElement>(r, '[data-testid="settings-api-port"]').value).toBe('9281')
    expect(r.container.querySelector('[data-testid="settings-api-token"]')).toBeNull()
    expect(r.container.querySelector('[data-testid="settings-api-copy"]')).toBeNull()
    expect(r.container.querySelector('[data-testid="settings-api-regenerate"]')).toBeNull()
    expect(r.container.querySelector('[data-testid="settings-api-docs-url"]')).toBeNull()
  })

  it('turning it on patches apiEnabled and reveals the token, Copy, Regenerate and the docs URL', async () => {
    const { setCalls } = stubSettings()
    stubApi('a'.repeat(64))
    stubThemes()
    const r = render()
    await flush()
    click(q(r, '[data-testid="settings-api-enabled"]'))
    await flush()
    expect(setCalls).toContainEqual({ apiEnabled: true })
    expect(q<HTMLInputElement>(r, '[data-testid="settings-api-token"]').value).toBe('a'.repeat(64))
    expect(q(r, '[data-testid="settings-api-copy"]').textContent).toMatch(/^Copy/)
    expect(q(r, '[data-testid="settings-api-regenerate"]').textContent).toMatch(/^Regenerate/)
    expect(q(r, '[data-testid="settings-api-docs-url"]').textContent).toBe(
      'http://127.0.0.1:9281/docs'
    )
  })

  // R11 — a bind that failed must not keep advertising a Docs URL nobody answers on.
  it('while main reports the API port in use, it says so INSTEAD of the Docs URL', async () => {
    stubSettings()
    stubApi('b'.repeat(64))
    stubThemes()
    ;(window as unknown as { serverHealth: unknown }).serverHealth = {
      get: () => Promise.resolve({ hooks: 'ok', hookPort: 9279, api: 'port_in_use' }),
      onChanged: () => () => {}
    }
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    const r = render()
    await flush()
    expect(r.container.querySelector('[data-testid="settings-api-docs-url"]')).toBeNull()
    expect(q(r, '[data-testid="settings-api-down"]').textContent).toContain(
      'port 9281 is used by another program'
    )
  })

  it('the token is read-only — the operator copies it, never edits it', async () => {
    stubSettings()
    stubApi('c'.repeat(64))
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    stubThemes()
    const r = render()
    await flush()
    expect(q<HTMLInputElement>(r, '[data-testid="settings-api-token"]').readOnly).toBe(true)
  })

  it('the port is committed on blur only when it is a valid integer in range', async () => {
    const { setCalls } = stubSettings()
    stubApi()
    stubThemes()
    const r = render()
    await flush()
    const port = q<HTMLInputElement>(r, '[data-testid="settings-api-port"]')
    type(port, '9300')
    blur(port)
    await flush()
    expect(setCalls).toContainEqual({ apiPort: 9300 })

    type(port, '80')
    blur(port)
    await flush()
    expect(setCalls).not.toContainEqual({ apiPort: 80 })
    expect(port.getAttribute('aria-invalid')).toBe('true')
  })

  it('a port above the range is refused too', async () => {
    const { setCalls } = stubSettings()
    stubApi()
    stubThemes()
    const r = render()
    await flush()
    const port = q<HTMLInputElement>(r, '[data-testid="settings-api-port"]')
    type(port, '70000')
    blur(port)
    await flush()
    expect(setCalls).not.toContainEqual({ apiPort: 70000 })
    expect(port.getAttribute('aria-invalid')).toBe('true')
  })

  // design.md (TextInput): `aria-invalid` is NEVER the only signal — the block's error line has
  // to say what is wrong (UX-DR29). The copy names the range, so the operator can fix it without
  // guessing. Asserted as a literal, not rebuilt from API_PORT_MIN/MAX: a test that composes the
  // sentence the same way the component does cannot catch the sentence changing.
  it('a refused port says why on the error line, and a good one clears it', async () => {
    stubSettings()
    stubApi()
    stubThemes()
    const r = render()
    await flush()
    const port = q<HTMLInputElement>(r, '[data-testid="settings-api-port"]')

    type(port, '80')
    blur(port)
    await flush()
    const line = q(r, '[data-testid="settings-error"]')
    expect(line.getAttribute('role')).toBe('alert')
    expect(line.textContent).toBe('Port must be between 1024 and 65535.')

    type(port, '9300')
    blur(port)
    await flush()
    expect(r.container.querySelector('[data-testid="settings-error"]')).toBeNull()
  })

  it('Copy writes the token to the clipboard', async () => {
    stubSettings()
    stubApi('c'.repeat(64))
    const writeText = stubClipboard()
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    stubThemes()
    const r = render()
    await flush()
    click(q(r, '[data-testid="settings-api-copy"]'))
    await flush()
    expect(writeText).toHaveBeenCalledWith('c'.repeat(64))
  })

  it('Regenerate arms in place, then replaces the token', async () => {
    stubSettings()
    const { regenerate } = stubApi('a'.repeat(64))
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    stubThemes()
    const r = render()
    await flush()
    const btn = q<HTMLButtonElement>(r, '[data-testid="settings-api-regenerate"]')
    click(btn)
    expect(btn.textContent).toMatch(/^Confirm regenerate/)
    expect(regenerate).not.toHaveBeenCalled()
    click(btn)
    await flush()
    expect(regenerate).toHaveBeenCalledTimes(1)
    expect(q<HTMLInputElement>(r, '[data-testid="settings-api-token"]').value).toBe('b'.repeat(64))
    // The flow is OVER: the button must fall back to its resting label. `ManageDialog.Delete`
    // never disarms itself (a refused delete stays armed so a second press retries) — the host
    // disarms it, and without that the next single press regenerates with no arming step.
    // The flow is over: disarmed, and the result shows on the live region (spec 2026-09-29 §2.1).
    expect(btn.hasAttribute('data-armed')).toBe(false)
    expect(btn.textContent).toMatch(/^Regenerate/)
    expect(btn.nextElementSibling?.textContent).toBe('✓ New token')
  })

  // Main rejects when it minted a token it could not persist (`token_write_failed`). Showing the
  // new token then would be a lie — the old one is still the live credential. Never render the
  // raw message: map the code to operator copy (design.md).
  it('a regenerate main could not persist keeps the old token and says so on the error line', async () => {
    stubSettings()
    stubApi('a'.repeat(64), {
      regenerateToken: () => Promise.reject(new Error('token_write_failed: EACCES'))
    })
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    stubThemes()
    const r = render()
    await flush()
    const btn = q<HTMLButtonElement>(r, '[data-testid="settings-api-regenerate"]')
    click(btn)
    click(btn)
    await flush()
    expect(q<HTMLInputElement>(r, '[data-testid="settings-api-token"]').value).toBe('a'.repeat(64))
    const line = q(r, '[data-testid="settings-error"]')
    expect(line.getAttribute('role')).toBe('alert')
    expect(line.textContent).toBe('Could not save the new token.')
    expect(r.container.textContent).not.toContain('EACCES')
    // A REFUSED action stays armed, so one more press retries it — the component's own
    // documented behaviour, and the opposite of the success path above.
    expect(btn.textContent).toMatch(/^Confirm regenerate/)
  })

  it('a token read that fails shows mapped copy and does not crash the panel', async () => {
    stubSettings()
    stubApi('a'.repeat(64), {
      getToken: () => Promise.reject(new Error('no handler for api:token-get'))
    })
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    stubThemes()
    const r = render()
    await flush()
    expect(q<HTMLInputElement>(r, '[data-testid="settings-api-token"]').value).toBe('')
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe('Could not read the API token.')
    expect(r.container.textContent).not.toContain('no handler')
  })

  // The block needs a ManageDialog.Provider (Delete/Error read that context and throw without
  // one), but the Provider renders NO DOM — the Settings panel stays the only dialog here.
  it('the panel is ONE dialog — the API block adds no second overlay', async () => {
    stubSettings()
    stubApi()
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    stubThemes()
    const r = render()
    await flush()
    expect(r.container.querySelectorAll('[role="dialog"]').length).toBe(1)
    expect(r.container.querySelector('[data-testid="settings-api-overlay"]')).toBeNull()
    expect(r.container.querySelector('[data-testid="settings-api-panel"]')).toBeNull()
  })
})

describe('SettingsPanel — the Theme group (spec 2026-09-20)', () => {
  const glass: ThemeSummary = { id: 'liquid-glass', name: 'Liquid Glass', colorScheme: 'dark' }
  const paper: ThemeSummary = { id: 'paper', name: 'Paper', colorScheme: 'light' }
  const broken: ThemeSummary = {
    id: 'broken',
    name: 'broken',
    colorScheme: 'dark',
    error: 'theme_css_missing'
  }

  it('lists themes on open: Default first, then the loadable ones by name; broken ones in the helper line only', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes([paper, glass, broken])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(themes.list).toHaveBeenCalledTimes(1)
    expect(optionValues(r.container, 'settings-theme')).toEqual([
      'default',
      'liquid-glass',
      'paper'
    ])
    expect(selectedValue(r.container, 'settings-theme')).toBe('default')
    expect(q(r, '[data-testid="settings-theme-broken"]').textContent).toBe(
      'Could not load: broken (missing theme.css)'
    )
  })

  it('hides the helper line when nothing is broken', async () => {
    stubSettings()
    stubApi()
    stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(r.container.querySelector('[data-testid="settings-theme-broken"]')).toBeNull()
  })

  it('choosing a theme persists { themeId }', async () => {
    const { setCalls } = stubSettings()
    stubApi()
    stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    chooseOption(r.container, 'settings-theme', 'paper')
    expect(setCalls).toEqual([{ themeId: 'paper' }])
  })

  it('Terminal colours: opens on Follow theme, offers Dark and Light, and persists the pick', async () => {
    const { setCalls } = stubSettings()
    stubApi()
    stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(optionValues(r.container, 'settings-terminal-scheme')).toEqual([
      'theme',
      'dark',
      'light'
    ])
    expect(selectedValue(r.container, 'settings-terminal-scheme')).toBe('theme')
    chooseOption(r.container, 'settings-terminal-scheme', 'dark')
    expect(setCalls).toEqual([{ terminalScheme: 'dark' }])
  })

  it('Copy/paste menu click: opens on Right-click, offers the modifiers, and persists the pick', async () => {
    const { setCalls } = stubSettings()
    stubApi()
    stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'terminal')
    await flush()
    expect(optionValues(r.container, 'settings-terminal-menu-trigger')).toEqual([
      'right-click',
      'shift-right-click',
      'ctrl-right-click'
    ])
    expect(selectedValue(r.container, 'settings-terminal-menu-trigger')).toBe('right-click')
    expect(r.container.textContent).toContain('full-screen renderer with mouse support')
    chooseOption(r.container, 'settings-terminal-menu-trigger', 'shift-right-click')
    expect(setCalls).toEqual([{ terminalMenuTrigger: 'shift-right-click' }])
  })

  it('Reload themes reloads, then re-lists', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    click(q(r, '[data-testid="settings-theme-reload"]'))
    await flush()
    expect(themes.reload).toHaveBeenCalledTimes(1)
    expect(themes.list).toHaveBeenCalledTimes(2)
  })

  it('Open themes folder asks main', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes()
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    click(q(r, '[data-testid="settings-theme-open-folder"]'))
    expect(themes.openFolder).toHaveBeenCalledTimes(1)
  })

  it('a refused Open themes folder shows mapped copy on the one error line', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes()
    themes.openFolder.mockImplementation(() => Promise.reject(new Error('ENOENT: no such file')))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    click(q(r, '[data-testid="settings-theme-open-folder"]'))
    await flush()
    const line = q(r, '[data-testid="settings-error"]')
    expect(line.getAttribute('role')).toBe('alert')
    expect(line.textContent).toBe('Could not open the themes folder.')
    expect(r.container.textContent).not.toContain('ENOENT')
  })

  it('when the chosen theme is not the applied one, the error line names the reason and the picker keeps the choice', async () => {
    stubSettings()
    stubApi()
    stubThemes([broken])
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'broken' }))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Theme "broken" could not be loaded, using Default — missing theme.css'
    )
    expect(selectedValue(r.container, 'settings-theme')).toBe('broken')
    expect(optionValues(r.container, 'settings-theme')).toEqual(['default', 'broken'])
  })

  // Finding 1(b) end-to-end: a theme whose MANIFEST is fine but whose CSS is broken (here, a
  // remote url()) must (1) be absent from the picker's loadable options, (2) appear in the
  // broken-themes line with its reason, and (3) — if it is the CHOSEN theme (e.g. it broke after
  // it was picked) — the error line names the SAME reason, not just "could not be loaded".
  it('a CSS-level broken theme (fine manifest, bad CSS) is unpickable, listed broken, and named when chosen', async () => {
    const remoteCss: ThemeSummary = {
      id: 'remote-css',
      name: 'Remote CSS',
      colorScheme: 'dark',
      error: 'theme_css_url_invalid'
    }
    stubSettings()
    stubApi()
    stubThemes([paper, remoteCss])
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'remote-css' }))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    // (1) not among the loadable options — only the chosen-but-broken id is pinned in, kept so
    // the picker never sits on a value it does not offer (design.md).
    expect(optionValues(r.container, 'settings-theme')).toEqual(['default', 'paper', 'remote-css'])
    // (2) listed in the broken-themes helper line with its reason.
    expect(q(r, '[data-testid="settings-theme-broken"]').textContent).toBe(
      'Could not load: remote-css (a disallowed url(), @import, image-set() or escape in the CSS)'
    )
    // (3) the chosen-theme error line names the same reason.
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Theme "Remote CSS" could not be loaded, using Default — a disallowed url(), @import, image-set() or escape in the CSS'
    )
  })

  it('a reload() that rejects sets mapped copy on the one error line, never the raw error', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes([paper])
    themes.reload.mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    click(q(r, '[data-testid="settings-theme-reload"]'))
    await flush()
    const line = q(r, '[data-testid="settings-error"]')
    expect(line.textContent).toBe('Could not reload themes.')
    expect(r.container.textContent).not.toContain('ECONNREFUSED')
  })

  // R12 — the theme error is a STANDING condition, not an event: an unrelated flow that clears the
  // shared line (a good port, the API switched off) must not hide it while the theme is still broken.
  it('a still-broken theme keeps its error line through an API change that clears the line', async () => {
    const base: Settings = { ...DEFAULT_SETTINGS, themeId: 'broken', apiEnabled: true }
    // Main's answer keeps the broken theme chosen (the stub's default answer would reset it).
    stubSettings((patch) =>
      Promise.resolve({
        ...base,
        apiPort: patch.apiPort ?? base.apiPort,
        apiEnabled: patch.apiEnabled ?? base.apiEnabled
      })
    )
    stubApi()
    stubThemes([broken])
    act(() => settingsStore.getState().hydrate(base))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'api')
    await flush()
    const port = q<HTMLInputElement>(r, '[data-testid="settings-api-port"]')
    type(port, '9300')
    blur(port)
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Theme "broken" could not be loaded, using Default — missing theme.css'
    )
    click(q(r, '[data-testid="settings-api-enabled"]'))
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toContain('could not be loaded')
  })

  it('an API refusal still shows once the theme loads again', async () => {
    stubSettings()
    stubApi()
    stubThemes([broken])
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'broken' }))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'api')
    await flush()
    const port = q<HTMLInputElement>(r, '[data-testid="settings-api-port"]')
    type(port, '80')
    blur(port)
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toContain('could not be loaded')
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'default' }))
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Port must be between 1024 and 65535.'
    )
  })

  // R12 (related) — picking a theme updates the setting at once, and the bundle lands a moment
  // later: the gap read as "could not be loaded" on every switch.
  it('no false alarm while a theme switch is in flight; the real outcome shows after', async () => {
    let answer: (() => void) | undefined
    stubSettings(
      (patch) =>
        new Promise((resolve) => {
          answer = () => resolve(mergedSettings(patch))
        })
    )
    stubApi()
    stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    chooseOption(r.container, 'settings-theme', 'paper')
    await flush()
    expect(r.container.querySelector('[data-testid="settings-error"]')).toBeNull()
    // Main answered without a paper bundle: the theme really failed, so now it is said.
    await act(async () => {
      answer?.()
      await Promise.resolve()
    })
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toContain(
      'Theme "Paper" could not be loaded'
    )
  })

  it('no error line when the chosen theme is the applied one', async () => {
    stubSettings()
    stubApi()
    stubThemes([paper])
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'paper' }))
    act(() =>
      themeStore
        .getState()
        .setBundle({ ...DEFAULT_THEME_BUNDLE, id: 'paper', name: 'Paper', colorScheme: 'light' })
    )
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(r.container.querySelector('[data-testid="settings-error"]')).toBeNull()
  })

  it('shows the transparency hint only while the applied theme sets allowTransparency', async () => {
    stubSettings()
    stubApi()
    stubThemes([glass])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(r.container.querySelector('[data-testid="settings-theme-transparency"]')).toBeNull()
    act(() =>
      themeStore.getState().setBundle({
        ...DEFAULT_THEME_BUNDLE,
        id: 'liquid-glass',
        name: 'Liquid Glass',
        terminal: { allowTransparency: true }
      })
    )
    expect(q(r, '[data-testid="settings-theme-transparency"]').textContent).toBe(
      'Transparency applies to terminals opened from now on.'
    )
  })

  it('a list that fails shows mapped copy on the one error line and keeps Default selectable', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes()
    themes.list.mockImplementation(() => Promise.reject(new Error('boom')))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Could not read the themes folder.'
    )
    expect(optionValues(r.container, 'settings-theme')).toEqual(['default'])
  })
  describe('Wallpaper (spec 2026-09-24)', () => {
    const two: ThemeSummary = {
      id: 'liquid-glass',
      name: 'Liquid Glass',
      colorScheme: 'dark',
      wallpapers: [
        { id: 'graphite', name: 'Graphite' },
        { id: 'aurora', name: 'Aurora gradient' }
      ]
    }
    const applied = {
      ...DEFAULT_THEME_BUNDLE,
      id: 'liquid-glass',
      name: 'Liquid Glass',
      wallpaperId: 'graphite'
    }
    const chooseGlass = (): void =>
      act(() => {
        settingsStore.getState().hydrate({
          ...DEFAULT_SETTINGS,
          themeId: 'liquid-glass',
          wallpaperByTheme: { paper: 'x' }
        })
        themeStore.getState().setBundle(applied)
      })
    const wallpaperSelect = (c: HTMLElement): Element | null =>
      c.querySelector('[data-testid="settings-wallpaper"]')

    it('shows the applied theme wallpapers, on the applied one', async () => {
      stubSettings()
      stubApi()
      stubThemes([two])
      chooseGlass()
      const r = renderComponent(<SettingsPanel />)
      cleanup = r.unmount
      openCategory(r, 'appearance')
      await flush()
      expect(optionValues(r.container, 'settings-wallpaper')).toEqual(['graphite', 'aurora'])
      expect(selectedValue(r.container, 'settings-wallpaper')).toBe('graphite')
    })

    it('picking one persists the WHOLE map with this theme updated', async () => {
      const { setCalls } = stubSettings()
      stubApi()
      stubThemes([two])
      chooseGlass()
      const r = renderComponent(<SettingsPanel />)
      cleanup = r.unmount
      openCategory(r, 'appearance')
      await flush()
      chooseOption(r.container, 'settings-wallpaper', 'aurora')
      expect(setCalls).toEqual([{ wallpaperByTheme: { paper: 'x', 'liquid-glass': 'aurora' } }])
    })

    it('is not rendered for a theme with one wallpaper', async () => {
      stubSettings()
      stubApi()
      stubThemes([{ ...two, wallpapers: [{ id: 'graphite', name: 'Graphite' }] }])
      chooseGlass()
      const r = renderComponent(<SettingsPanel />)
      cleanup = r.unmount
      openCategory(r, 'appearance')
      await flush()
      expect(wallpaperSelect(r.container)).toBeNull()
    })

    it('is not rendered while the chosen theme failed and Default is applied', async () => {
      stubSettings()
      stubApi()
      stubThemes([two])
      act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'liquid-glass' })) // bundle stays DEFAULT_THEME_BUNDLE
      const r = renderComponent(<SettingsPanel />)
      cleanup = r.unmount
      openCategory(r, 'appearance')
      await flush()
      expect(wallpaperSelect(r.container)).toBeNull()
    })

    it("is not rendered while the applied bundle is ANOTHER theme's (a switch not yet landed)", async () => {
      stubSettings()
      stubApi()
      const paperTwo: ThemeSummary = { ...two, id: 'paper', name: 'Paper' }
      stubThemes([two, paperTwo])
      act(() => {
        settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'paper' })
        themeStore.getState().setBundle(applied) // still liquid-glass, wallpaperId 'graphite'
      })
      const r = renderComponent(<SettingsPanel />)
      cleanup = r.unmount
      openCategory(r, 'appearance')
      await flush()
      expect(wallpaperSelect(r.container)).toBeNull()
    })

    it('is not rendered on Default', async () => {
      stubSettings()
      stubApi()
      stubThemes([two])
      const r = renderComponent(<SettingsPanel />)
      cleanup = r.unmount
      openCategory(r, 'appearance')
      await flush()
      expect(wallpaperSelect(r.container)).toBeNull()
    })
  })
})

// ── Categories (spec 2026-09-29 §3) ───────────────────────────────────────────────────────────
// Settings is the two-column shell: a rail of categories, the chosen one's controls on the right.
function renderPanel(): RenderResult {
  const r = renderComponent(<SettingsPanel onClose={() => {}} />)
  cleanup = r.unmount
  return r
}

function openCategory(r: RenderResult, id: string): void {
  click(q(r, `[data-testid="settings-category-${id}"] button`))
}

describe('Settings in categories (spec 2026-09-29 §3)', () => {
  it('is the shell: settings-overlay > settings-panel, a ✕, and five categories in order', () => {
    stubSettings()
    stubThemes()
    const r = renderPanel()
    expect(q(r, '[data-testid="settings-overlay"]').getAttribute('role')).toBe('dialog')
    expect(q(r, '[data-testid="settings-overlay"] [data-testid="settings-panel"]')).toBeTruthy()
    expect(q(r, '[data-testid="settings-close"]')).toBeTruthy()
    const rows = [...r.container.querySelectorAll('[data-testid^="settings-category-"]')]
    expect(rows.map((row) => row.textContent)).toEqual([
      'Notifications',
      'Appearance',
      'Terminal',
      'Keyboard',
      'API'
    ])
  })

  it('opens on Notifications — never a placeholder', () => {
    stubSettings()
    stubThemes()
    const r = renderPanel()
    expect(
      q(r, '[data-testid="settings-category-notifications"]').getAttribute('data-selected')
    ).toBe('true')
    expect(
      q(r, '[data-testid="settings-category-notifications"] button').getAttribute('aria-current')
    ).toBe('page')
    expect(q(r, '[data-testid="settings-sound-toggle"]')).toBeTruthy()
    expect(r.container.querySelector('[data-testid="settings-theme"]')).toBeNull()
    // The rail row already names the page; the pane repeats no title (spec 2026-10-07 A.7).
    expect(r.container.querySelector('h3')).toBeNull()
  })

  it('the on/off settings are switches', () => {
    stubSettings()
    stubThemes()
    const r = renderPanel()
    for (const id of ['settings-sound-toggle', 'settings-notifications-toggle']) {
      expect(q(r, `[data-testid="${id}"]`).getAttribute('role'), id).toBe('switch')
    }
    openCategory(r, 'api')
    expect(q(r, '[data-testid="settings-api-enabled"]').getAttribute('role')).toBe('switch')
  })

  it('each pane draws its fields inside ONE [data-settings-group] (a theme hook)', () => {
    stubSettings()
    stubThemes()
    const r = renderPanel()
    const groups = r.container.querySelectorAll(
      '[data-testid="settings-pane-notifications"] [data-settings-group]'
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.querySelector('[data-testid="settings-sound-toggle"]')).not.toBeNull()
    expect(groups[0]?.querySelector('[data-testid="settings-reminder-summary"]')).not.toBeNull()
  })

  // Guard: an on/off setting is a Switch, never the native blue checkbox.
  it('Settings.tsx renders no bare checkbox', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/Settings/Settings.tsx'),
      'utf8'
    )
    expect(src).not.toMatch(/type="checkbox"/)
  })

  const ALL_CONTROLS = [
    'settings-sound-toggle',
    'settings-notifications-toggle',
    'settings-reminder-count',
    'settings-theme',
    'settings-theme-reload',
    'settings-theme-open-folder',
    'settings-font-size',
    'chord-recorder',
    'settings-api-enabled',
    'settings-api-port'
  ]
  it.each([
    [
      'notifications',
      ['settings-sound-toggle', 'settings-notifications-toggle', 'settings-reminder-count']
    ],
    ['appearance', ['settings-theme', 'settings-theme-reload', 'settings-theme-open-folder']],
    ['terminal', ['settings-font-size']],
    ['keyboard', ['chord-recorder']],
    ['api', ['settings-api-enabled', 'settings-api-port']]
  ])('the %s category shows exactly its own controls', (id, ids) => {
    stubSettings()
    stubApi()
    stubThemes()
    const r = renderPanel()
    openCategory(r, id)
    for (const tid of ALL_CONTROLS) {
      const present = r.container.querySelector(`[data-testid="${tid}"]`) !== null
      expect(present, tid).toBe(ids.includes(tid))
    }
  })

  // Review Focus 3 — the standing theme error is dialog-wide.
  it('shows the theme error on the error line while another category is open', async () => {
    stubSettings()
    stubApi()
    stubThemes([{ id: 'broken', name: 'broken', colorScheme: 'dark', error: 'theme_css_missing' }])
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'broken' }))
    const r = renderPanel()
    await flush()
    openCategory(r, 'api')
    expect(q(r, '[data-testid="settings-error"]').textContent).toContain('could not be loaded')
  })

  // Final review, Important 1 — a category switch disarms, but never wipes the ONE error line: the
  // refusal it carries still describes the panel (a broken themes folder, a refused port).
  it('a failed theme list stays on the error line after a category switch', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes()
    themes.list.mockImplementation(() => Promise.reject(new Error('boom')))
    const r = renderPanel()
    await flush()
    openCategory(r, 'appearance')
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Could not read the themes folder.'
    )
  })

  it('a refused port stays on the error line after leaving and coming back to API', async () => {
    stubSettings()
    stubApi()
    stubThemes()
    const r = renderPanel()
    openCategory(r, 'api')
    const port = q<HTMLInputElement>(r, '[data-testid="settings-api-port"]')
    type(port, '80')
    blur(port)
    openCategory(r, 'terminal')
    openCategory(r, 'api')
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Port must be between 1024 and 65535.'
    )
  })

  // Review Focus 4 — a category switch disarms Regenerate.
  it('switching category disarms an armed Regenerate', async () => {
    stubSettings()
    stubApi()
    stubThemes()
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    const r = renderPanel()
    openCategory(r, 'api')
    await flush()
    click(q(r, '[data-testid="settings-api-regenerate"]'))
    expect(q(r, '[data-testid="settings-api-regenerate"]').textContent).toMatch(
      /^Confirm regenerate/
    )
    openCategory(r, 'terminal')
    openCategory(r, 'api')
    expect(q(r, '[data-testid="settings-api-regenerate"]').textContent).toMatch(/^Regenerate/)
  })
})

// ── Keyboard: the ONE chord that opens the shortcut box (moved from the Shortcuts dialog) ────
describe('Settings → Keyboard — the Open shortcuts with recorder', () => {
  function renderKeyboard(): RenderResult {
    const r = renderPanel()
    openCategory(r, 'keyboard')
    return r
  }
  const recorder = (r: RenderResult): HTMLElement => q(r, '[data-testid="chord-recorder"]')
  function pressKey(r: RenderResult, key: string, init: KeyboardEventInit = {}): void {
    act(() => {
      recorder(r).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
    })
  }

  it('says what the chord does', () => {
    stubSettings()
    stubThemes()
    const r = renderKeyboard()
    expect(r.container.textContent).toContain('Opens the shortcut box inside the focused terminal.')
  })

  it('shows the live chord, and recording one persists expanderKey', () => {
    const { setCalls } = stubSettings()
    stubThemes()
    const r = renderKeyboard()
    expect(recorder(r).textContent).toContain('Ctrl+Alt+X')
    click(recorder(r))
    pressKey(r, 'q', { ctrlKey: true, altKey: true })
    expect(setCalls).toContainEqual({ expanderKey: 'Q' })
    expect(settingsStore.getState().expanderKey).toBe('Q')
  })

  it('refuses an AltGr keystroke and stays armed', () => {
    stubSettings()
    stubThemes()
    const r = renderKeyboard()
    click(recorder(r))
    // '@' is what AltGr+2 composes on many layouts: not an A-Z key, so chordFromEvent says no.
    pressKey(r, '@', { ctrlKey: true, altKey: true })
    expect(q(r, '[data-testid="chord-hint"]').textContent).toBe('Hold Ctrl+Alt and press a letter.')
  })

  it('shows the resting help before arming, and the default hint the instant it arms', () => {
    stubSettings()
    stubThemes()
    const r = renderKeyboard()
    expect(r.container.querySelector('[data-testid="chord-hint"]')).toBeNull()
    expect(r.container.textContent).toContain('Click, then hold Ctrl+Alt and press a letter.')
    click(recorder(r))
    expect(q(r, '[data-testid="chord-hint"]').textContent).toBe(
      'Press the chord now. Escape cancels.'
    )
  })

  it('Escape disarms the recorder in place without committing a chord or closing', () => {
    const { setCalls } = stubSettings()
    stubThemes()
    const onClose = vi.fn()
    const r = renderComponent(<SettingsPanel onClose={onClose} />)
    cleanup = r.unmount
    openCategory(r, 'keyboard')
    click(recorder(r))
    pressKey(r, 'Escape')
    expect(r.container.querySelector('[data-testid="chord-hint"]')).toBeNull()
    expect(recorder(r).textContent).toContain('Ctrl+Alt+X')
    expect(setCalls).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
  })
})
