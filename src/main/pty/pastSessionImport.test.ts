import { describe, it, expect, vi, type Mock } from 'vitest'
import {
  importPastSession,
  importedSessionName,
  IMPORTED_SESSION_FALLBACK_NAME,
  type PastSessionImportDeps
} from './pastSessionImport'
import type { PastSession } from '../../shared/schemas/pastSession'
import type { LaunchRequest } from './launchSession'

const ID = '93b82f21-709b-41a5-8d8a-8b1a4af499bf'
const KNOWN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const RECORD: PastSession = {
  id: KNOWN,
  name: 'billing api',
  cwd: '/home/op/api',
  workspaceId: 'w2',
  tagIds: ['t1'],
  launchedAt: 1,
  endedAt: 2
}

function deps(over: Partial<Omit<PastSessionImportDeps, 'launch'>> = {}): PastSessionImportDeps & {
  launch: Mock<(req: LaunchRequest) => { terminalId: string }>
} {
  const launch = vi.fn<(req: LaunchRequest) => { terminalId: string }>(() => ({
    terminalId: 'term-1'
  }))
  return {
    get: (id) => (id === KNOWN ? RECORD : null),
    isDirectory: () => true,
    isLive: () => false,
    hasTranscript: () => true,
    runningElsewhere: () => false,
    tagExists: () => true,
    workspaceExists: (id) => id === 'w1' || id === 'w2',
    readTranscriptInfo: () => ({ cwd: '/home/op/web', title: 'Fix login' }),
    ...over,
    launch
  }
}

describe('importPastSession', () => {
  it('launches a resume in the given workspace, folder + name from the transcript, no tags', () => {
    const d = deps()
    expect(importPastSession({ id: ID, workspaceId: 'w1' }, d)).toEqual({
      ok: true,
      terminalId: 'term-1',
      workspaceId: 'w1',
      name: 'Fix login'
    })
    expect(d.launch).toHaveBeenCalledWith({
      cwd: '/home/op/web',
      name: 'Fix login',
      workspaceId: 'w1',
      resumeSessionId: ID,
      tagIds: [],
      flags: { model: null, permissionMode: null, effort: null }
    })
  })

  it('an id with a record goes through Open (its workspace, name, tags), not a second path', () => {
    const d = deps({ readTranscriptInfo: vi.fn(() => null) })
    expect(importPastSession({ id: KNOWN, workspaceId: 'w1' }, d)).toEqual({
      ok: true,
      terminalId: 'term-1',
      workspaceId: 'w2',
      name: 'billing api'
    })
    expect(d.launch.mock.calls[0]?.[0]).toMatchObject({ workspaceId: 'w2', tagIds: ['t1'] })
    expect(d.readTranscriptInfo).not.toHaveBeenCalled()
  })

  it('a non-uuid id → invalid_id, nothing launched', () => {
    const d = deps()
    expect(importPastSession({ id: 'nope', workspaceId: 'w1' }, d)).toEqual({
      ok: false,
      code: 'invalid_id'
    })
    expect(d.launch).not.toHaveBeenCalled()
  })

  it('a malformed request that is not about the id still throws (a renderer bug, not copy)', () => {
    expect(() => importPastSession({ id: ID, workspaceId: 'w1', extra: 1 }, deps())).toThrow()
  })

  it.each([
    ['workspace_not_found', { workspaceExists: () => false }],
    ['already_open', { isLive: () => true }],
    ['session_running_elsewhere', { runningElsewhere: () => true }],
    ['transcript_missing', { readTranscriptInfo: () => null }],
    ['folder_missing', { isDirectory: () => false }]
  ] as const)('refuses %s and launches nothing', (code, over) => {
    const d = deps(over)
    expect(importPastSession({ id: ID, workspaceId: 'w1' }, d)).toEqual({ ok: false, code })
    expect(d.launch).not.toHaveBeenCalled()
  })

  it('checks in spec order: running elsewhere wins over a missing transcript', () => {
    const d = deps({ runningElsewhere: () => true, readTranscriptInfo: () => null })
    expect(importPastSession({ id: ID, workspaceId: 'w1' }, d)).toEqual({
      ok: false,
      code: 'session_running_elsewhere'
    })
  })

  it('no title → the folder name', () => {
    const d = deps({ readTranscriptInfo: () => ({ cwd: '/home/op/web', title: null }) })
    expect(importPastSession({ id: ID, workspaceId: 'w1' }, d)).toMatchObject({ name: 'web' })
  })
})

describe('importedSessionName', () => {
  it('a title over 60 is cut to 60', () => {
    expect(importedSessionName('x'.repeat(80), '/a')).toBe('x'.repeat(60))
  })
  it('a title with a newline falls back to the folder', () => {
    expect(importedSessionName('line one\nline two', '/home/op/api')).toBe('api')
  })
  it('a blank title falls back to the folder', () => {
    expect(importedSessionName('   ', '/home/op/api')).toBe('api')
  })
  it('the root folder and no title → the fixed fallback', () => {
    expect(importedSessionName(null, '/')).toBe(IMPORTED_SESSION_FALLBACK_NAME)
  })
})
