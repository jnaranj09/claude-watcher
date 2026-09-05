// Phrase shortcuts — the Manage dialog (the VSCode-style table).
//
// Covers: the table lists name/chord/phrase; the empty state; add → record a chord → Save calls
// window.shortcuts.save with the right payload; a reserved chord is refused (hint + Save stays
// disabled); the two-step delete; and the store-error copy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { ShortcutsDialog } from './ShortcutsDialog'
import { shortcutsStore } from '../../stores/shortcutsStore'

const A = { id: 'sc-1', name: 'approve', keys: 'Ctrl+Shift+A', text: 'I explicitly approve' }

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
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => shortcutsStore.getState().hydrate([]))
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

function recordChord(key: string): void {
  click(byTestId('chord-recorder'))
  act(() => {
    byTestId('chord-recorder')?.dispatchEvent(
      new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, bubbles: true })
    )
  })
}

describe('ShortcutsDialog', () => {
  it('lists the saved shortcuts with their chord and phrase', () => {
    render()
    expect(document.body.textContent).toContain('approve')
    expect(document.body.textContent).toContain('Ctrl+Shift+A')
    expect(document.body.textContent).toContain('I explicitly approve')
  })

  it('shows an empty state when there are none', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    expect(byTestId('shortcuts-empty')).not.toBeNull()
  })

  it('saves a new shortcut with the recorded chord', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'approve')
    type(byTestId('shortcut-text-input'), 'I explicitly approve')
    recordChord('A')

    click(byTestId('shortcut-save'))

    expect(saveMock).toHaveBeenCalledWith({
      name: 'approve',
      keys: 'Ctrl+Shift+A',
      text: 'I explicitly approve'
    })
  })

  it('refuses a reserved chord and keeps Save disabled', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'x')
    type(byTestId('shortcut-text-input'), 'y')
    recordChord('N')

    expect(byTestId('chord-hint')?.textContent).toContain('reserved')
    expect((byTestId('shortcut-save') as HTMLButtonElement | null)?.disabled).toBe(true)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('deletes only after a confirm click', () => {
    render()
    click(byTestId('shortcut-edit-sc-1'))
    click(byTestId('shortcut-delete'))
    expect(removeMock).not.toHaveBeenCalled()
    click(byTestId('shortcut-delete'))
    expect(removeMock).toHaveBeenCalledWith('sc-1')
  })

  it('renders the copy for a taken chord', async () => {
    saveMock.mockRejectedValueOnce(new Error('Error invoking remote method: shortcut_keys_taken'))
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'x')
    type(byTestId('shortcut-text-input'), 'y')
    recordChord('A')
    click(byTestId('shortcut-save'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(byTestId('shortcuts-error')?.textContent).toContain('already used')
  })
})
