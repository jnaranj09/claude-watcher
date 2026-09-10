import { describe, it, expect } from 'vitest'
import { groupShortcuts } from './groupShortcuts'
import type { Shortcut, Workspace } from '../../../../shared/ipc/contract'

const W1: Workspace = { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
const W2: Workspace = { id: 'w2', name: 'Infra', color: 'green', defaultCwd: null }
const WORKSPACES: Workspace[] = [W1, W2]

const base: Omit<Shortcut, 'id' | 'workspaceId'> = { name: 's', keys: ['Ctrl+Alt+A'], text: 't' }
const GLOBAL: Shortcut = { ...base, id: 'g', workspaceId: null }
const OWN: Shortcut = { ...base, id: 'own', workspaceId: 'w1' } // active workspace
const OTHER: Shortcut = { ...base, id: 'other', workspaceId: 'w2' } // a DIFFERENT existing workspace
const ORPHAN: Shortcut = { ...base, id: 'orphan', workspaceId: 'gone' } // no such workspace

describe('groupShortcuts', () => {
  it('orders Global → active → other existing workspaces → orphans, one row each', () => {
    const groups = groupShortcuts([GLOBAL, OWN, OTHER, ORPHAN], 'w1', WORKSPACES)
    expect(groups.map((g) => g.id)).toEqual(['global', 'active', 'w2', 'orphans'])
    expect(groups[0]).toMatchObject({ label: 'Global', shortcuts: [GLOBAL] })
    expect(groups[1]).toMatchObject({ label: 'Ops', shortcuts: [OWN] })
    expect(groups[2]).toMatchObject({ label: 'Infra', shortcuts: [OTHER] })
    expect(groups[3]).toMatchObject({ label: '(no workspace)', shortcuts: [ORPHAN] })
  })

  // The property Finding 2 targets: an empty `workspaces` list cannot distinguish "scoped to an
  // EXISTING other workspace" from "scoped to a GONE workspace" — both fixtures below must be
  // exercised against a NON-empty, real workspace list for this to mean anything.
  it('a row scoped to an EXISTING non-active workspace lands under that workspace, never orphans', () => {
    const groups = groupShortcuts([OTHER], 'w1', WORKSPACES)
    expect(groups).toEqual([{ id: 'w2', label: 'Infra', shortcuts: [OTHER] }])
  })

  it('a row scoped to a workspace that no longer exists lands under orphans only', () => {
    const groups = groupShortcuts([ORPHAN], 'w1', WORKSPACES)
    expect(groups).toEqual([{ id: 'orphans', label: '(no workspace)', shortcuts: [ORPHAN] }])
  })

  // THE test that pins the `knownIds` guard: deleting `!knownIds.has(...)` from groupShortcuts.ts
  // makes `OTHER` (an existing w2-scoped row) ALSO match the orphans filter (`workspaceId !==
  // null && !== activeId`), so it would render under BOTH its own `w2` group AND orphans.
  it('a row scoped to an existing workspace never ALSO appears in the orphans group', () => {
    const groups = groupShortcuts([OTHER], 'w1', WORKSPACES)
    expect(groups.find((g) => g.id === 'orphans')).toBeUndefined()
  })

  it('omits every empty group — no rows, no group, in any position', () => {
    expect(groupShortcuts([], 'w1', WORKSPACES)).toEqual([])
    expect(groupShortcuts([GLOBAL], 'w1', WORKSPACES)).toEqual([
      { id: 'global', label: 'Global', shortcuts: [GLOBAL] }
    ])
    // w2 has no rows here — it must not appear as an empty group.
    expect(groupShortcuts([GLOBAL, OWN], 'w1', WORKSPACES).map((g) => g.id)).toEqual([
      'global',
      'active'
    ])
  })
})
