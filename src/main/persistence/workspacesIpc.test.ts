import { describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_ID } from '../../shared/schemas/workspace'
import { createWorkspacesStore } from './workspaces'
import { createWorkspacesIpcHandlers } from './workspacesIpc'

function handlers(): ReturnType<typeof createWorkspacesIpcHandlers> {
  let n = 0
  return createWorkspacesIpcHandlers(createWorkspacesStore({ newId: () => `w${++n}` }))
}

describe('createWorkspacesIpcHandlers', () => {
  it('list returns the file view', () => {
    expect(handlers().list()).toEqual({
      activeId: DEFAULT_WORKSPACE_ID,
      workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: 'Default', color: 'slate', defaultCwd: null }]
    })
  })

  it('save parses its arg and throws on a malformed one', () => {
    const h = handlers()
    expect(h.save({ name: 'Ops', color: 'blue', defaultCwd: null }).saved.name).toBe('Ops')
    expect(() => h.save({ name: '', color: 'blue' })).toThrow()
    expect(() => h.save({ name: 'Ops', color: 'chartreuse' })).toThrow()
    expect(() => h.save(null)).toThrow()
  })

  it('remove parses its arg and throws on a malformed one', () => {
    const h = handlers()
    const { saved } = h.save({ name: 'Ops', color: 'blue', defaultCwd: null })
    expect(h.remove({ id: saved.id }).workspaces).toHaveLength(1)
    expect(() => h.remove({ id: '' })).toThrow()
    expect(() => h.remove({})).toThrow()
  })

  it('setActive parses its arg and throws on a malformed one', () => {
    const h = handlers()
    const { saved } = h.save({ name: 'Ops', color: 'blue', defaultCwd: null })
    expect(h.setActive({ id: saved.id }).activeId).toBe(saved.id)
    expect(() => h.setActive({ id: 123 })).toThrow()
  })
})
