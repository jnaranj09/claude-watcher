// Past sessions (D-3/D-5) + action feedback (spec 2026-09-29 §2.3) — the renderer-side exits, in
// ONE place for the card, the focused bar and the Delete confirm. The invoke is SENT first (F1),
// the view goes to the board at once, and the terminal registry waits for main's answer: a refused
// archive/delete keeps the terminal and says so. A kept archive toasts `Archived "<name>"` with
// [Resume] — only once the record exists (after archive resolved), and only with a session id.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  archiveTerminal,
  archiveTerminalCore,
  deleteTerminal,
  deleteTerminalCore,
  exitSessions,
  resumeFromToastCopy,
  sessionIdForTerminal,
  STILL_CLOSING_COPY
} from './sessionExit'
import { boardStore, type BoardSession } from '../stores/boardStore'
import { toastStore } from '../stores/toastStore'
import { workspacesStore } from '../stores/workspacesStore'
import { deferred } from '../test/deferred'

const CARD: BoardSession = {
  id: 'sess-1',
  sessionName: 'api',
  projectPath: '/p',
  status: 'Idle',
  pid: 1,
  column: 'idle',
  enteredColumnAt: 1,
  workspaceId: 'default',
  tagIds: []
}

let archive: ReturnType<typeof vi.fn>
let del: ReturnType<typeof vi.fn>
let open: ReturnType<typeof vi.fn>

beforeEach(() => {
  archive = vi.fn(() => Promise.resolve())
  del = vi.fn(() => Promise.resolve())
  open = vi.fn(() => Promise.resolve({ terminalId: 'term-2', workspaceId: 'default', name: 'api' }))
  ;(window as unknown as { launch: unknown }).launch = {
    archiveSession: archive,
    deleteSession: del
  }
  ;(window as unknown as { pastSessions: unknown }).pastSessions = { open }
  boardStore.setState({
    viewMode: 'focused',
    focusedTerminalId: 'term-1',
    selectedId: null,
    sessionsById: {},
    terminalIdBySessionId: { 'sess-1': 'term-1' },
    launchedTerminals: {
      'term-1': { terminalId: 'term-1', launchedAt: 1, label: 'api', workspaceId: 'default' }
    },
    stopConfirm: { terminalId: 'term-1', sessionId: 'sess-1', sessionName: 'api' }
  })
  workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: true })
  toastStore.setState({ toasts: [] })
})
afterEach(() => {
  vi.restoreAllMocks()
})

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

const toasts = (): (string | undefined)[][] =>
  toastStore.getState().toasts.map((t) => [t.kind, t.title, t.action?.label])

describe('sessionExit', () => {
  it('sessionIdForTerminal reverse-looks-up the binding (null before correlation)', () => {
    expect(sessionIdForTerminal('term-1')).toBe('sess-1')
    expect(sessionIdForTerminal('term-x')).toBeNull()
  })

  it('archive: invoke FIRST, board at once, the registry waits for main', async () => {
    const d = deferred<void>()
    let viewAtSend: string | null = null
    archive.mockImplementation(() => {
      viewAtSend = boardStore.getState().viewMode
      return d.promise
    })
    const run = archiveTerminal('term-1')
    expect(archive).toHaveBeenCalledWith('term-1')
    expect(viewAtSend).toBe('focused') // F1: SENT before the view changes
    expect(boardStore.getState().viewMode).toBe('board')
    expect(boardStore.getState().launchedTerminals['term-1']).toBeDefined()
    expect(toasts()).toEqual([]) // no [Resume] before the record exists
    d.resolve(undefined)
    await run
    expect(boardStore.getState().launchedTerminals['term-1']).toBeUndefined()
    expect(toasts()).toEqual([['success', 'Archived "api"', 'Resume']])
    expect(toastStore.getState().toasts[0]?.action?.icon).toBe('resume')
  })

  it('a refused archive keeps the terminal and says so; the log carries a code only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    archive.mockImplementation(() => Promise.reject(new Error('/home/op/secret')))
    await archiveTerminal('term-1')
    expect(boardStore.getState().launchedTerminals['term-1']).toBeDefined()
    expect(toasts()).toEqual([['error', 'Could not archive "api".', undefined]])
    expect(warn).toHaveBeenCalledWith('[claude-watcher][exit] code=archive_failed')
    expect(warn.mock.calls.flat().join(' ')).not.toContain('/home/op')
  })

  it('with no bound session id, the archive toast has no [Resume]', async () => {
    boardStore.setState({ terminalIdBySessionId: {} })
    await archiveTerminal('term-1')
    expect(toasts()).toEqual([['success', 'Archived "api"', undefined]])
  })

  it('a second archive of the same terminal while one is in flight sends nothing', async () => {
    const d = deferred<void>()
    archive.mockImplementation(() => d.promise)
    const first = archiveTerminal('term-1')
    await archiveTerminal('term-1')
    expect(archive).toHaveBeenCalledTimes(1)
    d.resolve(undefined)
    await first
  })

  it('[Resume] opens the record through the Past sessions Open path', async () => {
    await archiveTerminal('term-1')
    const t = toastStore.getState().toasts[0]
    if (t === undefined) throw new Error('no toast')
    toastStore.getState().runAction(t.id)
    await settle()
    expect(open).toHaveBeenCalledWith('sess-1')
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(boardStore.getState().focusedTerminalId).toBe('term-2')
  })

  it('[Resume] refused while the stopped claude is still exiting says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    open.mockImplementation(() =>
      Promise.reject(
        new Error(
          "Error invoking remote method 'past-sessions:open': Error: session_running_elsewhere"
        )
      )
    )
    await archiveTerminal('term-1')
    const t = toastStore.getState().toasts[0]
    if (t === undefined) throw new Error('no toast')
    toastStore.getState().runAction(t.id)
    await settle()
    expect(toasts().at(-1)).toEqual(['error', STILL_CLOSING_COPY, undefined])
    expect(STILL_CLOSING_COPY).toBe(
      'Claude is still closing. Open it from Past sessions in a moment.'
    )
  })

  it('[Resume] on a session that is live already takes the view to its card', async () => {
    open.mockImplementation(() => Promise.reject(new Error('already_open')))
    await archiveTerminal('term-1')
    // The card is back (e.g. resumed elsewhere) and bound to a terminal.
    boardStore.setState({
      sessionsById: { 'sess-1': CARD },
      terminalIdBySessionId: { 'sess-1': 'term-7' },
      viewMode: 'board'
    })
    const t = toastStore.getState().toasts[0]
    if (t === undefined) throw new Error('no toast')
    toastStore.getState().runAction(t.id)
    await settle()
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(boardStore.getState().focusedTerminalId).toBe('term-7')
  })

  it('resumeFromToastCopy maps the other refusals like the Past sessions dialog', () => {
    expect(resumeFromToastCopy(new Error('folder_missing'))).toBe('That folder no longer exists')
    expect(resumeFromToastCopy(new Error('/home/op boom'))).toBe('Could not open the session')
  })

  it('delete: invoke FIRST with the known id; success forgets and clears the confirm', async () => {
    const run = deleteTerminal('term-1', 'sess-1', 'api')
    expect(del).toHaveBeenCalledWith('term-1', 'sess-1')
    expect(boardStore.getState().viewMode).toBe('board')
    await run
    expect(boardStore.getState().stopConfirm).toBeNull()
    expect(boardStore.getState().launchedTerminals['term-1']).toBeUndefined()
  })

  it('a refused delete keeps the terminal, closes the confirm and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    del.mockImplementation(() => Promise.reject(new Error('x')))
    await deleteTerminal('term-1', 'sess-1', 'api')
    expect(boardStore.getState().stopConfirm).toBeNull()
    expect(boardStore.getState().launchedTerminals['term-1']).toBeDefined()
    expect(toasts()).toEqual([['error', 'Could not delete "api".', undefined]])
  })

  it("a delete settling does not close a confirm that is now another card's", async () => {
    const d = deferred<void>()
    del.mockImplementation(() => d.promise)
    const run = deleteTerminal('term-1', 'sess-1', 'api')
    const other = { terminalId: 'term-9', sessionId: 'sess-9', sessionName: 'web' }
    boardStore.setState({ stopConfirm: other })
    d.resolve()
    await run
    expect(boardStore.getState().stopConfirm).toEqual(other)
  })

  it("a refused delete does not close another card's confirm either", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = deferred<void>()
    del.mockImplementation(() => d.promise)
    const run = deleteTerminal('term-1', 'sess-1', 'api')
    const other = { terminalId: 'term-9', sessionId: 'sess-9', sessionName: 'web' }
    boardStore.setState({ stopConfirm: other })
    d.reject(new Error('x'))
    await run
    expect(boardStore.getState().stopConfirm).toEqual(other)
  })
})

describe('sessionExit — the quiet core (spec 2026-10-03 D: no toast, no jump to the board)', () => {
  it('archive core: sends at once, keeps the view, never toasts; success forgets the terminal', async () => {
    const run = archiveTerminalCore('term-1')
    expect(archive).toHaveBeenCalledWith('term-1') // F1: sent at the call
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(await run).toBe(true)
    expect(boardStore.getState().launchedTerminals['term-1']).toBeUndefined()
    expect(toasts()).toEqual([])
  })

  it('archive core: a refusal keeps the terminal, logs a code only, resolves false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    archive.mockImplementation(() => Promise.reject(new Error('/home/op x')))
    expect(await archiveTerminalCore('term-1')).toBe(false)
    expect(boardStore.getState().launchedTerminals['term-1']).toBeDefined()
    expect(warn).toHaveBeenCalledWith('[claude-watcher][exit] code=archive_failed')
    expect(toasts()).toEqual([])
  })

  it('delete core: sends with the session id, keeps the view and the confirm, never toasts', async () => {
    expect(await deleteTerminalCore('term-1', 'sess-1')).toBe(true)
    expect(del).toHaveBeenCalledWith('term-1', 'sess-1')
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(boardStore.getState().stopConfirm).not.toBeNull() // the dialog never opened one
    expect(toasts()).toEqual([])
  })

  it('exitSessions: one call per session, in parallel; outcomes by id and name', async () => {
    boardStore.setState({
      sessionsById: { 'sess-1': CARD, 'sess-2': { ...CARD, id: 'sess-2', sessionName: 'web' } },
      terminalIdBySessionId: { 'sess-1': 'term-1', 'sess-2': 'term-2' }
    })
    archive.mockImplementation((t: string) =>
      t === 'term-2' ? Promise.reject(new Error('x')) : Promise.resolve()
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const run = exitSessions('archive', ['sess-1', 'sess-2'])
    expect(archive).toHaveBeenCalledTimes(2) // both SENT before either answered
    expect(await run).toEqual([
      { id: 'sess-1', name: 'api', ok: true },
      { id: 'sess-2', name: 'web', ok: false }
    ])
  })

  it('exitSessions: a session with no terminal binding (ending) fails without a call', async () => {
    boardStore.setState({ sessionsById: { 'sess-9': { ...CARD, id: 'sess-9' } } })
    expect(await exitSessions('delete', ['sess-9'])).toEqual([
      { id: 'sess-9', name: 'api', ok: false }
    ])
    expect(del).not.toHaveBeenCalled()
  })
})
