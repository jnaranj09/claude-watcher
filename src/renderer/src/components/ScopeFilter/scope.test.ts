// The Manage dialogs' scope filter — pure logic, no React.
import { describe, it, expect } from 'vitest'
import type { Workspace } from '../../../../shared/ipc/contract'
import {
  ALL_SCOPE,
  filterByScope,
  hasOrphans,
  knownWorkspaceIds,
  openingScope,
  scopeOf,
  scopeWorkspaceId,
  workspaceScope
} from './scope'

const W1: Workspace = { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
const W2: Workspace = { id: 'w2', name: 'Infra', color: 'green', defaultCwd: null }
const KNOWN = knownWorkspaceIds([W1, W2])

const GLOBAL = { id: 'g', workspaceId: null }
const OWN = { id: 'own', workspaceId: 'w1' }
const OTHER = { id: 'other', workspaceId: 'w2' }
const ORPHAN = { id: 'orphan', workspaceId: 'gone' }
const ROWS = [GLOBAL, OWN, OTHER, ORPHAN]

describe('scope filter', () => {
  it('round-trips a workspace id through the value', () => {
    expect(scopeWorkspaceId(workspaceScope('w1'))).toBe('w1')
  })

  // The `ws:` prefix is what makes this safe: without it a workspace whose id were `all` or
  // `global` would be indistinguishable from the reserved value of the same name.
  it('reads no workspace id out of the three reserved values', () => {
    expect(scopeWorkspaceId(ALL_SCOPE)).toBeNull()
    expect(scopeWorkspaceId('global')).toBeNull()
    expect(scopeWorkspaceId('orphans')).toBeNull()
    expect(scopeWorkspaceId(workspaceScope('all'))).toBe('all')
  })

  it('places a row in its own scope', () => {
    expect(scopeOf(null, KNOWN)).toBe('global')
    expect(scopeOf('w1', KNOWN)).toBe('ws:w1')
    expect(scopeOf('gone', KNOWN)).toBe('orphans')
  })

  it('shows every row under All', () => {
    expect(filterByScope(ROWS, ALL_SCOPE, KNOWN)).toEqual(ROWS)
  })

  // STRICT, both ways: Global shows global rows ONLY (never "everything usable in a workspace"),
  // and a workspace shows its own rows ONLY (never the global ones it can also run).
  it('narrows to exactly one scope', () => {
    expect(filterByScope(ROWS, 'global', KNOWN)).toEqual([GLOBAL])
    expect(filterByScope(ROWS, workspaceScope('w1'), KNOWN)).toEqual([OWN])
    expect(filterByScope(ROWS, workspaceScope('w2'), KNOWN)).toEqual([OTHER])
    expect(filterByScope(ROWS, 'orphans', KNOWN)).toEqual([ORPHAN])
  })

  // A row whose workspace is gone belongs to orphans and NOWHERE else — asking for that gone id
  // must not surface it, or a deleted workspace would still have a working view.
  it('never surfaces an orphan under the id it names', () => {
    expect(filterByScope(ROWS, workspaceScope('gone'), KNOWN)).toEqual([])
  })

  it('reports orphans only when a row has one', () => {
    expect(hasOrphans([GLOBAL, OWN], KNOWN)).toBe(false)
    expect(hasOrphans(ROWS, KNOWN)).toBe(true)
    // A global row is not an orphan — its scope is Global, on purpose.
    expect(hasOrphans([GLOBAL], KNOWN)).toBe(false)
  })
})

describe('openingScope', () => {
  const WS = [{ id: 'w1', name: 'Ops', color: 'blue' as const, defaultCwd: null }]
  it('opens on the active workspace when the dropdown offers it, else on the unfiltered entry', () => {
    expect(openingScope(WS, 'w1')).toBe('ws:w1')
    expect(openingScope(WS, 'gone')).toBe('all')
  })
})
