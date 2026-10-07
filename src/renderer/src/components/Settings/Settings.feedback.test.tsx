// Action feedback (spec 2026-09-29 §2.1) — every Settings action says what happened: `✓ Saved`
// beside the pane heading; a refused change snaps the control back and names the setting; Copy,
// Reload and Regenerate report on the button; Regenerate, Reload and Open folder cannot run twice;
// the Theme trigger never shows a raw id while the list loads.
//
// Flash state is read through the button's `role="status"` sibling, never the button's own
// textContent: with `feedback` set, both layers are always in the button.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { SettingsPanel } from './Settings'
import { settingsStore } from '../../stores/settingsStore'
import { themeStore } from '../../stores/themeStore'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { deferred } from '../../test/deferred'
import { mergedSettings, stubSettings } from '../../test/settingsBridge'
import { DEFAULT_SETTINGS } from '../../../../shared/schemas/settings'
import { DEFAULT_THEME_BUNDLE, type ThemeSummary } from '../../../../shared/schemas/theme'
import { SUCCESS_MS } from '../ManageDialog/manageDialogState'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  act(() => {
    settingsStore.getState().hydrate(DEFAULT_SETTINGS)
    themeStore.getState().setBundle(DEFAULT_THEME_BUNDLE)
  })
})

function stubThemes(
  list: () => Promise<ThemeSummary[]> = () => Promise.resolve([]),
  reload: () => Promise<unknown> = () => Promise.resolve({ ok: true, id: 'default' }),
  openFolder: () => Promise<void> = () => Promise.resolve()
): { reload: ReturnType<typeof vi.fn>; openFolder: ReturnType<typeof vi.fn> } {
  const reloadSpy = vi.fn(reload)
  const openFolderSpy = vi.fn(openFolder)
  ;(window as unknown as { themes: unknown }).themes = {
    list: vi.fn(list),
    reload: reloadSpy,
    openFolder: openFolderSpy,
    onApplied: () => () => {}
  }
  return { reload: reloadSpy, openFolder: openFolderSpy }
}

function stubApi(
  getToken: () => Promise<{ token: string }> = () => Promise.resolve({ token: 'a'.repeat(64) }),
  regenerateToken: () => Promise<{ token: string }> = () =>
    Promise.resolve({ token: 'b'.repeat(64) })
): { regenerate: ReturnType<typeof vi.fn> } {
  const regenerate = vi.fn(regenerateToken)
  ;(window as unknown as { api: unknown }).api = {
    getToken: vi.fn(getToken),
    regenerateToken: regenerate
  }
  return { regenerate }
}

function stubClipboard(
  writeText: () => Promise<void> = () => Promise.resolve()
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(writeText)
  ;(window as unknown as { clipboard: unknown }).clipboard = {
    writeText: spy,
    readText: () => Promise.resolve('')
  }
  return spy
}

function render(): RenderResult {
  const r = renderComponent(<SettingsPanel onClose={() => {}} />)
  cleanup = r.unmount
  return r
}

function q<T extends Element = HTMLElement>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

const click = (el: Element): void => act(() => (el as HTMLElement).click())

function openCategory(r: RenderResult, id: string): void {
  click(q(r, `[data-testid="settings-category-${id}"] button`))
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('Settings — ✓ Saved and rollback', () => {
  it('a change main stored shows a compact Saved callout in the message slot for SUCCESS_MS', async () => {
    vi.useFakeTimers()
    stubSettings()
    stubThemes()
    const r = render()
    await flush()
    const mark = q(r, '[data-testid="settings-message"]')
    expect(mark.getAttribute('role')).toBe('status')
    expect(mark.textContent).toBe('')
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    await flush()
    expect(mark.textContent).toBe('Saved')
    // The slot is the live region (always in the page); the callout inside does not re-announce.
    const callout = mark.querySelector('[data-testid="settings-success"]')
    expect(callout?.getAttribute('data-callout-tone')).toBe('success')
    expect(callout?.getAttribute('data-callout-size')).toBe('compact')
    expect(callout?.hasAttribute('role')).toBe(false)
    act(() => {
      vi.advanceTimersByTime(SUCCESS_MS - 1)
    })
    expect(mark.textContent).toBe('Saved')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(mark.textContent).toBe('')
  })

  it('a refused change snaps the control back to main value and names it on the error line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubSettings(() => Promise.reject(new Error('EACCES /home/op/.config')))
    stubThemes()
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, soundEnabled: true }))
    const r = render()
    await flush()
    const toggle = q<HTMLInputElement>(r, '[data-testid="settings-sound-toggle"]')
    click(toggle)
    await flush()
    expect(toggle.checked).toBe(true)
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Could not save the attention sound.'
    )
    expect(r.container.querySelector('[data-testid="settings-success"]')).toBeNull()
    expect(r.container.textContent).not.toContain('EACCES')
    expect(warn.mock.calls.flat().join(' ')).not.toContain('/home/op')
  })

  it('the next change that main stores clears that line', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let refuse = true
    stubSettings((patch) =>
      refuse ? Promise.reject(new Error('x')) : Promise.resolve(mergedSettings(patch))
    )
    stubThemes()
    const r = render()
    await flush()
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    await flush()
    expect(r.container.querySelector('[data-testid="settings-error"]')).not.toBeNull()
    refuse = false
    click(q(r, '[data-testid="settings-notifications-toggle"]'))
    await flush()
    expect(r.container.querySelector('[data-testid="settings-error"]')).toBeNull()
  })
})

describe('Settings — one error line, and ✓ Saved stays where it belongs (review fixes)', () => {
  /** Type into the React-controlled port field and commit it (React's onBlur is `focusout`). */
  function commitPort(r: RenderResult, value: string): void {
    const port = q<HTMLInputElement>(r, '[data-testid="settings-api-port"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(port, value)
      port.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      port.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
  }

  it('a refused save does not hide a newer error: an invalid port after it shows the port message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubSettings(() => Promise.reject(new Error('x')))
    stubThemes()
    const r = render()
    await flush()
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Could not save the attention sound.'
    )
    openCategory(r, 'api')
    commitPort(r, '80')
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Port must be between 1024 and 65535.'
    )
  })

  it('a save that lands clears only its own refusal, never a newer different error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let refuse = true
    stubSettings((patch) =>
      refuse ? Promise.reject(new Error('x')) : Promise.resolve(mergedSettings(patch))
    )
    stubThemes()
    stubApi()
    const r = render()
    await flush()
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    await flush()
    openCategory(r, 'api')
    commitPort(r, '80')
    await flush()
    refuse = false
    click(q(r, '[data-testid="settings-api-enabled"]'))
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Port must be between 1024 and 65535.'
    )
  })

  it('✓ Saved does not follow a switch to another category', async () => {
    stubSettings()
    stubThemes()
    const r = render()
    await flush()
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    await flush()
    expect(q(r, '[data-testid="settings-success"]').textContent).toBe('Saved')
    openCategory(r, 'terminal')
    expect(r.container.querySelector('[data-testid="settings-success"]')).toBeNull()
  })

  it('a refusal right after a success clears ✓ Saved — never both at once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let refuse = false
    stubSettings((patch) =>
      refuse ? Promise.reject(new Error('x')) : Promise.resolve(mergedSettings(patch))
    )
    stubThemes()
    const r = render()
    await flush()
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    await flush()
    expect(q(r, '[data-testid="settings-success"]').textContent).toBe('Saved')
    refuse = true
    click(q(r, '[data-testid="settings-notifications-toggle"]'))
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Could not save desktop notifications.'
    )
    expect(r.container.querySelector('[data-testid="settings-success"]')).toBeNull()
  })
})

describe('Settings — API token actions', () => {
  it('Copy is not rendered until the token is read; then it says ✓ Copied', async () => {
    const token = deferred<{ token: string }>()
    stubSettings()
    stubThemes()
    stubApi(() => token.promise)
    const writeText = stubClipboard()
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    const r = render()
    openCategory(r, 'api')
    await flush()
    expect(r.container.querySelector('[data-testid="settings-api-copy"]')).toBeNull()
    token.resolve({ token: 'c'.repeat(64) })
    await flush()
    const copy = q<HTMLButtonElement>(r, '[data-testid="settings-api-copy"]')
    // Before the flash the live region is empty (both layers are always in the button, so its
    // textContent says nothing about which one shows — the status sibling does).
    expect(copy.nextElementSibling?.getAttribute('role')).toBe('status')
    expect(copy.nextElementSibling?.textContent).toBe('')
    click(copy)
    await flush()
    expect(writeText).toHaveBeenCalledWith('c'.repeat(64))
    expect(copy.nextElementSibling?.textContent).toBe('✓ Copied')
  })

  it('a failed copy says so on the error line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubSettings()
    stubThemes()
    stubApi()
    stubClipboard(() => Promise.reject(new Error('denied')))
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    const r = render()
    openCategory(r, 'api')
    await flush()
    const copy = q<HTMLButtonElement>(r, '[data-testid="settings-api-copy"]')
    click(copy)
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe('Could not copy the token.')
    expect(copy.nextElementSibling?.textContent).toBe('')
    expect(warn.mock.calls.flat().join(' ')).not.toContain('a'.repeat(64))
  })

  it('Regenerate cannot run twice: busy while in flight, then ✓ New token', async () => {
    const minted = deferred<{ token: string }>()
    stubSettings()
    stubThemes()
    const { regenerate } = stubApi(undefined, () => minted.promise)
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    const r = render()
    openCategory(r, 'api')
    await flush()
    const btn = q<HTMLButtonElement>(r, '[data-testid="settings-api-regenerate"]')
    expect(btn.nextElementSibling?.textContent).toBe('')
    click(btn) // arm
    click(btn) // confirm
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-busy')).toBe('true')
    expect(btn.hasAttribute('data-armed')).toBe(true)
    click(btn) // a second confirm while in flight
    expect(regenerate).toHaveBeenCalledTimes(1)
    minted.resolve({ token: 'd'.repeat(64) })
    await flush()
    expect(btn.disabled).toBe(false)
    expect(btn.hasAttribute('data-armed')).toBe(false)
    expect(btn.nextElementSibling?.textContent).toBe('✓ New token')
  })
})

describe('Settings — themes', () => {
  it('Reload themes is busy while main reloads, then says ✓ Reloaded', async () => {
    const done = deferred<unknown>()
    stubSettings()
    const { reload: reloadSpy } = stubThemes(undefined, () => done.promise)
    const r = render()
    openCategory(r, 'appearance')
    await flush()
    const reload = q<HTMLButtonElement>(r, '[data-testid="settings-theme-reload"]')
    expect(reload.nextElementSibling?.textContent).toBe('')
    click(reload)
    expect(reload.getAttribute('aria-busy')).toBe('true')
    expect(reload.disabled).toBe(true)
    click(reload) // a second press while in flight
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    done.resolve({ ok: true, id: 'default' })
    await flush()
    expect(reload.hasAttribute('aria-busy')).toBe(false)
    expect(reload.nextElementSibling?.textContent).toBe('✓ Reloaded')
  })

  it('Open themes folder is busy while main opens it (spec §3)', async () => {
    const opened = deferred<void>()
    stubSettings()
    const { openFolder } = stubThemes(undefined, undefined, () => opened.promise)
    const r = render()
    openCategory(r, 'appearance')
    await flush()
    const btn = q<HTMLButtonElement>(r, '[data-testid="settings-theme-open-folder"]')
    click(btn)
    expect(btn.getAttribute('aria-busy')).toBe('true')
    expect(btn.disabled).toBe(true)
    click(btn) // a second press while in flight
    expect(openFolder).toHaveBeenCalledTimes(1)
    opened.resolve()
    await flush()
    expect(btn.hasAttribute('aria-busy')).toBe(false)
    expect(btn.disabled).toBe(false)
  })

  it('the Theme trigger says Loading… while the list loads — never the raw id', async () => {
    const list = deferred<ThemeSummary[]>()
    stubSettings()
    stubThemes(() => list.promise)
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'paper' }))
    const r = render()
    openCategory(r, 'appearance')
    await flush()
    const trigger = q(r, '[data-testid="settings-theme"]')
    expect(trigger.textContent).toContain('Loading…')
    expect(trigger.textContent).not.toContain('paper')
  })
})
