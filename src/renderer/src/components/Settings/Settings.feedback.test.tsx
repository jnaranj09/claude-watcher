// Action feedback (spec 2026-09-29 §2.1) — every Settings action says what happened: the
// dialog's `Saved` toast (spec 2026-10-26); a refused change snaps the control back and names the
// setting in an error toast; Copy, Reload and Regenerate report on the button; Regenerate, Reload and Open folder cannot run twice;
// the Theme trigger never shows a raw id while the list loads.
//
// Flash state is read through the button's `role="status"` sibling, never the button's own
// textContent: with `feedback` set, both layers are always in the button.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { SettingsPanel } from './Settings'
import { settingsStore } from '../../stores/settingsStore'
import { themeStore } from '../../stores/themeStore'
import { click, flush, q, renderComponent, type RenderResult } from '../../test/renderComponent'
import { deferred } from '../../test/deferred'
import { mergedSettings, stubSettings } from '../../test/settingsBridge'
import { DEFAULT_SETTINGS } from '../../../../shared/schemas/settings'
import { DEFAULT_THEME_BUNDLE, type ThemeSummary } from '../../../../shared/schemas/theme'
import { toastStore } from '../../stores/toastStore'
import { dialogToast } from '../../test/toasts'

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

function openCategory(r: RenderResult, id: string): void {
  click(q(r, `[data-testid="settings-category-${id}"] button`))
}

describe('Settings — Saved and rollback', () => {
  it("a change main stored shows the dialog's Saved toast", async () => {
    stubSettings()
    stubThemes()
    const r = render()
    await flush(3)
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    await flush(3)
    expect(dialogToast('settings')).toMatchObject({ kind: 'success', title: 'Saved' })
  })

  // Review Focus 3: each result replaces the dialog's last toast, so quick toggles never pile up.
  it('three quick saves leave one Saved toast', async () => {
    stubSettings()
    stubThemes()
    const r = render()
    await flush(3)
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    click(q(r, '[data-testid="settings-notifications-toggle"]'))
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    await flush(3)
    const live = toastStore.getState().toasts.filter((t) => !t.leaving)
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ kind: 'success', title: 'Saved', key: 'dialog:settings' })
  })

  it('a refused change snaps the control back to main value and names it in an error toast', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubSettings(() => Promise.reject(new Error('EACCES /home/op/.config')))
    stubThemes()
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, soundEnabled: true }))
    const r = render()
    await flush(3)
    const toggle = q<HTMLInputElement>(r, '[data-testid="settings-sound-toggle"]')
    click(toggle)
    await flush(3)
    expect(toggle.checked).toBe(true)
    expect(dialogToast('settings')).toMatchObject({
      kind: 'error',
      title: 'Could not save the attention sound.'
    })
    expect(r.container.textContent).not.toContain('EACCES')
    expect(warn.mock.calls.flat().join(' ')).not.toContain('/home/op')
  })

  it('the next change that main stores replaces that error with Saved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let refuse = true
    stubSettings((patch) =>
      refuse ? Promise.reject(new Error('x')) : Promise.resolve(mergedSettings(patch))
    )
    stubThemes()
    const r = render()
    await flush(3)
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    await flush(3)
    expect(dialogToast('settings')?.kind).toBe('error')
    refuse = false
    click(q(r, '[data-testid="settings-notifications-toggle"]'))
    await flush(3)
    expect(dialogToast('settings')).toMatchObject({ kind: 'success', title: 'Saved' })
  })
})

describe('Settings — one result toast, and field errors stay by their field (review fixes)', () => {
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

  // The refusal replaces `Saved`; once the error goes away without a save (the current port
  // committed again), its toast fades and the earlier `Saved` does not come back.
  it('a refused save replaces Saved; clearing the error without a save leaves no toast', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let refuse = false
    stubSettings((patch) =>
      refuse ? Promise.reject(new Error('x')) : Promise.resolve(mergedSettings(patch))
    )
    stubThemes()
    stubApi()
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    const r = render()
    await flush(3)
    openCategory(r, 'api')
    commitPort(r, '30000')
    await flush(3)
    expect(dialogToast('settings')).toMatchObject({ kind: 'success', title: 'Saved' })
    refuse = true
    commitPort(r, '30001')
    await flush(3)
    expect(dialogToast('settings')).toMatchObject({
      kind: 'error',
      title: 'Could not save the API port.'
    })
    commitPort(r, '30000')
    await flush(3)
    expect(dialogToast('settings')).toBeUndefined()
  })

  it('a refused save and an invalid port after it each show, in their own place', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubSettings(() => Promise.reject(new Error('x')))
    stubThemes()
    const r = render()
    await flush(3)
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    await flush(3)
    openCategory(r, 'api')
    commitPort(r, '80')
    await flush(3)
    expect(q(r, '[data-testid="settings-port-error"]')).toHaveTextContent(
      'Port must be between 1024 and 65535.'
    )
    expect(dialogToast('settings')).toMatchObject({
      kind: 'error',
      title: 'Could not save the attention sound.'
    })
  })

  // One result per dialog (spec 2026-10-26 [AGENT]): the newest result is the one on screen.
  it('a save that lands replaces a different error toast with Saved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const themes = stubThemes()
    themes.reload.mockImplementation(() => Promise.reject(new Error('x')))
    stubSettings()
    stubApi()
    const r = render()
    await flush(3)
    openCategory(r, 'appearance')
    click(q(r, '[data-testid="settings-theme-reload"]'))
    await flush(3)
    expect(dialogToast('settings')).toMatchObject({
      kind: 'error',
      title: 'Could not reload themes.'
    })
    openCategory(r, 'api')
    click(q(r, '[data-testid="settings-api-enabled"]'))
    await flush(3)
    expect(dialogToast('settings')).toMatchObject({ kind: 'success', title: 'Saved' })
  })

  it('a save that lands leaves a port error under its field', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubSettings()
    stubThemes()
    stubApi()
    const r = render()
    await flush(3)
    openCategory(r, 'api')
    commitPort(r, '80')
    await flush(3)
    click(q(r, '[data-testid="settings-api-enabled"]'))
    await flush(3)
    expect(q(r, '[data-testid="settings-port-error"]')).toHaveTextContent(
      'Port must be between 1024 and 65535.'
    )
  })

  it('an error toast stays across a switch to another category', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubSettings(() => Promise.reject(new Error('x')))
    stubThemes()
    const r = render()
    await flush(3)
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    await flush(3)
    openCategory(r, 'terminal')
    expect(dialogToast('settings')).toMatchObject({
      kind: 'error',
      title: 'Could not save the attention sound.'
    })
  })

  it('a refusal right after a success replaces Saved — never both at once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let refuse = false
    stubSettings((patch) =>
      refuse ? Promise.reject(new Error('x')) : Promise.resolve(mergedSettings(patch))
    )
    stubThemes()
    const r = render()
    await flush(3)
    click(q(r, '[data-testid="settings-sound-toggle"]'))
    await flush(3)
    expect(dialogToast('settings')).toMatchObject({ kind: 'success', title: 'Saved' })
    refuse = true
    click(q(r, '[data-testid="settings-notifications-toggle"]'))
    await flush(3)
    const live = toastStore.getState().toasts.filter((t) => !t.leaving)
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({
      kind: 'error',
      title: 'Could not save desktop notifications.'
    })
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
    await flush(3)
    expect(r.container.querySelector('[data-testid="settings-api-copy"]')).toBeNull()
    token.resolve({ token: 'c'.repeat(64) })
    await flush(3)
    const copy = q<HTMLButtonElement>(r, '[data-testid="settings-api-copy"]')
    // Before the flash the live region is empty (both layers are always in the button, so its
    // textContent says nothing about which one shows — the status sibling does).
    expect(copy.nextElementSibling?.getAttribute('role')).toBe('status')
    expect(copy.nextElementSibling?.textContent).toBe('')
    click(copy)
    await flush(3)
    expect(writeText).toHaveBeenCalledWith('c'.repeat(64))
    expect(copy.nextElementSibling?.textContent).toBe('✓ Copied')
  })

  it('a failed copy says so in an error toast', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubSettings()
    stubThemes()
    stubApi()
    stubClipboard(() => Promise.reject(new Error('denied')))
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true }))
    const r = render()
    openCategory(r, 'api')
    await flush(3)
    const copy = q<HTMLButtonElement>(r, '[data-testid="settings-api-copy"]')
    click(copy)
    await flush(3)
    expect(dialogToast('settings')).toMatchObject({
      kind: 'error',
      title: 'Could not copy the token.'
    })
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
    await flush(3)
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
    await flush(3)
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
    await flush(3)
    const reload = q<HTMLButtonElement>(r, '[data-testid="settings-theme-reload"]')
    expect(reload.nextElementSibling?.textContent).toBe('')
    click(reload)
    expect(reload.getAttribute('aria-busy')).toBe('true')
    expect(reload.disabled).toBe(true)
    click(reload) // a second press while in flight
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    done.resolve({ ok: true, id: 'default' })
    await flush(3)
    expect(reload.hasAttribute('aria-busy')).toBe(false)
    expect(reload.nextElementSibling?.textContent).toBe('✓ Reloaded')
  })

  it('Open themes folder is busy while main opens it (spec §3)', async () => {
    const opened = deferred<void>()
    stubSettings()
    const { openFolder } = stubThemes(undefined, undefined, () => opened.promise)
    const r = render()
    openCategory(r, 'appearance')
    await flush(3)
    const btn = q<HTMLButtonElement>(r, '[data-testid="settings-theme-open-folder"]')
    click(btn)
    expect(btn.getAttribute('aria-busy')).toBe('true')
    expect(btn.disabled).toBe(true)
    click(btn) // a second press while in flight
    expect(openFolder).toHaveBeenCalledTimes(1)
    opened.resolve()
    await flush(3)
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
    await flush(3)
    const trigger = q(r, '[data-testid="settings-theme"]')
    expect(trigger.textContent).toContain('Loading…')
    expect(trigger.textContent).not.toContain('paper')
  })
})
