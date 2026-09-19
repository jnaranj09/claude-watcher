import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  pastSessionsStore,
  loadPastSessions,
  forgetPastSession,
  openPastSession
} from './pastSessionsStore'
import { boardStore } from './boardStore'
import { workspacesStore } from './workspacesStore'

const ROW = {
  id: 's1',
  name: 'a',
  cwd: '/c',
  workspaceId: 'w1',
  tagIds: [],
  launchedAt: 1,
  endedAt: 2
}
const stub = (name: 'pastSessions' | 'workspaces', value: unknown): void => {
  ;(window as unknown as Record<string, unknown>)[name] = value
}

beforeEach(() => {
  pastSessionsStore.setState({ sessions: [], loaded: false })
  workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: true })
  boardStore.setState({ viewMode: 'board', focusedTerminalId: null, launchedTerminals: {} })
})

describe('pastSessionsStore', () => {
  it('load hydrates from the bridge; a failure logs a code and keeps the store', async () => {
    stub('pastSessions', { list: vi.fn(() => Promise.resolve([ROW])) })
    await loadPastSessions()
    expect(pastSessionsStore.getState()).toMatchObject({ sessions: [ROW], loaded: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stub('pastSessions', { list: vi.fn(() => Promise.reject(new Error('x'))) })
    await loadPastSessions()
    expect(pastSessionsStore.getState().sessions).toEqual([ROW])
    expect(warn).toHaveBeenCalledWith(
      '[claude-watcher][past-sessions] code=past_sessions_load_failed'
    )
    warn.mockRestore()
  })
  it('forget hydrates the returned list', async () => {
    stub('pastSessions', { forget: vi.fn(() => Promise.resolve([])) })
    pastSessionsStore.setState({ sessions: [ROW], loaded: true })
    await forgetPastSession('s1')
    expect(pastSessionsStore.getState().sessions).toEqual([])
  })
  it('open switches the active workspace when needed, then opens the terminal (takes the view)', async () => {
    const setActive = vi.fn(() => Promise.resolve({ activeId: 'w1', workspaces: [] }))
    stub('workspaces', { setActive })
    stub('pastSessions', {
      open: vi.fn(() => Promise.resolve({ terminalId: 'term-9', workspaceId: 'w1', name: 'a' }))
    })
    await openPastSession('s1')
    expect(setActive).toHaveBeenCalledWith('w1')
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(boardStore.getState().focusedTerminalId).toBe('term-9')
    expect(boardStore.getState().launchedTerminals['term-9']).toMatchObject({
      label: 'a',
      workspaceId: 'w1'
    })
  })
  it('open rethrows the code so the dialog can map it to copy', async () => {
    stub('pastSessions', { open: vi.fn(() => Promise.reject(new Error('folder_missing'))) })
    await expect(openPastSession('s1')).rejects.toThrow('folder_missing')
  })
})
