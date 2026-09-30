// Action feedback (spec 2026-09-29 §2.3) — moving a card: the card leaves the board being looked
// at, so the toast is the only sign it worked, and it names where it went (in its tint). A refusal
// says so — it used to be an unhandled rejection.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { moveCardToWorkspace } from './cardActions'
import { boardStore, type BoardSession } from '../stores/boardStore'
import { toastStore } from '../stores/toastStore'
import { workspacesStore } from '../stores/workspacesStore'

const CARD: BoardSession = {
  id: 'sess-1',
  sessionName: 'billing api',
  projectPath: '/p',
  status: 'Idle',
  pid: 1,
  column: 'idle',
  enteredColumnAt: 1,
  workspaceId: 'default',
  tagIds: []
}

let setWorkspace: ReturnType<typeof vi.fn>
beforeEach(() => {
  setWorkspace = vi.fn(() => Promise.resolve())
  ;(window as unknown as { launch: unknown }).launch = { setWorkspace }
  boardStore.setState({ sessionsById: { 'sess-1': CARD } })
  workspacesStore.setState({
    workspaces: [
      { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
      { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
    ],
    activeId: 'default',
    loaded: true
  })
  toastStore.setState({ toasts: [] })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('moveCardToWorkspace', () => {
  it('asks main, then toasts where the card went, the workspace in its tint', async () => {
    await moveCardToWorkspace('sess-1', 'w1')
    expect(setWorkspace).toHaveBeenCalledWith('sess-1', 'w1')
    const [t] = toastStore.getState().toasts
    expect(t?.kind).toBe('success')
    expect(t?.title).toBe('Moved "billing api" to')
    expect(t?.workspace).toEqual({ name: 'Ops', tone: 'blue' })
  })

  it('a refused move is an error toast and a code-only log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setWorkspace.mockImplementation(() => Promise.reject(new Error('workspace_not_found /x')))
    await moveCardToWorkspace('sess-1', 'w1')
    expect(toastStore.getState().toasts.map((t) => [t.kind, t.title])).toEqual([
      ['error', 'Could not move "billing api".']
    ])
    expect(warn).toHaveBeenCalledWith('[claude-watcher][workspaces] code=move_card_failed')
  })
})
