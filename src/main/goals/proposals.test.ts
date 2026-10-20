// The planner proposals (spec 2026-10-19 goals, Model): memory only, one per planner session.
import { describe, it, expect, vi } from 'vitest'
import type { Proposal } from '../../shared/schemas/goal'
import { createProposals } from './proposals'

const proposal = (plannerSessionId: string, taskIds: string[]): Proposal => ({
  plannerSessionId,
  goalId: 'g1',
  groups: [{ taskIds, note: 'n' }]
})

describe('planner proposals', () => {
  it('a new proposal replaces the old', () => {
    const onChange = vi.fn()
    const p = createProposals(onChange)
    p.set(proposal('p1', ['t1']))
    p.set(proposal('p2', ['t9']))
    p.set(proposal('p1', ['t2', 't3']))
    expect(p.list()).toEqual([proposal('p2', ['t9']), proposal('p1', ['t2', 't3'])])
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('rebind moves it', () => {
    const onChange = vi.fn()
    const p = createProposals(onChange)
    p.set(proposal('old', ['t1']))
    onChange.mockClear()
    p.rebind('old', 'new')
    expect(p.list()).toEqual([proposal('new', ['t1'])])
    expect(onChange).toHaveBeenCalledTimes(1)
    // Nothing under the id: nothing moves and nothing is announced.
    p.rebind('missing', 'other')
    p.rebind('new', 'new')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('clear drops only that planner, and a clear of nothing announces nothing', () => {
    const onChange = vi.fn()
    const p = createProposals(onChange)
    p.set(proposal('p1', ['t1']))
    p.set(proposal('p2', ['t2']))
    onChange.mockClear()
    p.clear('p1')
    expect(p.list()).toEqual([proposal('p2', ['t2'])])
    p.clear('p1')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(p.get('p2')).toEqual(proposal('p2', ['t2']))
    expect(p.get('p1')).toBeNull()
  })

  it('a listener that throws never undoes the change', () => {
    const lines: string[] = []
    const p = createProposals(
      () => {
        throw new Error('boom')
      },
      (l) => lines.push(l)
    )
    p.set(proposal('p1', ['t1']))
    expect(p.list()).toHaveLength(1)
    expect(lines).toEqual(['[claude-watcher][goals] code=proposals_listener_failed'])
  })
})
