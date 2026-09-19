// Past sessions — the pure helpers behind PastSessionsDialog.tsx. jsdom `unit`.
import { describe, it, expect } from 'vitest'
import {
  filterPastByName,
  filterPastByScope,
  folderBasename,
  pastSessionErrorMessage,
  pastSessionsEmptyCopy,
  relativeEnded
} from './pastSessionsView'
import type { PastSession } from '../../../../shared/ipc/contract'

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
    expect(pastSessionsEmptyCopy(0, 0, '')).toBe('No past sessions yet.')
    expect(pastSessionsEmptyCopy(3, 0, '')).toBe('No past sessions in this workspace.')
    expect(pastSessionsEmptyCopy(3, 2, ' dep ')).toBe('No past sessions match “dep”.')
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

  it('folderBasename', () => {
    expect(folderBasename('/home/op/work/api')).toBe('api')
    expect(folderBasename('/home/op/work/api/')).toBe('api')
    expect(folderBasename('/')).toBe('/')
  })
})
