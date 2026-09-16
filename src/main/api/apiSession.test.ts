// Programmatic API — the state-only wire projection of a board session.
//
// What these tests protect: `Session` carries the operator's prompts, claude's prose and a tool's
// INPUT; `ApiSession` carries none of that. The projection is the ONE place that narrowing
// happens, so these tests pin (a) that the content fields do not ride out, (b) that the pending
// tool's NAME (state) does, and (c) that a session the tracker has not placed in a column yet
// projects to null rather than to a card with an invented position.
import { describe, it, expect } from 'vitest'
import { projectApiSession, projectApiSessionFromEvent } from './apiSession'
import type { Session } from '../../shared/schemas/session'

const session: Session = {
  id: 's1',
  status: 'Working',
  projectPath: '/w',
  pid: 1,
  sessionName: 'HT-1',
  workspaceId: 'default',
  tagIds: ['t1'],
  templateId: null,
  pendingToolInput: 'secret',
  latestMessage: 'secret too'
}
const source = { columnOf: () => 'working' as const, enteredColumnAt: () => 42 }

describe('projectApiSession', () => {
  it('projects state only: no pendingToolInput, no latestMessage, no pid', () => {
    expect(projectApiSession(session, source)).toEqual({
      id: 's1',
      sessionName: 'HT-1',
      status: 'Working',
      column: 'working',
      enteredColumnAt: 42,
      workspaceId: 'default',
      tagIds: ['t1'],
      projectPath: '/w'
    })
  })

  it('keeps pendingToolName when present', () => {
    expect(
      projectApiSession({ ...session, pendingToolName: 'Bash' }, source)?.pendingToolName
    ).toBe('Bash')
  })

  it('returns null when the tracker has no column yet', () => {
    expect(
      projectApiSession(session, {
        columnOf: () => undefined,
        enteredColumnAt: () => undefined
      })
    ).toBeNull()
  })
})

describe('projectApiSessionFromEvent', () => {
  it('maps an enriched session.updated event', () => {
    expect(
      projectApiSessionFromEvent({
        type: 'session.updated',
        id: 's1',
        sessionName: 'HT-1',
        projectPath: '/w',
        status: 'Working',
        column: 'working',
        enteredColumnAt: 42,
        pid: 1,
        workspaceId: 'default',
        tagIds: []
      })
    ).toEqual({
      id: 's1',
      sessionName: 'HT-1',
      status: 'Working',
      column: 'working',
      enteredColumnAt: 42,
      workspaceId: 'default',
      tagIds: [],
      projectPath: '/w'
    })
  })
})
