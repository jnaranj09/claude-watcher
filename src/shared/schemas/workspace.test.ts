import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACES_FILE,
  WORKSPACES_FILE_VERSION,
  WorkspaceSaveSchema,
  WorkspaceSchema,
  WorkspacesFileSchema
} from './workspace'

const ok = { id: 'w1', name: 'Devops', color: 'blue', defaultCwd: '/home/j/ops' }

describe('WorkspaceSchema', () => {
  it('accepts a full row', () => {
    expect(WorkspaceSchema.parse(ok)).toEqual(ok)
  })

  it('defaults defaultCwd to null when the key is absent', () => {
    const parsed = WorkspaceSchema.parse({ id: 'w1', name: 'Devops', color: 'blue' })
    expect(parsed.defaultCwd).toBeNull()
  })

  it('trims the name and rejects a blank one', () => {
    expect(WorkspaceSchema.parse({ ...ok, name: '  Devops  ' }).name).toBe('Devops')
    expect(WorkspaceSchema.safeParse({ ...ok, name: '   ' }).success).toBe(false)
  })

  it('rejects a name with a control character', () => {
    expect(WorkspaceSchema.safeParse({ ...ok, name: 'a\nb' }).success).toBe(false)
  })

  it('rejects a name over 60 characters', () => {
    expect(WorkspaceSchema.safeParse({ ...ok, name: 'x'.repeat(61) }).success).toBe(false)
  })

  it('enum-locks the color', () => {
    expect(WorkspaceSchema.safeParse({ ...ok, color: 'chartreuse' }).success).toBe(false)
  })

  it('rejects a blank id and a blank defaultCwd', () => {
    expect(WorkspaceSchema.safeParse({ ...ok, id: '' }).success).toBe(false)
    expect(WorkspaceSchema.safeParse({ ...ok, defaultCwd: '' }).success).toBe(false)
  })
})

describe('WorkspaceSaveSchema', () => {
  it('accepts a create (no id) and an update (id)', () => {
    expect(WorkspaceSaveSchema.parse({ name: 'New', color: 'rose' }).id).toBeUndefined()
    expect(WorkspaceSaveSchema.parse({ id: 'w1', name: 'New', color: 'rose' }).id).toBe('w1')
  })
})

describe('WorkspacesFileSchema', () => {
  it('accepts the seeded default file', () => {
    expect(WorkspacesFileSchema.parse(DEFAULT_WORKSPACES_FILE)).toEqual(DEFAULT_WORKSPACES_FILE)
  })

  it('rejects an empty workspaces array', () => {
    expect(
      WorkspacesFileSchema.safeParse({
        version: WORKSPACES_FILE_VERSION,
        activeId: DEFAULT_WORKSPACE_ID,
        workspaces: []
      }).success
    ).toBe(false)
  })

  it('rejects a different version', () => {
    expect(
      WorkspacesFileSchema.safeParse({ ...DEFAULT_WORKSPACES_FILE, version: 2 }).success
    ).toBe(false)
  })

  it('seeds a Default workspace that owns the fixed id', () => {
    expect(DEFAULT_WORKSPACES_FILE.activeId).toBe(DEFAULT_WORKSPACE_ID)
    expect(DEFAULT_WORKSPACES_FILE.workspaces[0]?.id).toBe(DEFAULT_WORKSPACE_ID)
  })
})
