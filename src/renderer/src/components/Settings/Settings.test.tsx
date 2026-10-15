// Settings UI tests, part 1: the panel's shell and controls. jsdom `unit` project.
//
// Renders the SettingsPanel against a stubbed window.settings + the singleton settings store.
// Asserts:
//   - the two-column shell: five categories (Notifications, Appearance, Terminal, Keyboard, API),
//     opening on Notifications, each showing exactly its own controls (spec 2026-09-29 §3);
//   - NO global-hotkey control (FR-8 row CUT);
//   - every control persists through window.settings.set;
//   - every control is labeled (accessibility floor);
//   - the attention reminders, the API block, and the Keyboard chord recorder.
// The Theme group is in Settings.theme.test.tsx; action feedback in Settings.feedback.test.tsx.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { SettingsPanel } from './Settings'
import { settingsStore } from '../../stores/settingsStore'
import { click, flush, q, renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption, selectedValue, optionValues, optionLabel } from '../../test/selectHarness'
import { DEFAULT_SETTINGS } from '../../../../shared/schemas/settings'
import { stubSettings } from '../../test/settingsBridge'
import {
  openCategory,
  resetSettingsPanel,
  stubApi,
  stubThemes,
  type,
  blur
} from '../../test/settingsPanelHarness'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  resetSettingsPanel()
})

function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(() => Promise.resolve())
  ;(window as unknown as { clipboard: unknown }).clipboard = {
    writeText,
    readText: () => Promise.resolve('')
  }
  return writeText
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

// ── Categories (spec 2026-09-29 §3) ───────────────────────────────────────────────────────────
// Settings is the two-column shell: a rail of categories, the chosen one's controls on the right.
function renderPanel(): RenderResult {
  const r = renderComponent(<SettingsPanel onClose={() => {}} />)
  cleanup = r.unmount
  return r
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
