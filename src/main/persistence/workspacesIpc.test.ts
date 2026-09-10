import { describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_ID } from '../../shared/schemas/workspace'
import { WORKSPACE_ERROR, createWorkspacesStore } from './workspaces'
import { createWorkspacesIpcHandlers, parseSessionWorkspaceMove } from './workspacesIpc'

function store(): ReturnType<typeof createWorkspacesStore> {
  let n = 0
  return createWorkspacesStore({ newId: () => `w${++n}` })
}

function handlers(): ReturnType<typeof createWorkspacesIpcHandlers> {
  return createWorkspacesIpcHandlers(store())
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

// The FIFTH workspaces channel's seam (ipc.md step 5). Its body was inline in index.ts, which
// no node test can import, so both gates were unpinned; it now lives beside the other four.
describe('parseSessionWorkspaceMove', () => {
  it('returns the validated move when the target workspace exists', () => {
    const s = store()
    const { saved } = s.save({ name: 'Ops', color: 'blue', defaultCwd: null })
    expect(parseSessionWorkspaceMove(s, { sessionId: 'sess-1', workspaceId: saved.id })).toEqual({
      sessionId: 'sess-1',
      workspaceId: saved.id
    })
  })

  it('THROWS on a workspace main does not know — never applies the move', () => {
    // The load-bearing gate: every board/rail selector filters on the active workspace, so a
    // card moved into a workspace that does not exist is stranded where NO view can show it.
    // Non-vacuous — 'ghost' is absent from a store whose only row is Default, and the positive
    // case above proves a real id is accepted, so this cannot be an always-throw.
    expect(() =>
      parseSessionWorkspaceMove(store(), { sessionId: 's', workspaceId: 'ghost' })
    ).toThrow(WORKSPACE_ERROR.notFound)
  })

  it('accepts the Default workspace (the id every install has)', () => {
    expect(
      parseSessionWorkspaceMove(store(), { sessionId: 's', workspaceId: DEFAULT_WORKSPACE_ID })
    ).toEqual({ sessionId: 's', workspaceId: DEFAULT_WORKSPACE_ID })
  })

  it('fails CLOSED on a malformed arg before it ever reaches the store', () => {
    const s = store()
    expect(() =>
      parseSessionWorkspaceMove(s, { sessionId: '', workspaceId: DEFAULT_WORKSPACE_ID })
    ).toThrow()
    expect(() => parseSessionWorkspaceMove(s, { sessionId: 's' })).toThrow()
    expect(() => parseSessionWorkspaceMove(s, null)).toThrow()
  })
})
