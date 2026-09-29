// Phrase shortcuts — the Manage dialog (a list, plus a separate editor card).
//
// Covers: the list shows name/alias/phrase; the empty state; add → type an alias → Save calls
// window.shortcuts.save with the alias lowercased; a placeholder gap disables Save; the
// two-step delete; the store's alias_taken error copy; the layout/onboarding contract — the
// edited row leaves the list; and the header's ONE "Open with" chord recorder, which reads and
// patches the single expanderKey setting (an AltGr keystroke is refused there too).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption, optionValues } from '../../test/selectHarness'
import { ShortcutsDialog } from './ShortcutsDialog'
import { shortcutsStore } from '../../stores/shortcutsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { settingsStore } from '../../stores/settingsStore'
import { DEFAULT_WORKSPACE_ID } from '../../../../shared/schemas/workspace'
import { DEFAULT_SETTINGS } from '../../../../shared/schemas/settings'
import type { SettingsPatch } from '../../../../shared/schemas/settings'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'

const A = {
  id: 'sc-1',
  name: 'approve',
  alias: 'ap',
  text: 'I explicitly approve',
  workspaceId: null
}

let saveMock: ReturnType<typeof vi.fn>
let removeMock: ReturnType<typeof vi.fn>
let cleanup: (() => void) | undefined

beforeEach(() => {
  saveMock = vi.fn(() => Promise.resolve({ saved: A, shortcuts: [A] }))
  removeMock = vi.fn(() => Promise.resolve([]))
  ;(window as unknown as { shortcuts: unknown }).shortcuts = {
    list: vi.fn(() => Promise.resolve([A])),
    save: saveMock,
    remove: removeMock
  }
  shortcutsStore.setState({ shortcuts: [A], loaded: true })
  ;(window as unknown as { settings: unknown }).settings = {
    get: vi.fn(() => Promise.resolve({ ...DEFAULT_SETTINGS })),
    set: vi.fn((patch: SettingsPatch) => Promise.resolve({ ...DEFAULT_SETTINGS, ...patch }))
  }
  settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS })
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => shortcutsStore.getState().hydrate([]))
  act(() =>
    workspacesStore.setState({ activeId: DEFAULT_WORKSPACE_ID, workspaces: [], loaded: false })
  )
  vi.restoreAllMocks()
})

function render(): RenderResult {
  const r = renderComponent(<ShortcutsDialog onClose={() => {}} />)
  cleanup = r.unmount
  return r
}

function byTestId(id: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${id}"]`)
}

function click(el: Element | null): void {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function type(el: Element | null, value: string): void {
  act(() => {
    const input = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Press one key at the recorder. `init` carries the modifiers. */
function pressKey(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    byTestId('chord-recorder')?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, ...init })
    )
  })
}

/** Arm the recorder. */
function arm(): void {
  click(byTestId('chord-recorder'))
}

/** Press one Ctrl+Alt chord at the (already armed) recorder. */
function chord(key: string): void {
  pressKey(key, { ctrlKey: true, altKey: true })
}

describe('ShortcutsDialog', () => {
  it('lists the saved shortcuts with their name, alias and phrase', () => {
    render()
    expect(document.body.textContent).toContain('approve')
    expect(byTestId('shortcut-alias-sc-1')?.textContent).toBe('ap')
    expect(document.body.textContent).toContain('I explicitly approve')
  })

  it('shows an empty state when there are none', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    expect(byTestId('shortcuts-empty')).not.toBeNull()
  })

  it('the editor has an Alias field and Save sends it lowercased', () => {
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'help desk')
    type(byTestId('shortcut-alias-input'), 'HT')
    type(byTestId('shortcut-text-input'), 'work on help desk ticket $1')
    click(byTestId('shortcut-save'))
    expect(saveMock).toHaveBeenCalledWith({
      name: 'help desk',
      alias: 'ht',
      text: 'work on help desk ticket $1',
      workspaceId: null
    })
  })

  it('Save stays disabled on a placeholder gap', () => {
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'x')
    type(byTestId('shortcut-alias-input'), 'x')
    type(byTestId('shortcut-text-input'), 'do $2')
    expect((byTestId('shortcut-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders the store alias_taken error as copy', async () => {
    saveMock.mockImplementationOnce(() => Promise.reject(new Error('shortcut_alias_taken')))
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'x')
    type(byTestId('shortcut-alias-input'), 'ap')
    type(byTestId('shortcut-text-input'), 'y')
    click(byTestId('shortcut-save'))
    await act(async () => {})
    expect(byTestId('shortcuts-error')?.textContent).toBe(
      'That alias is already used by another shortcut.'
    )
  })

  it('the header shows the open chord and the recorder patches expanderKey', () => {
    render()
    expect(byTestId('chord-recorder')?.textContent).toContain('Ctrl+Alt+X')
    arm()
    chord('q')
    const settingsSet = (window as unknown as { settings: { set: ReturnType<typeof vi.fn> } })
      .settings.set
    expect(settingsSet).toHaveBeenCalledWith({ expanderKey: 'Q' })
    expect(settingsStore.getState().expanderKey).toBe('Q')
  })

  it('the recorder refuses an AltGr keystroke and stays armed', () => {
    render()
    arm()
    // '@' is what AltGr+2 composes on many layouts: not an A-Z key, so chordFromEvent says no.
    pressKey('@', { ctrlKey: true, altKey: true })
    expect(byTestId('chord-hint')?.textContent).toBe('Hold Ctrl+Alt and press a letter.')
  })

  it('shows the resting help before arming, and the default hint the instant it arms', () => {
    render()
    // Resting: the recorder is not armed yet, so there is no chord-hint element at all.
    expect(byTestId('chord-hint')).toBeNull()
    expect(document.body.textContent).toContain('Click, then hold Ctrl+Alt and press a letter.')
    arm()
    // Armed, before any keystroke: the default coaching line, not the AltGr/invalid hint.
    expect(byTestId('chord-hint')?.textContent).toBe('Press the chord now. Escape cancels.')
  })

  it('Escape disarms the recorder in place without committing a chord', () => {
    render()
    arm()
    pressKey('Escape')
    // Disarmed: back to the resting label (the still-live expanderKey chord), no hint element.
    expect(byTestId('chord-hint')).toBeNull()
    expect(byTestId('chord-recorder')?.textContent).toContain('Ctrl+Alt+X')
    // The part that matters: Escape must never commit a chord.
    const settingsSet = (window as unknown as { settings: { set: ReturnType<typeof vi.fn> } })
      .settings.set
    expect(settingsSet).not.toHaveBeenCalled()
  })

  it('the subtitle names the live chord', () => {
    render()
    expect(byTestId('shortcuts-subtitle')?.textContent).toContain('Ctrl+Alt+X')
  })

  it('deletes only after a confirm click', () => {
    render()
    click(byTestId('shortcut-edit-sc-1'))
    click(byTestId('shortcut-delete'))
    expect(removeMock).not.toHaveBeenCalled()
    click(byTestId('shortcut-delete'))
    expect(removeMock).toHaveBeenCalledWith('sc-1')
  })

  // --- layout / onboarding -------------------------------------------------------------------
  // The editor is a card of its own, not a row in the list: the edited shortcut leaves the list
  // while it is open, so it is never on screen twice.
  it('moves the edited shortcut into the editor and out of the list', () => {
    render()
    expect(byTestId('shortcut-row-sc-1')).not.toBeNull()

    click(byTestId('shortcut-edit-sc-1'))
    expect(byTestId('shortcut-row-editing')).not.toBeNull()
    expect(byTestId('shortcut-row-sc-1')).toBeNull()

    click(byTestId('shortcut-cancel'))
    expect(byTestId('shortcut-row-sc-1')).not.toBeNull()
  })

  it('disables Add while the new-shortcut editor is open', () => {
    render()
    click(byTestId('shortcuts-add'))
    expect((byTestId('shortcuts-add') as HTMLButtonElement | null)?.disabled).toBe(true)

    click(byTestId('shortcut-cancel'))
    expect((byTestId('shortcuts-add') as HTMLButtonElement | null)?.disabled).toBe(false)
  })

  it('says what a shortcut does, and that nothing is sent for you', () => {
    render()
    expect(document.body.textContent).toContain('You press Enter to send.')
    click(byTestId('shortcuts-add'))
    expect(document.body.textContent).toContain('Typed into the session, never sent.')
  })

  // --- Task 11: scope control + orphan grouping (mirrors TemplatesDialog.test.tsx) -----------
  it('saves the scope chosen in the form', () => {
    act(() =>
      workspacesStore.setState({
        activeId: 'w1',
        workspaces: [{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }],
        loaded: true
      })
    )
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'approve')
    type(byTestId('shortcut-alias-input'), 'ap')
    type(byTestId('shortcut-text-input'), 'I explicitly approve')
    chooseOption(document, 'shortcut-scope', 'w1')

    click(byTestId('shortcut-save'))

    expect(saveMock).toHaveBeenCalledWith({
      name: 'approve',
      alias: 'ap',
      text: 'I explicitly approve',
      workspaceId: 'w1'
    })
  })

  it('keeps a row whose workspace is gone reachable', () => {
    act(() => workspacesStore.setState({ activeId: 'w1', workspaces: [], loaded: true }))
    act(() =>
      shortcutsStore.setState({
        shortcuts: [{ id: 'orphan', name: 'Orphan', alias: 'oz', text: 'z', workspaceId: 'gone' }],
        loaded: true
      })
    )
    render()
    // No scope sections any more — the row stays REACHABLE instead: listed under
    // `All shortcuts` (the fallback here, since no workspace matches the active id) and
    // selectable from its own `(no workspace)` entry in the header dropdown.
    expect(byTestId('shortcut-row-orphan')?.textContent).toContain('Orphan')
    expect(optionValues(document, 'shortcut-scope-filter')).toContain('orphans')
  })

  // R26 — the error line clears when the operator starts fixing the field (Templates/Tags/Rules
  // already did; this dialog left the refusal up while the alias was being changed).
  it('clears the error line when a field changes', async () => {
    saveMock.mockImplementationOnce(() => Promise.reject(new Error('shortcut_alias_taken')))
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'x')
    type(byTestId('shortcut-alias-input'), 'ap')
    type(byTestId('shortcut-text-input'), 'y')
    click(byTestId('shortcut-save'))
    await act(async () => {})
    expect(byTestId('shortcuts-error')).not.toBeNull()
    type(byTestId('shortcut-alias-input'), 'ap2')
    expect(byTestId('shortcuts-error')).toBeNull()
  })

  // R26 — Save greyed with no reason: `deploy-prod` fails the alias rule silently.
  it('says why Save is disabled for an alias with a hyphen', () => {
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'deploy')
    type(byTestId('shortcut-alias-input'), 'deploy-prod')
    type(byTestId('shortcut-text-input'), 'deploy it')
    expect((byTestId('shortcut-save') as HTMLButtonElement).disabled).toBe(true)
    expect(byTestId('shortcut-hint')?.textContent).toBe(
      'The alias is letters and digits only, up to 20.'
    )
  })

  it('names the placeholder gap as the reason', () => {
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'x')
    type(byTestId('shortcut-alias-input'), 'x')
    type(byTestId('shortcut-text-input'), 'do $2')
    expect(byTestId('shortcut-hint')?.textContent).toBe('Use $1, $2… in order, with no gap.')
  })

  it('shows no reason before anything was typed', () => {
    render()
    click(byTestId('shortcuts-add'))
    expect(byTestId('shortcut-hint')).toBeNull()
  })

  // R26 — a refused delete was swallowed and the editor closed as if it had worked.
  it('a refused delete says so and keeps the editor open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    removeMock.mockImplementationOnce(() =>
      Promise.reject(
        new Error("Error invoking remote method 'shortcuts:remove': Error: store_write_failed")
      )
    )
    render()
    click(byTestId('shortcut-edit-sc-1'))
    click(byTestId('shortcut-delete'))
    click(byTestId('shortcut-delete'))
    await act(async () => {})
    expect(byTestId('shortcuts-error')?.textContent).toBe(STORE_WRITE_FAILED_COPY)
    expect(byTestId('shortcut-row-editing')).not.toBeNull()
    expect(warn).toHaveBeenCalledWith('[claude-watcher][shortcuts] code=shortcuts_remove_failed')
  })

  it('an unknown delete failure gets delete copy, never the message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    removeMock.mockImplementationOnce(() => Promise.reject(new Error('secret phrase')))
    render()
    click(byTestId('shortcut-edit-sc-1'))
    click(byTestId('shortcut-delete'))
    click(byTestId('shortcut-delete'))
    await act(async () => {})
    expect(byTestId('shortcuts-error')?.textContent).toBe('Could not delete the shortcut.')
  })
})
