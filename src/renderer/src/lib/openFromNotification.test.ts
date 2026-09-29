// R29 — a notification click opens its session: switch to the session's workspace (only once main
// confirmed it), then open the session's own terminal.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openFromNotification } from './openFromNotification'
import { boardStore } from '../stores/boardStore'
import { workspacesStore } from '../stores/workspacesStore'
import type { BoardSession } from '../stores/boardStore'
import type { Workspace } from '../../../shared/ipc/contract'

const ID = 'aaaa1111-0000-4000-8000-000000000001'
const ROWS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Work', color: 'blue', defaultCwd: null }
]

let setActive: ReturnType<typeof vi.fn>

function card(workspaceId: string): BoardSession {
  return {
    id: ID,
    sessionName: 'proj',
    projectPath: '/p/proj',
    status: 'NeedsPermission',
    pid: 1,
    column: 'needs-you',
    enteredColumnAt: 1,
    workspaceId,
    tagIds: []
  }
}

function seed(workspaceId: string): void {
  boardStore.setState({
    sessionsById: { [ID]: card(workspaceId) },
    terminalIdBySessionId: { [ID]: 't-1' },
    launchedTerminals: {
      't-1': { terminalId: 't-1', launchedAt: 2, label: 'proj', workspaceId },
      't-other': { terminalId: 't-other', launchedAt: 1, label: 'other', workspaceId: 'default' }
    },
    viewMode: 'focused',
    focusedTerminalId: 't-other',
    selectedId: null
  })
}

beforeEach(() => {
  setActive = vi.fn((id: string) => Promise.resolve({ activeId: id, workspaces: ROWS }))
  ;(window as unknown as { workspaces: unknown }).workspaces = { setActive }
  workspacesStore.setState({ workspaces: ROWS, activeId: 'default', loaded: true })
})

afterEach(() => {
  boardStore.setState({
    sessionsById: {},
    terminalIdBySessionId: {},
    launchedTerminals: {},
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null
  })
})

describe('openFromNotification (R29)', () => {
  it('a session in the active workspace: opens its own terminal, no workspace switch', async () => {
    seed('default')
    await openFromNotification(ID)
    expect(setActive).not.toHaveBeenCalled()
    expect(boardStore.getState().focusedTerminalId).toBe('t-1')
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(boardStore.getState().selectedId).toBe(ID)
  })

  it('a session in ANOTHER workspace: switches to it, then opens the session', async () => {
    seed('w1')
    await openFromNotification(ID)
    expect(setActive).toHaveBeenCalledWith('w1')
    expect(workspacesStore.getState().activeId).toBe('w1')
    expect(boardStore.getState().focusedTerminalId).toBe('t-1')
    expect(boardStore.getState().selectedId).toBe(ID)
  })

  it('a switch main refused opens nothing', async () => {
    seed('w1')
    setActive.mockRejectedValueOnce(new Error('workspace_not_found'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await openFromNotification(ID)
    warn.mockRestore()
    expect(workspacesStore.getState().activeId).toBe('default')
    expect(boardStore.getState().focusedTerminalId).toBe('t-other')
    expect(boardStore.getState().selectedId).toBeNull()
  })

  it('a card that already left is a no-op', async () => {
    seed('w1')
    boardStore.setState({ sessionsById: {} })
    await openFromNotification(ID)
    expect(setActive).not.toHaveBeenCalled()
    expect(boardStore.getState().focusedTerminalId).toBe('t-other')
  })
})
