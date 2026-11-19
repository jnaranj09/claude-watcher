// Past sessions — the pure helpers behind PastSessionsPage.tsx. jsdom `unit`.
import { describe, it, expect } from 'vitest'
import {
  filterPastByFilters,
  filterPastByName,
  filterPastByScope,
  openOrFocusPast,
  pastMemoryLine,
  pastSessionErrorMessage,
  pastSessionsEmptyCopy,
  relativeEnded,
  resumeByIdErrorMessage
} from './pastSessionsView'
import { folderName } from '../../lib/filterCopy'
import { NO_FILTERS } from '../../lib/sessionFilters'
import type { PastSession } from '../../../../shared/ipc/contract'
import type { PastSessionMemory } from '../../../../shared/schemas/pastSession'

const row = (id: string, name: string, workspaceId = 'w1'): PastSession => ({
  id,
  name,
  cwd: `/home/op/${id}`,
  workspaceId,
  tagIds: [],
  launchedAt: 1,
  endedAt: 2
})

describe('pastSessionsView', () => {
  it('scope: all keeps everything; ws:<id> keeps that workspace only', () => {
    const rows = [row('a', 'A', 'w1'), row('b', 'B', 'w2')]
    expect(filterPastByScope(rows, 'all')).toEqual(rows)
    expect(filterPastByScope(rows, 'ws:w2').map((r) => r.id)).toEqual(['b'])
  })

  it('name search: trimmed, case-insensitive, anywhere; blank hides nothing', () => {
    const rows = [row('a', 'Billing API'), row('b', 'deploy')]
    expect(filterPastByName(rows, '  api ').map((r) => r.id)).toEqual(['a'])
    expect(filterPastByName(rows, '')).toEqual(rows)
    expect(filterPastByName(rows, '   ')).toEqual(rows)
  })

  it('three empty states, three sentences', () => {
    expect(pastSessionsEmptyCopy(0, 0)).toBe('No past sessions yet.')
    expect(pastSessionsEmptyCopy(3, 0)).toBe('No past sessions in this workspace.')
    expect(pastSessionsEmptyCopy(3, 2)).toBe('No past sessions match your search or filters.')
  })

  it('filterPastByFilters reads cwd, tags, launchedAt and endedAt', () => {
    const rows = [
      { ...row('a', 'A'), cwd: '/p/a', endedAt: new Date(2026, 9, 15, 12).getTime() },
      { ...row('b', 'B'), cwd: '/p/b', endedAt: new Date(2026, 9, 1, 12).getTime() }
    ]
    const now = new Date(2026, 9, 16, 15).getTime()
    const ended = { kind: 'since', day: '2026-10-12' } as const
    expect(filterPastByFilters(rows, { ...NO_FILTERS, ended }, now).map((r) => r.id)).toEqual(['a'])
    expect(
      filterPastByFilters(rows, { ...NO_FILTERS, folders: ['/p/b'] }, now).map((r) => r.id)
    ).toEqual(['b'])
  })

  it('relative ended time', () => {
    const now = 1_000_000_000_000
    expect(relativeEnded(now - 20_000, now)).toBe('just now')
    expect(relativeEnded(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(relativeEnded(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(relativeEnded(now - 2 * 86_400_000, now)).toBe('2 d ago')
    expect(relativeEnded(now - 40 * 86_400_000, now)).toBe(
      new Date(now - 40 * 86_400_000).toLocaleDateString()
    )
  })

  it('maps every code to copy and everything else to the generic line', () => {
    expect(pastSessionErrorMessage(new Error('not_found'))).toBe(
      'That session is no longer in the history'
    )
    expect(pastSessionErrorMessage(new Error('folder_missing'))).toBe(
      'That folder no longer exists'
    )
    expect(pastSessionErrorMessage(new Error('already_open'))).toBe('That session is already open')
    expect(pastSessionErrorMessage(new Error('transcript_missing'))).toBe(
      'Claude no longer has this conversation. Forget it to remove it from the list'
    )
    expect(pastSessionErrorMessage(new Error('session_running_elsewhere'))).toBe(
      'This session is running in another terminal. Close it there first'
    )
    expect(pastSessionErrorMessage(new Error('/home/op leaked'))).toBe('Could not open the session')
    expect(pastSessionErrorMessage('x')).toBe('Could not open the session')
  })

  // Electron wraps an invoke rejection, so the code never arrives as the whole message in the real
  // app (the copyFor / templateErrorMessage precedent). An exact match would show the generic line
  // for every refusal.
  it('finds the code inside the Electron-wrapped invoke rejection', () => {
    expect(
      pastSessionErrorMessage(
        new Error("Error invoking remote method 'past-sessions:open': Error: folder_missing")
      )
    ).toBe('That folder no longer exists')
  })

  it('folderName', () => {
    expect(folderName('/home/op/work/api')).toBe('api')
    expect(folderName('/home/op/work/api/')).toBe('api')
    expect(folderName('/')).toBe('/')
  })
})

describe('resumeByIdErrorMessage', () => {
  const wrapped = (code: string): Error =>
    new Error(`Error invoking remote method 'past-sessions:import': Error: ${code}`)
  it.each([
    ['invalid_id', 'That is not a claude session id'],
    ['transcript_missing', 'Claude has no conversation with that id'],
    ['folder_missing', 'That folder no longer exists'],
    [
      'session_running_elsewhere',
      'This session is running in another terminal. Close it there first'
    ]
  ])('%s → its copy', (code, copy) => {
    expect(resumeByIdErrorMessage(wrapped(code))).toBe(copy)
  })
  it('workspace_not_found gets its own copy (never the `not_found` line)', () => {
    expect(resumeByIdErrorMessage(wrapped('workspace_not_found'))).toBe(
      'That workspace no longer exists'
    )
  })
  it('anything else → the generic line, never the message', () => {
    expect(resumeByIdErrorMessage(new Error('/home/op/secret'))).toBe(
      'Could not resume the session'
    )
  })
  it('Open keeps its own transcript_missing copy', () => {
    expect(pastSessionErrorMessage(wrapped('transcript_missing'))).toBe(
      'Claude no longer has this conversation. Forget it to remove it from the list'
    )
  })
})

// Memory phase 2: the record's `Memory:` line. The counts are what the saves WROTE (an update
// counts too), so the words never say "new" or "different" items.
describe('pastMemoryLine', () => {
  const zero = { specifics: 0, facts: 0, tasks: 0, episodes: 0, episodeId: null }
  it.each<[PastSessionMemory, string]>([
    [
      { state: 'saved', specifics: 4, facts: 1, tasks: 2, episodes: 1, episodeId: 'e1' },
      'Memory: 4 specifics, 1 fact, 2 tasks, 1 episode'
    ],
    [
      { state: 'saved', specifics: 1, facts: 2, tasks: 1, episodes: 2, episodeId: null },
      'Memory: 1 specific, 2 facts, 1 task, 2 episodes'
    ],
    [{ ...zero, state: 'saved', facts: 3 }, 'Memory: 3 facts'],
    [{ ...zero, state: 'saved' }, 'Memory: nothing new'],
    [{ ...zero, state: 'nothing' }, 'Memory: nothing new'],
    [{ ...zero, state: 'failed' }, 'Memory: failed'],
    [{ ...zero, state: 'saving' }, 'Memory: saving…'],
    [{ ...zero, state: 'off' }, 'Memory: off']
  ])('%j reads %s', (m, text) => {
    expect(pastMemoryLine(m)).toBe(text)
  })

  it('a record from before the field shows no Memory line', () => {
    expect(pastMemoryLine(undefined)).toBeNull()
  })
})

describe('openOrFocusPast', () => {
  const opened = { terminalId: 't1', workspaceId: 'w1', name: 'Fix login' }
  const wrapped = (code: string): Error =>
    new Error(`Error invoking remote method 'past-sessions:open': Error: ${code}`)

  it("is 'opened' when open resolves, and never asks focus", async () => {
    const asked: string[] = []
    const focus = (id: string): Promise<boolean> => {
      asked.push(id)
      return Promise.resolve(true)
    }
    await expect(openOrFocusPast(() => Promise.resolve(opened), focus, 's1')).resolves.toBe(
      'opened'
    )
    expect(asked).toEqual([])
  })

  it("is 'focused' when open says already_open and focus took the view to the card", async () => {
    const asked: string[] = []
    const focus = (id: string): Promise<boolean> => {
      asked.push(id)
      return Promise.resolve(true)
    }
    await expect(
      openOrFocusPast(() => Promise.reject(wrapped('already_open')), focus, 's1')
    ).resolves.toBe('focused')
    expect(asked).toEqual(['s1'])
  })

  it('rethrows already_open when focus could not show the card, and any other refusal', async () => {
    const refused = wrapped('already_open')
    await expect(
      openOrFocusPast(
        () => Promise.reject(refused),
        () => Promise.resolve(false),
        's1'
      )
    ).rejects.toBe(refused)
    const missing = wrapped('folder_missing')
    const asked: string[] = []
    const focus = (id: string): Promise<boolean> => {
      asked.push(id)
      return Promise.resolve(true)
    }
    await expect(openOrFocusPast(() => Promise.reject(missing), focus, 's1')).rejects.toBe(missing)
    expect(asked).toEqual([])
  })
})
