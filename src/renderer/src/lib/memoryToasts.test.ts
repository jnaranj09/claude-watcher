// Memory phase 2 "Feedback": the board toast each save from a session leaves (saved, nothing new,
// failed, claude too old), its counts line, and `Show`, which opens Memory on that session.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, createElement } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  NO_COUNTS,
  type MemoryCounts,
  type MemoryExtractResult
} from '../../../shared/schemas/memory'
import { countsCopy, openMemoryForSession, showExtractResult } from './memoryToasts'
import { toastStore, isDialogToast, type Toast } from '../stores/toastStore'
import { boardStore } from '../stores/boardStore'
import { Toaster } from '../components/Toaster/Toaster'
import { renderTracked, unmountRendered } from '../test/renderComponent'

afterEach(() => {
  unmountRendered()
  act(() => {
    toastStore.setState({ toasts: [] })
    boardStore.setState({
      memoryDialogOpen: false,
      memoryDialogTarget: null,
      settingsDialogOpen: false
    })
  })
})

const result = (over: Partial<MemoryExtractResult> = {}): MemoryExtractResult => ({
  sessionName: 'fix api port',
  trigger: 'end',
  outcome: 'saved',
  counts: { specifics: 4, facts: 1, tasks: 2, episodes: 1 },
  reason: null,
  ...over
})

/** The one toast on the board, after `showExtractResult`. */
function onlyToast(): Toast {
  const toasts = toastStore.getState().toasts
  expect(toasts).toHaveLength(1)
  const [t] = toasts
  if (t === undefined) throw new Error('no toast')
  expect(isDialogToast(t)).toBe(false)
  return t
}

describe('countsCopy', () => {
  it.each<[MemoryCounts, string]>([
    [{ specifics: 4, facts: 1, tasks: 2, episodes: 1 }, '4 specifics, 1 fact, 2 tasks, 1 episode'],
    [{ specifics: 1, facts: 0, tasks: 0, episodes: 1 }, '1 specific, 1 episode'],
    [{ specifics: 0, facts: 2, tasks: 1, episodes: 0 }, '2 facts, 1 task']
  ])('counts %j read %s', (c, text) => {
    expect(countsCopy(c)).toBe(text)
  })
})

describe('showExtractResult', () => {
  it('a saved result is a success toast with Show, which opens Memory for that session', async () => {
    const user = userEvent.setup()
    renderTracked(createElement(Toaster))
    act(() => showExtractResult(result(), openMemoryForSession))
    const t = onlyToast()
    expect(t.kind).toBe('success')
    expect(t.title).toBe('Memory saved from "fix api port".')
    expect(t.detail).toBe('4 specifics, 1 fact, 2 tasks, 1 episode')
    expect(t.action?.label).toBe('Show')
    expect(t.action?.icon).toBe('open')

    const card = screen.getByTestId('toast')
    expect(within(card).getByText('Memory saved from "fix api port".')).toBeVisible()
    expect(within(card).getByText('4 specifics, 1 fact, 2 tasks, 1 episode')).toBeVisible()
    await user.click(within(card).getByRole('button', { name: 'Show' }))
    expect(boardStore.getState().memoryDialogOpen).toBe(true)
    expect(boardStore.getState().memoryDialogTarget).toEqual({ sessionName: 'fix api port' })
  })

  it('a nothing result is an info toast with no action', () => {
    showExtractResult(result({ outcome: 'nothing', counts: NO_COUNTS }), openMemoryForSession)
    const t = onlyToast()
    expect(t.kind).toBe('info')
    expect(t.title).toBe('Nothing new to remember from "fix api port".')
    expect(t.action).toBeUndefined()
    expect(t.detail).toBeUndefined()
  })

  it('a failed result is an error toast, with the version line only for claude_version', () => {
    showExtractResult(
      result({ outcome: 'failed', counts: NO_COUNTS, trigger: 'checkpoint' }),
      openMemoryForSession
    )
    const plain = onlyToast()
    expect(plain.kind).toBe('error')
    expect(plain.title).toBe('Could not save memory from "fix api port".')
    expect(plain.detail).toBeUndefined()
    expect(plain.action).toBeUndefined()

    act(() => toastStore.setState({ toasts: [] }))
    showExtractResult(
      result({ outcome: 'failed', counts: NO_COUNTS, reason: 'claude_version' }),
      openMemoryForSession
    )
    const old = onlyToast()
    expect(old.kind).toBe('error')
    expect(old.title).toBe('Could not save memory from "fix api port".')
    expect(old.detail).toBe('Needs claude 2.1.323 or newer.')
    expect(old.action).toBeUndefined()
  })

  it('a toast names the session and its counts only: one toast per result', () => {
    showExtractResult(result({ sessionName: 'a' }), openMemoryForSession)
    showExtractResult(result({ sessionName: 'b', outcome: 'nothing' }), openMemoryForSession)
    expect(toastStore.getState().toasts.map((t) => [t.title, t.detail])).toEqual([
      ['Memory saved from "a".', '4 specifics, 1 fact, 2 tasks, 1 episode'],
      ['Nothing new to remember from "b".', undefined]
    ])
  })

  it.each<[string, unknown, string]>([
    [
      'a negative count',
      { ...result(), counts: { ...NO_COUNTS, tasks: -1 } },
      'path=counts.tasks issue=too_small'
    ],
    [
      'memory text riding along',
      { ...result(), body: 'a secret value' },
      'path= issue=unrecognized_keys'
    ],
    ['an empty name', { ...result(), sessionName: '' }, 'path=sessionName issue=too_small'],
    ['an unknown outcome', { ...result(), outcome: 'partial' }, 'path=outcome issue=invalid_value']
  ])('drops %s with its path and code only, and shows no toast', (_name, raw, where) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    showExtractResult(raw, openMemoryForSession)
    expect(toastStore.getState().toasts).toEqual([])
    expect(warn.mock.calls).toEqual([
      [`[claude-watcher][memory] code=memory_extract_result_invalid ${where}`]
    ])
    warn.mockRestore()
  })

  it('Show does nothing while another dialog is open', () => {
    act(() => boardStore.setState({ settingsDialogOpen: true }))
    showExtractResult(result(), openMemoryForSession)
    // The Toaster draws no action while a modal is open; the action itself is guarded too.
    act(() => toastStore.getState().runAction(onlyToast().id))
    expect(boardStore.getState().memoryDialogOpen).toBe(false)
    expect(boardStore.getState().memoryDialogTarget).toBeNull()
  })
})
