// The workspace delete cascade: every scoped store drops the deleted workspace's rows, memory
// before past sessions (so the past-session records it drops mark only global items), then the
// rule engines hear of it.
import { describe, expect, it } from 'vitest'
import { cascadeWorkspaceDelete, type WorkspaceCascade } from './workspaceCascade'

function recorder(): { calls: string[]; cascade: WorkspaceCascade } {
  const calls: string[] = []
  const step = (name: string): WorkspaceCascade['templates'] => ({
    removeByWorkspace: (id) => {
      calls.push(`${name}:${id}`)
    }
  })
  return {
    calls,
    cascade: {
      templates: step('templates'),
      shortcuts: step('shortcuts'),
      tags: step('tags'),
      rules: step('rules'),
      goals: step('goals'),
      memory: step('memory'),
      pastSessions: step('pastSessions'),
      onRulesRemoved: () => {
        calls.push('rulesRemoved')
      }
    }
  }
}

describe('cascadeWorkspaceDelete', () => {
  it('removes the workspace from every store, memory before past sessions, then tells the rule engines', () => {
    const { calls, cascade } = recorder()
    cascadeWorkspaceDelete('w1', cascade)
    expect(calls).toEqual([
      'templates:w1',
      'shortcuts:w1',
      'tags:w1',
      'rules:w1',
      'goals:w1',
      'memory:w1',
      'pastSessions:w1',
      'rulesRemoved'
    ])
  })

  it('skips a store that does not exist (memory off, a store that failed to build)', () => {
    const { calls, cascade } = recorder()
    cascadeWorkspaceDelete('w1', { ...cascade, memory: null, goals: null })
    expect(calls).toEqual([
      'templates:w1',
      'shortcuts:w1',
      'tags:w1',
      'rules:w1',
      'pastSessions:w1',
      'rulesRemoved'
    ])
  })
})
