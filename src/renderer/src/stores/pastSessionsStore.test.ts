import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  pastSessionsStore,
  loadPastSessions,
  forgetPastSession,
  openPastSession,
  resumeDeadTerminal
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
    // It tells the caller whether it worked: the dialog puts a failure on its error line.
    expect(await loadPastSessions()).toBe(true)
    expect(pastSessionsStore.getState()).toMatchObject({ sessions: [ROW], loaded: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stub('pastSessions', { list: vi.fn(() => Promise.reject(new Error('x'))) })
    expect(await loadPastSessions()).toBe(false)
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

// UX-10 (decided: Resume REPLACES the dead pane) — the dead pane's Resume opens the conversation
// its terminal last ran as a NEW terminal and drops the dead one, so dead panes never pile up.
describe('resumeDeadTerminal', () => {
  it('opens the resumed terminal, takes the view and forgets the dead pane', async () => {
    const setActive = vi.fn(() => Promise.resolve({ activeId: 'w1', workspaces: [] }))
    stub('workspaces', { setActive })
    const resumeTerminal = vi.fn(() =>
      Promise.resolve({ terminalId: 'term-new', workspaceId: 'w1', name: 'a' })
    )
    stub('pastSessions', { resumeTerminal })
    boardStore.setState({
      viewMode: 'focused',
      focusedTerminalId: 'term-dead',
      launchedTerminals: {
        'term-dead': { terminalId: 'term-dead', launchedAt: 1, label: 'a', workspaceId: 'w1' }
      }
    })
    await resumeDeadTerminal('term-dead')
    expect(resumeTerminal).toHaveBeenCalledWith('term-dead')
    expect(setActive).toHaveBeenCalledWith('w1')
    expect(boardStore.getState().focusedTerminalId).toBe('term-new')
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(Object.keys(boardStore.getState().launchedTerminals)).toEqual(['term-new'])
  })

  it('a refusal rethrows and keeps the dead pane', async () => {
    stub('pastSessions', {
      resumeTerminal: vi.fn(() => Promise.reject(new Error('transcript_missing')))
    })
    boardStore.setState({
      viewMode: 'focused',
      focusedTerminalId: 'term-dead',
      launchedTerminals: {
        'term-dead': { terminalId: 'term-dead', launchedAt: 1, label: 'a', workspaceId: 'default' }
      }
    })
    await expect(resumeDeadTerminal('term-dead')).rejects.toThrow('transcript_missing')
    expect(boardStore.getState().focusedTerminalId).toBe('term-dead')
    expect(Object.keys(boardStore.getState().launchedTerminals)).toEqual(['term-dead'])
  })
})
