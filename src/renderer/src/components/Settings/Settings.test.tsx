// Story 2.4 — the Settings UI tests (jsdom `unit` project).
//
// Renders the SettingsPanel against a stubbed window.settings + the singleton settings store.
// Asserts (AC-4):
//   - EXACTLY six controls while the API is off (a sound toggle, the two attention-reminder
//     dropdowns, a terminal-font-size control, the API toggle and the API port) — no seventh;
//   - NO hotkey control present (FR-8 row CUT);
//   - toggling sound calls window.settings.set({ soundEnabled });
//   - changing font-size calls window.settings.set({ terminalFontSize });
//   - every control is labeled (accessibility floor).
// [Source: story 2.4 Task 6.4; AC-4; F3; ColumnHeader.test.tsx render style]
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { SettingsPanel } from './Settings'
import { settingsStore } from '../../stores/settingsStore'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption, selectedValue, optionValues, optionLabel } from '../../test/selectHarness'
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsPatch
} from '../../../../shared/schemas/settings'
import type { ThemeSummary } from '../../../../shared/schemas/theme'
import { themeStore } from '../../stores/themeStore'
import { DEFAULT_THEME_BUNDLE } from '../../../../shared/schemas/theme'

interface SettingsBridge {
  get(): Promise<Settings>
  set(patch: SettingsPatch): Promise<Settings>
}

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
  // Reset the singleton store between tests.
  act(() => {
    settingsStore.getState().hydrate(DEFAULT_SETTINGS)
    themeStore.getState().setBundle(DEFAULT_THEME_BUNDLE)
  })
})

/** Stub window.settings; `set` records the patch and echoes a merged Settings. */
function stubSettings(): { setCalls: SettingsPatch[] } {
  const setCalls: SettingsPatch[] = []
  const bridge: SettingsBridge = {
    get: async () => DEFAULT_SETTINGS,
    set: async (patch) => {
      setCalls.push(patch)
      // Build a fully-typed merged Settings (avoid spreading optional-undefined props
      // under exactOptionalPropertyTypes).
      const merged: Settings = {
        version: DEFAULT_SETTINGS.version,
        soundEnabled: patch.soundEnabled ?? DEFAULT_SETTINGS.soundEnabled,
        terminalFontSize: patch.terminalFontSize ?? DEFAULT_SETTINGS.terminalFontSize,
        reminderCount: patch.reminderCount ?? DEFAULT_SETTINGS.reminderCount,
        reminderFirstDelayMinutes:
          patch.reminderFirstDelayMinutes ?? DEFAULT_SETTINGS.reminderFirstDelayMinutes,
        expanderKey: patch.expanderKey ?? DEFAULT_SETTINGS.expanderKey,
        apiEnabled: patch.apiEnabled ?? DEFAULT_SETTINGS.apiEnabled,
        apiPort: patch.apiPort ?? DEFAULT_SETTINGS.apiPort,
        themeId: patch.themeId ?? DEFAULT_SETTINGS.themeId
      }
      return merged
    }
  }
  ;(window as unknown as { settings: SettingsBridge }).settings = bridge
  return { setCalls }
}

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

/** Let the token-bridge promises settle inside `act` so React state has landed. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

/** Type into a React-controlled field the way the DOM does, so onChange fires. */
function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const click = (el: Element): void => act(() => (el as HTMLElement).click())

/** React 17+ delegates onBlur to the native `focusout` event — a `blur` Event never reaches it. */
function blur(el: Element): void {
  act(() => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

describe('SettingsPanel — the controls it offers, no hotkey (AC-4)', () => {
  // Story 2.4 froze this panel at two controls (F3 / UX-DR30). Attention reminders (spec
  // 2026-09-10) deliberately added two dropdowns: how many reminders, and the first delay. The
  // count is asserted so a fifth control cannot arrive unnoticed.
  it('renders the sound toggle, the font-size range, the two reminder dropdowns and the API pair — nothing else', () => {
    stubSettings()
    stubApi()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount

    for (const testId of [
      'settings-sound-toggle',
      'settings-font-size',
      'settings-reminder-count',
      'settings-reminder-first-delay',
      'settings-api-enabled',
      'settings-api-port',
      'settings-theme'
    ]) {
      expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull()
    }
    const panel = container.querySelector('[data-testid="settings-panel"]')
    // SEVEN while the API is off: four <input>s (sound, font size, the API toggle, the API port)
    // plus the two reminder `Select`s and the Theme Select, which are `[aria-haspopup="listbox"]`
    // buttons. The token field and its buttons only exist while the API is ON.
    expect(panel?.querySelectorAll('input, select, [aria-haspopup="listbox"]').length).toBe(7)
    // design.md: a native <select> is banned.
    expect(panel?.querySelectorAll('select').length).toBe(0)
  })

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
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    expect(container.querySelector('label[for="settings-sound-enabled"]')).not.toBeNull()
    expect(container.querySelector('label[for="settings-terminal-font-size"]')).not.toBeNull()
    expect(container.querySelector('label[for="settings-api-enabled"]')).not.toBeNull()
    expect(container.querySelector('label[for="settings-api-port"]')).not.toBeNull()
    expect(
      container.querySelector('[data-testid="settings-reminder-count"]')?.getAttribute('aria-label')
    ).toBe('Reminders')
    expect(
      container
        .querySelector('[data-testid="settings-reminder-first-delay"]')
        ?.getAttribute('aria-label')
    ).toBe('First reminder after')
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

  it('changing font-size calls window.settings.set({ terminalFontSize })', () => {
    const stub = stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount

    const range = container.querySelector('[data-testid="settings-font-size"]') as HTMLInputElement
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
  it('the rows appear in order: sound, reminders, first delay, then font size (spec §4)', () => {
    stubSettings()
    stubThemes()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    const orderedIds = [
      'settings-sound-toggle',
      'settings-reminder-count',
      'settings-reminder-first-delay',
      'settings-font-size'
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
    expect(q(r, '[data-testid="settings-api-copy"]').textContent).toBe('Copy')
    expect(q(r, '[data-testid="settings-api-regenerate"]').textContent).toBe('Regenerate')
    expect(q(r, '[data-testid="settings-api-docs-url"]').textContent).toBe(
      'http://127.0.0.1:9281/docs'
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
    expect(btn.textContent).toBe('Confirm regenerate')
    expect(regenerate).not.toHaveBeenCalled()
    click(btn)
    await flush()
    expect(regenerate).toHaveBeenCalledTimes(1)
    expect(q<HTMLInputElement>(r, '[data-testid="settings-api-token"]').value).toBe('b'.repeat(64))
    // The flow is OVER: the button must fall back to its resting label. `ManageDialog.Delete`
    // never disarms itself (a refused delete stays armed so a second press retries) — the host
    // disarms it, and without that the next single press regenerates with no arming step.
    expect(btn.textContent).toBe('Regenerate')
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
    expect(btn.textContent).toBe('Confirm regenerate')
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
  it('the block’s ManageDialog.Provider adds no second dialog', async () => {
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
    await flush()
    expect(r.container.querySelector('[data-testid="settings-theme-broken"]')).toBeNull()
  })

  it('choosing a theme persists { themeId }', async () => {
    const { setCalls } = stubSettings()
    stubApi()
    stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    await flush()
    chooseOption(r.container, 'settings-theme', 'paper')
    expect(setCalls).toEqual([{ themeId: 'paper' }])
  })

  it('Reload themes reloads, then re-lists', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
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
    await flush()
    click(q(r, '[data-testid="settings-theme-open-folder"]'))
    await flush()
    const line = q(r, '[data-testid="settings-error"]')
    expect(line.getAttribute('role')).toBe('alert')
    expect(line.textContent).toBe('Could not open the themes folder.')
    expect(r.container.textContent).not.toContain('ENOENT')
  })

  it('when the chosen theme is not the applied one, the error line says so and the picker keeps the choice', async () => {
    stubSettings()
    stubApi()
    stubThemes([broken])
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'broken' }))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Theme "broken" could not be loaded, using Default'
    )
    expect(selectedValue(r.container, 'settings-theme')).toBe('broken')
    expect(optionValues(r.container, 'settings-theme')).toEqual(['default', 'broken'])
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
    await flush()
    expect(r.container.querySelector('[data-testid="settings-error"]')).toBeNull()
  })

  it('shows the transparency hint only while the applied theme sets allowTransparency', async () => {
    stubSettings()
    stubApi()
    stubThemes([glass])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
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
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Could not read the themes folder.'
    )
    expect(optionValues(r.container, 'settings-theme')).toEqual(['default'])
  })
})
