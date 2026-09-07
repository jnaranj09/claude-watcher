// Phrase shortcuts — the Manage dialog (a list, plus a separate editor card).
//
// Covers: the list shows name/chord-sequence/phrase; the empty state; add → record a 1..3 chord
// sequence → Save calls window.shortcuts.save with the right payload; Enter finishes, a third
// chord auto-finishes, Backspace drops one, Escape discards; an AltGr keystroke is refused; the
// two-step delete; the store-error copy; and the layout/onboarding contract — the edited row
// leaves the list, and the "how" text sits next to the control it explains.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { ShortcutsDialog } from './ShortcutsDialog'
import { shortcutsStore } from '../../stores/shortcutsStore'

const A = { id: 'sc-1', name: 'approve', keys: ['Ctrl+Alt+A'], text: 'I explicitly approve' }

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

/** Arm, press one chord, finish with Enter — the common single-chord case. */
function recordChord(key: string): void {
  arm()
  chord(key)
  pressKey('Enter')
}

function recorderText(): string {
  return byTestId('chord-recorder')?.textContent ?? ''
}

describe('ShortcutsDialog', () => {
  it('lists the saved shortcuts with their chord and phrase', () => {
    render()
    expect(document.body.textContent).toContain('approve')
    expect(document.body.textContent).toContain('Ctrl+Alt+A')
    expect(document.body.textContent).toContain('I explicitly approve')
  })

  it('renders a multi-chord binding as a space-joined sequence', () => {
    act(() =>
      shortcutsStore.setState({
        shortcuts: [{ id: 'sc-2', name: 'long', keys: ['Ctrl+Alt+O', 'Ctrl+Alt+A'], text: 'go' }],
        loaded: true
      })
    )
    render()
    expect(document.body.textContent).toContain('Ctrl+Alt+O Ctrl+Alt+A')
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
    recordChord('a')

    click(byTestId('shortcut-save'))

    expect(saveMock).toHaveBeenCalledWith({
      name: 'approve',
      keys: ['Ctrl+Alt+A'],
      text: 'I explicitly approve'
    })
  })

  it('records a two-chord sequence and finishes on Enter', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'approve')
    type(byTestId('shortcut-text-input'), 'go ahead')

    arm()
    chord('o')
    expect(recorderText()).toContain('Ctrl+Alt+O')
    chord('a')
    pressKey('Enter')

    click(byTestId('shortcut-save'))

    expect(saveMock).toHaveBeenCalledWith({
      name: 'approve',
      keys: ['Ctrl+Alt+O', 'Ctrl+Alt+A'],
      text: 'go ahead'
    })
  })

  it('auto-finishes at three chords and ignores a fourth', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    click(byTestId('shortcuts-add'))
    arm()
    chord('o')
    chord('a')
    chord('z')
    // Disarmed: the label is the committed value, not the "…" progress form.
    expect(recorderText()).toContain('Ctrl+Alt+O Ctrl+Alt+A Ctrl+Alt+Z')
    // A fourth chord is ignored because the recorder is no longer armed.
    chord('b')
    expect(recorderText()).toContain('Ctrl+Alt+O Ctrl+Alt+A Ctrl+Alt+Z')
    expect(recorderText()).not.toContain('Ctrl+Alt+B')
  })

  it('drops the last chord on Backspace', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    click(byTestId('shortcuts-add'))
    arm()
    chord('o')
    chord('a')
    pressKey('Backspace')
    pressKey('Enter')
    expect(recorderText()).toContain('Ctrl+Alt+O')
    expect(recorderText()).not.toContain('Ctrl+Alt+A')
  })

  it('discards a partial recording on Escape', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    click(byTestId('shortcuts-add'))
    arm()
    chord('o')
    pressKey('Escape')
    expect(recorderText()).toContain('Set chord')
  })

  // The reserved-letter list is gone (design §6): every letter is assignable now.
  it('accepts a formerly reserved letter and keeps Save enabled', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'x')
    type(byTestId('shortcut-text-input'), 'y')
    recordChord('n')

    expect(recorderText()).toContain('Ctrl+Alt+N')
    expect(byTestId('chord-hint')).toBeNull()
    expect((byTestId('shortcut-save') as HTMLButtonElement | null)?.disabled).toBe(false)
  })

  // Design §5 hazard 2 — the recorder shares chordFromEvent with the terminal matcher, so an
  // AltGr composition cannot be recorded either.
  it('refuses an AltGr keystroke with the shape hint and keeps Save disabled', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    click(byTestId('shortcuts-add'))
    type(byTestId('shortcut-name-input'), 'x')
    type(byTestId('shortcut-text-input'), 'y')
    arm()
    pressKey('@', { ctrlKey: true, altKey: true })

    expect(byTestId('chord-hint')?.textContent).toContain('Hold Ctrl+Alt')
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
    recordChord('a')
    click(byTestId('shortcut-save'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(byTestId('shortcuts-error')?.textContent).toContain('already used')
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

  // Onboarding: the "how" sits next to the control it explains, and it is there BEFORE the
  // recorder is armed — a new operator should not have to guess what to press first.
  it('explains how to record a chord before the recorder is armed', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    click(byTestId('shortcuts-add'))

    // Not the armed hint — that element exists only while recording.
    expect(byTestId('chord-hint')).toBeNull()
    expect(document.body.textContent).toContain('hold Ctrl+Alt and press a letter')
    expect(document.body.textContent).toContain('Chain up to 3 for a sequence')
  })

  it('coaches through the sequence while the recorder is armed', () => {
    act(() => shortcutsStore.setState({ shortcuts: [], loaded: true }))
    render()
    click(byTestId('shortcuts-add'))

    arm()
    expect(byTestId('chord-hint')?.textContent).toContain('Escape cancels')
    chord('o')
    expect(byTestId('chord-hint')?.textContent).toContain('Enter to finish')
  })

  it('says what a shortcut does, and that nothing is sent for you', () => {
    render()
    expect(document.body.textContent).toContain('You press Enter to send.')
    click(byTestId('shortcuts-add'))
    expect(document.body.textContent).toContain('Nothing is sent until you press Enter.')
  })
})
