// Story 2.4 — the Settings UI tests (jsdom `unit` project).
//
// Renders the SettingsPanel against a stubbed window.settings + the singleton settings store.
// Asserts (AC-4):
//   - EXACTLY four controls (a sound toggle, the two attention-reminder dropdowns, and a
//     terminal-font-size control) — no fifth;
//   - NO hotkey control present (FR-8 row CUT);
//   - toggling sound calls window.settings.set({ soundEnabled });
//   - changing font-size calls window.settings.set({ terminalFontSize });
//   - every control is labeled (accessibility floor).
// [Source: story 2.4 Task 6.4; AC-4; F3; ColumnHeader.test.tsx render style]
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { SettingsPanel } from './Settings'
import { settingsStore } from '../../stores/settingsStore'
import { renderComponent } from '../../test/renderComponent'
import { chooseOption, selectedValue, optionValues, optionLabel } from '../../test/selectHarness'
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsPatch
} from '../../../../shared/schemas/settings'

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
          patch.reminderFirstDelayMinutes ?? DEFAULT_SETTINGS.reminderFirstDelayMinutes
      }
      return merged
    }
  }
  ;(window as unknown as { settings: SettingsBridge }).settings = bridge
  return { setCalls }
}

describe('SettingsPanel — the controls it offers, no hotkey (AC-4)', () => {
  // Story 2.4 froze this panel at two controls (F3 / UX-DR30). Attention reminders (spec
  // 2026-09-10) deliberately added two dropdowns: how many reminders, and the first delay. The
  // count is asserted so a fifth control cannot arrive unnoticed.
  it('renders the sound toggle, the font-size range and the two reminder dropdowns — nothing else', () => {
    stubSettings()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount

    for (const testId of [
      'settings-sound-toggle',
      'settings-font-size',
      'settings-reminder-count',
      'settings-reminder-first-delay'
    ]) {
      expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull()
    }
    const panel = container.querySelector('[data-testid="settings-panel"]')
    expect(panel?.querySelectorAll('input, select, [aria-haspopup="listbox"]').length).toBe(4)
    // design.md: a native <select> is banned.
    expect(panel?.querySelectorAll('select').length).toBe(0)
  })

  it('has NO hotkey/keybinding control (FR-8 row CUT)', () => {
    stubSettings()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    const text = container.textContent?.toLowerCase() ?? ''
    expect(text).not.toContain('hotkey')
    expect(text).not.toContain('keybind')
    expect(text).not.toContain('shortcut')
  })

  it('every control is labeled (accessibility floor — label + control)', () => {
    stubSettings()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    expect(container.querySelector('label[for="settings-sound-enabled"]')).not.toBeNull()
    expect(container.querySelector('label[for="settings-terminal-font-size"]')).not.toBeNull()
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
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount

    expect(container.querySelector('[data-testid="settings-background-timeout"]')).toBeNull()
  })
})

describe('SettingsPanel — attention reminders (spec 2026-09-10)', () => {
  it('shows the stored values: 3 reminders, first after 2 min', () => {
    stubSettings()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    expect(selectedValue(container, 'settings-reminder-count')).toBe('3')
    expect(selectedValue(container, 'settings-reminder-first-delay')).toBe('2')
  })

  it('offers Off and 1–5 reminders', () => {
    stubSettings()
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
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    expect(container.querySelector('[data-testid="settings-reminder-summary"]')?.textContent).toBe(
      'For permission prompts and questions: +2, +6, +14 min'
    )
  })

  it('choosing Off persists { reminderCount: 0 }, hides the delay row, and says Off', () => {
    const stub = stubSettings()
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
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    chooseOption(container, 'settings-reminder-first-delay', '5')
    expect(stub.setCalls).toContainEqual({ reminderFirstDelayMinutes: 5 })
  })

  // Controller Ruling 8 (fix round 1): spec §4 says the two reminder rows go directly after
  // Attention sound — sound and reminders are both attention settings, so they belong together.
  it('the rows appear in order: sound, reminders, first delay, then font size (spec §4)', () => {
    stubSettings()
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
