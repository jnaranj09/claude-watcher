// The Delete confirm and memory (owner, 2026-11-12): a session that saved memory items gets a
// neutral notice saying they are kept, and a box (unticked) to delete them too. The real confirm
// and the real `sessionExit.deleteTerminal` run; only `window.launch` and `window.memory` are
// stand-ins for main.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StopConfirm } from './StopConfirm'
import { boardStore } from '../../stores/boardStore'
import { toastStore } from '../../stores/toastStore'
import { deferred, type Deferred } from '../../test/deferred'

const PAYLOAD = { terminalId: 'term-1', sessionId: 'sess-1', sessionName: 'deploy' }

let del: ReturnType<typeof vi.fn<() => Promise<void>>>
let sessionCount: ReturnType<typeof vi.fn<(sessionId: string) => Promise<number>>>
let removeSession: ReturnType<typeof vi.fn<(sessionId: string) => Promise<number>>>
let unmount: (() => void) | undefined

function mount(
  payload: typeof PAYLOAD | (Omit<typeof PAYLOAD, 'sessionId'> & { sessionId: null }) = PAYLOAD
): void {
  unmount = render(<StopConfirm payload={payload} />).unmount
}

beforeEach(() => {
  del = vi.fn(() => Promise.resolve())
  sessionCount = vi.fn(() => Promise.resolve(3))
  removeSession = vi.fn(() => Promise.resolve(3))
  Object.defineProperty(window, 'launch', {
    value: { deleteSession: del },
    configurable: true,
    writable: true
  })
  Object.defineProperty(window, 'memory', {
    value: { sessionCount, removeSession },
    configurable: true,
    writable: true
  })
  act(() => {
    boardStore.setState({
      stopConfirm: PAYLOAD,
      viewMode: 'focused',
      focusedTerminalId: 'term-1',
      launchedTerminals: {
        'term-1': { terminalId: 'term-1', launchedAt: 1, label: 'deploy', workspaceId: 'default' }
      }
    })
  })
  toastStore.setState({ toasts: [] })
})
afterEach(() => {
  unmount?.()
  unmount = undefined
  vi.restoreAllMocks()
  act(() => boardStore.setState({ stopConfirm: null, viewMode: 'board', focusedTerminalId: null }))
})

const toasts = (): [string, string][] => toastStore.getState().toasts.map((t) => [t.kind, t.title])

describe('StopConfirm — what the session saved to memory', () => {
  it('a session that saved items shows a neutral notice and an unticked box', async () => {
    mount()
    const notice = await screen.findByTestId('stop-confirm-memory-notice')
    expect(sessionCount).toHaveBeenCalledWith('sess-1')
    expect(notice).toHaveTextContent('This session saved 3 items to memory.')
    expect(notice).toHaveTextContent('Kept in Memory, marked Session deleted.')
    expect(notice).toHaveAttribute('data-callout-tone', 'info')
    expect(screen.getByRole('checkbox', { name: 'Also delete from memory' })).not.toBeChecked()
  })

  it('one saved item is named in the singular', async () => {
    sessionCount.mockResolvedValue(1)
    mount()
    expect(await screen.findByTestId('stop-confirm-memory-notice')).toHaveTextContent(
      'This session saved 1 item to memory.'
    )
  })

  it('ticking the box changes the notice to say the items go with the session', async () => {
    mount()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Also delete from memory' }))
    const notice = screen.getByTestId('stop-confirm-memory-notice')
    expect(notice).toHaveTextContent('Deleted with the session. This cannot be undone.')
    expect(notice).not.toHaveTextContent('Kept in Memory')
  })

  it('a session that saved nothing shows no notice and no box', async () => {
    sessionCount.mockResolvedValue(0)
    mount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByTestId('stop-confirm-memory-notice')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('a pane with no session id asks nothing and shows no box', async () => {
    mount({ ...PAYLOAD, sessionId: null })
    await act(async () => {
      await Promise.resolve()
    })
    expect(sessionCount).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('a count that cannot be read shows no box and logs a code, never a value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    sessionCount.mockRejectedValue(new Error('memory_unavailable'))
    mount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(warn).toHaveBeenCalledWith('[claude-watcher][exit] code=memory_session_count_failed')
  })
})

describe('StopConfirm — Delete with the memory box', () => {
  it('box unticked: Delete removes the session and leaves its memory alone', async () => {
    mount()
    await screen.findByTestId('stop-confirm-memory-notice')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(del).toHaveBeenCalledWith('term-1', 'sess-1')
    expect(removeSession).not.toHaveBeenCalled()
    expect(toasts()).toEqual([])
  })

  it('box ticked: the session is deleted first, then its memory, and a toast says so', async () => {
    const pending: Deferred<void> = deferred<void>()
    del.mockImplementation(() => pending.promise)
    mount()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Also delete from memory' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(del).toHaveBeenCalledWith('term-1', 'sess-1')
    // Main marks the items `Session deleted` while it deletes the session: memory goes after.
    expect(removeSession).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(removeSession).toHaveBeenCalledWith('sess-1')
    expect(toasts()).toEqual([['success', 'Deleted what "deploy" saved to memory.']])
  })

  it('box ticked, session delete refused: its memory is not touched', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    del.mockRejectedValue(new Error('boom'))
    mount()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Also delete from memory' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(removeSession).not.toHaveBeenCalled()
    expect(toasts()).toEqual([['error', 'Could not delete "deploy".']])
  })

  it('box ticked, memory delete refused: an error toast says the items are still there', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    removeSession.mockRejectedValue(new Error('store_write_failed'))
    mount()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Also delete from memory' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(toasts()).toEqual([
      ['error', 'Could not delete what "deploy" saved to memory. It is still in Memory.']
    ])
    expect(warn).toHaveBeenCalledWith('[claude-watcher][exit] code=delete_session_memory_failed')
  })
})
