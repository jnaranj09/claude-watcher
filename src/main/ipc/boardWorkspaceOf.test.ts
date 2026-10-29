import { describe, it, expect } from 'vitest'
import { boardWorkspaceOf } from './boardWorkspaceOf'

const seams = new Map([
  ['win-a', { workspaceOf: (id: string) => (id === 's1' ? 'w1' : undefined) }],
  ['win-b', { workspaceOf: () => 'w9' }]
])

describe('boardWorkspaceOf', () => {
  it("answers from the calling window's board", () => {
    expect(boardWorkspaceOf(seams, 'win-a')('s1')).toBe('w1')
  })

  it('a session not live on that board has no workspace', () => {
    expect(boardWorkspaceOf(seams, 'win-a')('gone')).toBeUndefined()
  })

  it('a window with no board has no workspace for any session', () => {
    expect(boardWorkspaceOf(seams, 'win-c')('s1')).toBeUndefined()
  })
})
