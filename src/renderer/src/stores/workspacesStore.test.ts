import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WORKSPACE_ID } from '../../../shared/schemas/workspace'
import {
  loadWorkspaces,
  removeWorkspace,
  saveWorkspace,
  selectActiveWorkspace,
  setActiveWorkspace,
  workspacesStore
} from './workspacesStore'

const defaultRow = {
  id: DEFAULT_WORKSPACE_ID,
  name: 'Default',
  color: 'slate' as const,
  defaultCwd: null
}
const ops = { id: 'w1', name: 'Ops', color: 'blue' as const, defaultCwd: null }
const view = { activeId: DEFAULT_WORKSPACE_ID, workspaces: [defaultRow, ops] }

beforeEach(() => {
  workspacesStore.setState({ workspaces: [], activeId: DEFAULT_WORKSPACE_ID, loaded: false })
  window.workspaces = {
    list: vi.fn().mockResolvedValue(view),
    save: vi.fn().mockResolvedValue({ saved: ops, ...view }),
    remove: vi.fn().mockResolvedValue({ activeId: DEFAULT_WORKSPACE_ID, workspaces: [defaultRow] }),
    setActive: vi.fn().mockResolvedValue({ ...view, activeId: 'w1' })
  } as never
})

describe('workspacesStore', () => {
  it('hydrates from list and flips loaded', async () => {
    await loadWorkspaces()
    expect(workspacesStore.getState().workspaces).toHaveLength(2)
    expect(workspacesStore.getState().loaded).toBe(true)
  })

  it('survives a failed list without throwing and stays unloaded', async () => {
    window.workspaces.list = vi.fn().mockRejectedValue(new Error('boom')) as never
    // Matches templatesStore.test.ts / shortcutsStore.test.ts: the swallow path legitimately
    // logs, so silence + assert on it rather than let it leak into the test run's stderr.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(loadWorkspaces()).resolves.toBeUndefined()
    expect(workspacesStore.getState().loaded).toBe(false)
    expect(warn).toHaveBeenCalledWith('[claude-watcher][workspaces] code=workspaces_load_failed')
    warn.mockRestore()
  })

  it('replaces the whole projection from a save result and returns the saved row', async () => {
    const saved = await saveWorkspace({ name: 'Ops', color: 'blue', defaultCwd: null })
    expect(saved).toEqual(ops)
    expect(workspacesStore.getState().workspaces).toHaveLength(2)
  })

  it('rethrows a save error so the dialog can map the code to copy', async () => {
    window.workspaces.save = vi.fn().mockRejectedValue(new Error('workspace_name_taken')) as never
    await expect(saveWorkspace({ name: 'Ops', color: 'blue', defaultCwd: null })).rejects.toThrow(
      'workspace_name_taken'
    )
  })

  it('rethrows a remove error (the delete guards are operator-facing copy)', async () => {
    window.workspaces.remove = vi
      .fn()
      .mockRejectedValue(new Error('workspace_has_sessions')) as never
    await expect(removeWorkspace('w1')).rejects.toThrow('workspace_has_sessions')
  })

  it('setActive updates activeId from the result, not optimistically', async () => {
    await setActiveWorkspace('w1')
    expect(workspacesStore.getState().activeId).toBe('w1')
  })

  it('selectActiveWorkspace resolves the row, and falls back to null when it is gone', async () => {
    await loadWorkspaces()
    expect(selectActiveWorkspace(workspacesStore.getState())?.id).toBe(DEFAULT_WORKSPACE_ID)
    workspacesStore.setState({ activeId: 'ghost' })
    expect(selectActiveWorkspace(workspacesStore.getState())).toBeNull()
  })
})
