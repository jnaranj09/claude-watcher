import { describe, it, expect } from 'vitest'
import { groupTemplates } from './groupTemplates'
import type { Template, Workspace } from '../../../../shared/ipc/contract'

const W1: Workspace = { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
const W2: Workspace = { id: 'w2', name: 'Infra', color: 'green', defaultCwd: null }
const WORKSPACES: Workspace[] = [W1, W2]

const base: Omit<Template, 'id' | 'workspaceId'> = {
  name: 't',
  cwd: '/t',
  model: null,
  permissionMode: null,
  effort: null
}
const GLOBAL: Template = { ...base, id: 'g', workspaceId: null }
const OWN: Template = { ...base, id: 'own', workspaceId: 'w1' } // active workspace
const OTHER: Template = { ...base, id: 'other', workspaceId: 'w2' } // a DIFFERENT existing workspace
const ORPHAN: Template = { ...base, id: 'orphan', workspaceId: 'gone' } // no such workspace

describe('groupTemplates', () => {
  it('orders Global → active → other existing workspaces → orphans, one row each', () => {
    const groups = groupTemplates([GLOBAL, OWN, OTHER, ORPHAN], 'w1', WORKSPACES)
    expect(groups.map((g) => g.id)).toEqual(['global', 'active', 'w2', 'orphans'])
    expect(groups[0]).toMatchObject({ label: 'Global', templates: [GLOBAL] })
    expect(groups[1]).toMatchObject({ label: 'Ops', templates: [OWN] })
    expect(groups[2]).toMatchObject({ label: 'Infra', templates: [OTHER] })
    expect(groups[3]).toMatchObject({ label: '(no workspace)', templates: [ORPHAN] })
  })

  // The property Finding 2 targets: an empty `workspaces` list cannot distinguish "scoped to an
  // EXISTING other workspace" from "scoped to a GONE workspace" — both fixtures below must be
  // exercised against a NON-empty, real workspace list for this to mean anything.
  it('a row scoped to an EXISTING non-active workspace lands under that workspace, never orphans', () => {
    const groups = groupTemplates([OTHER], 'w1', WORKSPACES)
    expect(groups).toEqual([{ id: 'w2', label: 'Infra', templates: [OTHER] }])
  })

  it('a row scoped to a workspace that no longer exists lands under orphans only', () => {
    const groups = groupTemplates([ORPHAN], 'w1', WORKSPACES)
    expect(groups).toEqual([{ id: 'orphans', label: '(no workspace)', templates: [ORPHAN] }])
  })

  // THE test that pins the `knownIds` guard: deleting `!knownIds.has(...)` from groupTemplates.ts
  // makes `OTHER` (an existing w2-scoped row) ALSO match the orphans filter (`workspaceId !==
  // null && !== activeId`), so it would render under BOTH its own `w2` group AND orphans.
  it('a row scoped to an existing workspace never ALSO appears in the orphans group', () => {
    const groups = groupTemplates([OTHER], 'w1', WORKSPACES)
    expect(groups.find((g) => g.id === 'orphans')).toBeUndefined()
  })

  it('omits every empty group — no rows, no group, in any position', () => {
    expect(groupTemplates([], 'w1', WORKSPACES)).toEqual([])
    expect(groupTemplates([GLOBAL], 'w1', WORKSPACES)).toEqual([
      { id: 'global', label: 'Global', templates: [GLOBAL] }
    ])
    // w2 has no rows here — it must not appear as an empty group.
    expect(groupTemplates([GLOBAL, OWN], 'w1', WORKSPACES).map((g) => g.id)).toEqual([
      'global',
      'active'
    ])
  })
})
