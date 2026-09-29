// Phrase shortcuts — the Manage dialog on the two-column standard (spec 2026-09-29 §4): a rail
// of name + alias, the form on the right, the placeholder while nothing is open.
//
// Covers: the rail and the form; the empty state; + New → type an alias → Save calls
// window.shortcuts.save with the alias lowercased; a placeholder gap disables Save; the two-step
// delete; the store's alias_taken error copy; the subtitle naming the open chord. The chord
// RECORDER moved to Settings → Keyboard, and its tests with it (Settings.test.tsx).
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

describe('ShortcutsDialog', () => {
  it('the rail lists name and alias; the phrase shows in the form', () => {
    render()
    expect(byTestId('shortcut-row-sc-1')?.textContent).toContain('approve')
    expect(byTestId('shortcut-alias-sc-1')?.textContent).toBe('ap')
    click(byTestId('shortcut-select-sc-1'))
    expect((byTestId('shortcut-text-input') as HTMLInputElement).value).toBe('I explicitly approve')
  })

  it('shows an empty state when there are none', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    expect(byTestId('shortcuts-empty')).not.toBeNull()
  })

  it('the editor has an Alias field and Save sends it lowercased', () => {
    render()
    click(byTestId('shortcut-new'))
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
    click(byTestId('shortcut-new'))
    type(byTestId('shortcut-name-input'), 'x')
    type(byTestId('shortcut-alias-input'), 'x')
    type(byTestId('shortcut-text-input'), 'do $2')
    expect((byTestId('shortcut-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders the store alias_taken error as copy', async () => {
    saveMock.mockImplementationOnce(() => Promise.reject(new Error('shortcut_alias_taken')))
    render()
    click(byTestId('shortcut-new'))
    type(byTestId('shortcut-name-input'), 'x')
    type(byTestId('shortcut-alias-input'), 'ap')
    type(byTestId('shortcut-text-input'), 'y')
    click(byTestId('shortcut-save'))
    await act(async () => {})
    expect(byTestId('shortcuts-error')?.textContent).toBe(
      'That alias is already used by another shortcut.'
    )
  })

  it('the subtitle names the live chord', () => {
    render()
    expect(byTestId('shortcuts-subtitle')?.textContent).toContain('Ctrl+Alt+X')
  })

  it('deletes only after a confirm click', () => {
    render()
    click(byTestId('shortcut-select-sc-1'))
    click(byTestId('shortcut-delete'))
    expect(removeMock).not.toHaveBeenCalled()
    click(byTestId('shortcut-delete'))
    expect(removeMock).toHaveBeenCalledWith('sc-1')
  })

  // --- layout / onboarding -------------------------------------------------------------------
  // The rail keeps every row; the open one is marked selected, and its form is on the right.
  it('the open row stays in the rail, marked selected', () => {
    render()
    click(byTestId('shortcut-select-sc-1'))
    expect(byTestId('shortcut-row-sc-1')?.getAttribute('data-selected')).toBe('true')
    expect(byTestId('shortcut-form')).not.toBeNull()
  })

  // No Cancel (spec 2026-09-29 §4): picking another row, or + New, drops the draft.
  it('picking a row drops an unsaved New draft, and + New starts clean again', () => {
    render()
    click(byTestId('shortcut-new'))
    type(byTestId('shortcut-name-input'), 'half typed')
    click(byTestId('shortcut-select-sc-1'))
    expect((byTestId('shortcut-name-input') as HTMLInputElement).value).toBe('approve')
    click(byTestId('shortcut-new'))
    expect((byTestId('shortcut-name-input') as HTMLInputElement).value).toBe('')
  })

  it('says what a shortcut does, and that nothing is sent for you', () => {
    render()
    expect(document.body.textContent).toContain('You press Enter to send.')
    click(byTestId('shortcut-new'))
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
    click(byTestId('shortcut-new'))
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
    click(byTestId('shortcut-new'))
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
    click(byTestId('shortcut-new'))
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
    click(byTestId('shortcut-new'))
    type(byTestId('shortcut-name-input'), 'x')
    type(byTestId('shortcut-alias-input'), 'x')
    type(byTestId('shortcut-text-input'), 'do $2')
    expect(byTestId('shortcut-hint')?.textContent).toBe('Use $1, $2… in order, with no gap.')
  })

  it('shows no reason before anything was typed', () => {
    render()
    click(byTestId('shortcut-new'))
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
    click(byTestId('shortcut-select-sc-1'))
    click(byTestId('shortcut-delete'))
    click(byTestId('shortcut-delete'))
    await act(async () => {})
    expect(byTestId('shortcuts-error')?.textContent).toBe(STORE_WRITE_FAILED_COPY)
    expect(byTestId('shortcut-form')).not.toBeNull()
    expect(warn).toHaveBeenCalledWith('[claude-watcher][shortcuts] code=shortcuts_remove_failed')
  })

  it('an unknown delete failure gets delete copy, never the message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    removeMock.mockImplementationOnce(() => Promise.reject(new Error('secret phrase')))
    render()
    click(byTestId('shortcut-select-sc-1'))
    click(byTestId('shortcut-delete'))
    click(byTestId('shortcut-delete'))
    await act(async () => {})
    expect(byTestId('shortcuts-error')?.textContent).toBe('Could not delete the shortcut.')
  })
})

describe('Shortcuts on the two-column standard (spec 2026-09-29 §4)', () => {
  it('opens on the placeholder beside a rail of rows: name + alias', () => {
    render()
    expect(byTestId('shortcut-placeholder')?.textContent).toBe(
      'Select a shortcut on the left, or create a new one.'
    )
    expect(byTestId('shortcut-row-sc-1')?.textContent).toContain('approve')
    expect(byTestId('shortcut-alias-sc-1')?.textContent).toBe('ap')
    expect(document.querySelector('[role="table"]')).toBeNull()
  })

  it('has no Add shortcut, no Edit, no Cancel, no Open-with row', () => {
    render()
    click(byTestId('shortcut-select-sc-1'))
    for (const gone of [
      'shortcuts-add',
      'shortcut-edit-sc-1',
      'shortcut-cancel',
      'chord-recorder'
    ]) {
      expect(byTestId(gone)).toBeNull()
    }
  })

  it('picking a row opens its form; the footer is [Delete] [Save]', () => {
    render()
    click(byTestId('shortcut-select-sc-1'))
    expect((byTestId('shortcut-name-input') as HTMLInputElement).value).toBe('approve')
    const del = byTestId('shortcut-delete')
    const save = byTestId('shortcut-save')
    expect(save?.textContent).toBe('Save')
    expect(del?.parentElement).toBe(save?.parentElement)
    expect(
      (del?.compareDocumentPosition(save as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('+ New opens an empty form with no Delete', () => {
    render()
    click(byTestId('shortcut-new'))
    expect((byTestId('shortcut-name-input') as HTMLInputElement).value).toBe('')
    expect(byTestId('shortcut-delete')).toBeNull()
  })

  it('saving a new shortcut selects it (the form stays on the saved row)', async () => {
    const saved = { id: 'sc-9', name: 'deploy', alias: 'dp', text: 'ship it', workspaceId: null }
    saveMock.mockImplementation(() => Promise.resolve({ saved, shortcuts: [A, saved] }))
    render()
    click(byTestId('shortcut-new'))
    type(byTestId('shortcut-name-input'), 'deploy')
    type(byTestId('shortcut-alias-input'), 'dp')
    type(byTestId('shortcut-text-input'), 'ship it')
    click(byTestId('shortcut-save'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect((byTestId('shortcut-name-input') as HTMLInputElement).value).toBe('deploy')
    expect(byTestId('shortcut-row-sc-9')?.getAttribute('data-selected')).toBe('true')
  })
})
