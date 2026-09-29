import { describe, it, expect, vi, type Mock } from 'vitest'
import { openPastSession, resumeTerminalSession, type PastSessionOpenDeps } from './pastSessionOpen'
import type { PastSession } from '../../shared/schemas/pastSession'
import type { LaunchRequest } from './launchSession'

const RECORD: PastSession = {
  id: 'sess-A',
  name: 'billing api',
  cwd: '/home/op/api',
  workspaceId: 'w1',
  tagIds: ['t-live', 't-gone'],
  launchedAt: 1,
  endedAt: 2
}

function deps(over: Partial<PastSessionOpenDeps> = {}): PastSessionOpenDeps & {
  launch: Mock<(req: LaunchRequest) => { terminalId: string }>
} {
  const launch = vi.fn<(req: LaunchRequest) => { terminalId: string }>(() => ({
    terminalId: 'term-9'
  }))
  return {
    get: (id) => (id === RECORD.id ? RECORD : null),
    isDirectory: () => true,
    isLive: () => false,
    transcriptExists: () => true,
    tagExists: (id) => id === 't-live',
    ...over,
    // Always the mock: no test in this file overrides launch, and keeping it last (rather than
    // inside the `over` spread) keeps its type the concrete `Mock<...>` instead of a union with
    // `PastSessionOpenDeps`'s plain function signature.
    launch
  }
}

describe('openPastSession', () => {
  it('registers a resume recipe (cwd, name, workspace, surviving tags) and returns the launch', () => {
    const d = deps()
    expect(openPastSession({ id: 'sess-A' }, d)).toEqual({
      ok: true,
      terminalId: 'term-9',
      workspaceId: 'w1',
      name: 'billing api'
    })
    expect(d.launch).toHaveBeenCalledWith({
      cwd: '/home/op/api',
      name: 'billing api',
      workspaceId: 'w1',
      resumeSessionId: 'sess-A',
      tagIds: ['t-live'],
      flags: { model: null, permissionMode: null, effort: null }
    })
  })
  it('UX-02: the record is NOT removed on Open — the deps offer no way to remove it', () => {
    // A crash while the resumed session runs used to lose the record for good. The resumed
    // card's live record overwrites it by id instead (livePastSessions.ts).
    expect(Object.keys(deps())).not.toContain('remove')
  })
  it('not_found: unknown id, nothing launched', () => {
    const d = deps()
    expect(openPastSession({ id: 'nope' }, d)).toEqual({ ok: false, code: 'not_found' })
    expect(d.launch).not.toHaveBeenCalled()
  })
  it('folder_missing: the cwd is gone or not a directory', () => {
    const d = deps({ isDirectory: () => false })
    expect(openPastSession({ id: 'sess-A' }, d)).toEqual({ ok: false, code: 'folder_missing' })
    expect(d.launch).not.toHaveBeenCalled()
  })
  it('UX-08 transcript_missing: claude no longer has the conversation; nothing launched', () => {
    const seen: string[] = []
    const d = deps({
      get: () => ({ ...RECORD, transcriptPath: '/home/op/.claude/projects/x/sess-A.jsonl' }),
      transcriptExists: (path) => {
        seen.push(path)
        return false
      }
    })
    expect(openPastSession({ id: 'sess-A' }, d)).toEqual({ ok: false, code: 'transcript_missing' })
    expect(seen).toEqual(['/home/op/.claude/projects/x/sess-A.jsonl'])
    expect(d.launch).not.toHaveBeenCalled()
  })
  it('UX-08: a record with no transcript path is not checked (older records)', () => {
    const transcriptExists = vi.fn(() => false)
    const d = deps({ transcriptExists })
    expect(openPastSession({ id: 'sess-A' }, d).ok).toBe(true)
    expect(transcriptExists).not.toHaveBeenCalled()
  })
  it('a live card answers already_open before the transcript is checked', () => {
    const d = deps({
      get: () => ({ ...RECORD, transcriptPath: '/t.jsonl' }),
      isLive: () => true,
      transcriptExists: () => false
    })
    expect(openPastSession({ id: 'sess-A' }, d)).toEqual({ ok: false, code: 'already_open' })
  })
  it('already_open: the id is a live card; nothing launched', () => {
    const d = deps({ isLive: (id) => id === 'sess-A' })
    expect(openPastSession({ id: 'sess-A' }, d)).toEqual({ ok: false, code: 'already_open' })
    expect(d.launch).not.toHaveBeenCalled()
  })
  it('the arg is untrusted: a blank or malformed id throws before anything runs', () => {
    const d = deps()
    expect(() => openPastSession({ id: '' }, d)).toThrow()
    expect(() => openPastSession('sess-A', d)).toThrow()
    expect(d.launch).not.toHaveBeenCalled()
  })
})

// UX-10 — the dead pane's Resume. The renderer sends only the terminal id; main resolves the id
// the terminal LAST ran (the launch override's lastSessionId, moved by /clear) and runs Open.
describe('resumeTerminalSession', () => {
  function resumeDeps(
    over: Partial<PastSessionOpenDeps> & {
      lastSessionIdFor?: (terminalId: string) => string | null
      isTerminalLive?: (terminalId: string) => boolean
    } = {}
  ): ReturnType<typeof deps> & {
    lastSessionIdFor: (terminalId: string) => string | null
    isTerminalLive: (terminalId: string) => boolean
  } {
    const { lastSessionIdFor, isTerminalLive, ...rest } = over
    return {
      ...deps(rest),
      lastSessionIdFor: lastSessionIdFor ?? ((t) => (t === 'term-dead' ? 'sess-A' : null)),
      isTerminalLive: isTerminalLive ?? (() => false)
    }
  }

  it('resumes the id the terminal last ran, through the Open checks', () => {
    const d = resumeDeps()
    expect(resumeTerminalSession({ terminalId: 'term-dead' }, d)).toEqual({
      ok: true,
      terminalId: 'term-9',
      workspaceId: 'w1',
      name: 'billing api'
    })
    expect(d.launch).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: 'sess-A' }))
  })

  it('not_found: a terminal with no launch record (a plain shell), nothing launched', () => {
    const d = resumeDeps()
    expect(resumeTerminalSession({ terminalId: 'term-shell' }, d)).toEqual({
      ok: false,
      code: 'not_found'
    })
    expect(d.launch).not.toHaveBeenCalled()
  })

  it('already_open: the terminal is still alive, nothing launched', () => {
    const d = resumeDeps({ isTerminalLive: () => true })
    expect(resumeTerminalSession({ terminalId: 'term-dead' }, d)).toEqual({
      ok: false,
      code: 'already_open'
    })
    expect(d.launch).not.toHaveBeenCalled()
  })

  it('carries the Open refusals (transcript_missing)', () => {
    const d = resumeDeps({
      get: (id) => (id === 'sess-A' ? { ...RECORD, transcriptPath: '/gone.jsonl' } : null),
      transcriptExists: () => false
    })
    expect(resumeTerminalSession({ terminalId: 'term-dead' }, d)).toEqual({
      ok: false,
      code: 'transcript_missing'
    })
  })

  it('parse-and-throws a malformed arg', () => {
    const d = resumeDeps()
    expect(() => resumeTerminalSession({ terminalId: '' }, d)).toThrow()
    expect(() => resumeTerminalSession({ terminalId: 't', id: 'sess-A' }, d)).toThrow()
    expect(d.launch).not.toHaveBeenCalled()
  })
})
