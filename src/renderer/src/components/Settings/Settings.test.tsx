// Story 2.4 — the Settings UI tests (jsdom `unit` project).
//
// Renders the SettingsPanel against a stubbed window.settings + the singleton settings store.
// Asserts (AC-4):
//   - EXACTLY two controls (one sound toggle + one terminal-font-size control) — no third;
//   - NO hotkey control present (FR-8 row CUT);
//   - toggling sound calls window.settings.set({ soundEnabled });
//   - changing font-size calls window.settings.set({ terminalFontSize });
//   - both controls are labeled (accessibility floor).
// [Source: story 2.4 Task 6.4; AC-4; F3; ColumnHeader.test.tsx render style]
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { SettingsPanel } from './Settings'
import { settingsStore } from '../../stores/settingsStore'
import { renderComponent } from '../../test/renderComponent'
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
        terminalFontSize: patch.terminalFontSize ?? DEFAULT_SETTINGS.terminalFontSize
      }
      return merged
    }
  }
  ;(window as unknown as { settings: SettingsBridge }).settings = bridge
  return { setCalls }
}

describe('SettingsPanel — exactly two controls, no hotkey (AC-4)', () => {
  it('renders EXACTLY two interactive controls (sound + font-size) and no third', () => {
    stubSettings()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount

    const sound = container.querySelector('[data-testid="settings-sound-toggle"]')
    const fontSize = container.querySelector('[data-testid="settings-font-size"]')
    expect(sound).not.toBeNull()
    expect(fontSize).not.toBeNull()

    // No more than these two form controls in the panel body (close button is not a setting).
    const panel = container.querySelector('[data-testid="settings-panel"]')
    const formControls = panel?.querySelectorAll('input, select') ?? []
    expect(formControls.length).toBe(2)
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

  it('both controls are labeled (accessibility floor — label + control)', () => {
    stubSettings()
    const { container, unmount } = renderComponent(<SettingsPanel />)
    cleanup = unmount
    expect(container.querySelector('label[for="settings-sound-enabled"]')).not.toBeNull()
    expect(container.querySelector('label[for="settings-terminal-font-size"]')).not.toBeNull()
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
