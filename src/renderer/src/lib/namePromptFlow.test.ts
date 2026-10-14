// Action feedback (spec 2026-09-29 §2.2) — the name prompt stays open while main answers; a refusal
// keeps the typed name and shows mapped copy; the 15 s guard closes it and says so; a result that
// lands after the prompt closed never takes the view.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  LAUNCH_GUARD_MS,
  launchErrorCopy,
  RENAME_ERROR_COPY,
  submitLaunch,
  submitRename
} from './namePromptFlow'
import { boardStore, type SessionNamePromptPayload } from '../stores/boardStore'
import { toastStore } from '../stores/toastStore'
import { workspacesStore } from '../stores/workspacesStore'
import { deferred, type Deferred } from '../test/deferred'
import { manualClock } from '../test/manualClock'

type CreatePrompt = Extract<SessionNamePromptPayload, { mode: 'create' }>
type RenamePrompt = Extract<SessionNamePromptPayload, { mode: 'rename' }>
interface LaunchResult {
  terminalId: string
  workspaceId: string
}

let pending: Deferred<LaunchResult>
let launch: ReturnType<typeof vi.fn>
let fromTemplate: ReturnType<typeof vi.fn>
let rename: ReturnType<typeof vi.fn>

beforeEach(() => {
  pending = deferred<LaunchResult>()
  launch = vi.fn(() => pending.promise)
  fromTemplate = vi.fn(() => pending.promise)
  rename = vi.fn(() => Promise.resolve())
  ;(window as unknown as { launch: unknown }).launch = {
    launch,
    launchFromTemplate: fromTemplate,
    rename
  }
  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    launchedTerminals: {},
    sessionNamePrompt: null,
    sessionNamePromptBusy: false,
    sessionNamePromptError: null
  })
  workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: true })
  toastStore.setState({ toasts: [] })
})
afterEach(() => {
  vi.restoreAllMocks()
})

function openCreate(extra: Partial<CreatePrompt> = {}): CreatePrompt {
  const prompt: CreatePrompt = { mode: 'create', cwd: '/home/op/api', initialName: 'api', ...extra }
  boardStore.getState().showSessionNamePrompt(prompt)
  return prompt
}

function openRename(): RenamePrompt {
  const prompt: RenamePrompt = { mode: 'rename', sessionId: 'sess-1', initialName: 'api' }
  boardStore.getState().showSessionNamePrompt(prompt)
  return prompt
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

const toasts = (): (string | undefined)[][] =>
  toastStore.getState().toasts.map((t) => [t.kind, t.title, t.action?.label])

describe('submitLaunch', () => {
  it('stays open and busy while main answers; success closes it and opens the terminal', async () => {
    const clock = manualClock()
    const prompt = openCreate()
    const run = submitLaunch(prompt, 'api', clock)
    expect(boardStore.getState().sessionNamePrompt).toBe(prompt)
    expect(boardStore.getState().sessionNamePromptBusy).toBe(true)
    expect(launch).toHaveBeenCalledWith('/home/op/api', 'api')
    clock.advance(LAUNCH_GUARD_MS - 1) // just under the guard: still open, still quiet
    expect(boardStore.getState().sessionNamePrompt).toBe(prompt)
    pending.resolve({ terminalId: 'term-1', workspaceId: 'default' })
    await run
    expect(boardStore.getState().sessionNamePrompt).toBeNull()
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(boardStore.getState().focusedTerminalId).toBe('term-1')
    clock.advance(LAUNCH_GUARD_MS) // the guard was cleared: nothing fires
    expect(toasts()).toEqual([])
  })

  it('a template prompt launches from the template', async () => {
    const prompt = openCreate({ templateId: 'tpl-1' })
    const run = submitLaunch(prompt, 'api', manualClock())
    expect(fromTemplate).toHaveBeenCalledWith('tpl-1', 'api')
    expect(launch).not.toHaveBeenCalled()
    pending.resolve({ terminalId: 'term-2', workspaceId: 'default' })
    await run
  })

  it('a refusal keeps the prompt open with the typed name and shows mapped copy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const prompt = openCreate()
    const run = submitLaunch(prompt, 'billing api', manualClock())
    pending.reject(
      new Error("Error invoking remote method 'session:launch': Error: folder_missing")
    )
    await run
    const s = boardStore.getState()
    expect(s.sessionNamePrompt).toBe(prompt)
    expect(s.sessionNamePromptBusy).toBe(false)
    expect(s.sessionNamePromptError).toBe('That folder no longer exists.')
    expect(toasts()).toEqual([])
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).toContain('code=launch_failed')
    expect(logged).not.toContain('billing api')
    expect(logged).not.toContain('/home/op')
  })

  it('maps every launch code, and anything else to the generic line', () => {
    const wrap = (code: string): Error =>
      new Error(`Error invoking remote method 'session:launch': Error: ${code}`)
    expect(launchErrorCopy(wrap('claude_version'))).toBe(
      'Update claude to 2.1.245 or newer to launch from the app.'
    )
    expect(launchErrorCopy(wrap('template_not_found'))).toBe('That template no longer exists.')
    expect(launchErrorCopy(new Error('spawn EACCES /home/op'))).toBe('Could not start the session.')
    expect(launchErrorCopy('not an error')).toBe('Could not start the session.')
  })

  it('a second submit while one is in flight launches nothing', async () => {
    const prompt = openCreate()
    const first = submitLaunch(prompt, 'api', manualClock())
    await submitLaunch(prompt, 'api', manualClock())
    expect(launch).toHaveBeenCalledTimes(1)
    pending.resolve({ terminalId: 'term-1', workspaceId: 'default' })
    await first
  })

  it('the 15 s guard closes the prompt and says so; the late success registers without taking the view', async () => {
    const clock = manualClock()
    const prompt = openCreate()
    const run = submitLaunch(prompt, 'api', clock)
    clock.advance(LAUNCH_GUARD_MS)
    expect(boardStore.getState().sessionNamePrompt).toBeNull()
    expect(toasts()).toEqual([['info', 'Still starting "api"…', undefined]])
    pending.resolve({ terminalId: 'term-9', workspaceId: 'default' })
    await run
    expect(boardStore.getState().launchedTerminals['term-9']).toBeDefined()
    expect(boardStore.getState().viewMode).toBe('board')
    expect(boardStore.getState().focusedTerminalId).toBeNull()
    const started = toastStore.getState().toasts.find((t) => t.title === 'Started "api"')
    expect(started?.action?.label).toBe('Open')
    expect(started?.action?.icon).toBe('open')
    if (started === undefined) throw new Error('no Started toast')
    toastStore.getState().runAction(started.id)
    await settle()
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(boardStore.getState().focusedTerminalId).toBe('term-9')
  })

  it('late success after Cancel registers without taking the view', async () => {
    const prompt = openCreate()
    const run = submitLaunch(prompt, 'api', manualClock())
    boardStore.getState().clearSessionNamePrompt() // Escape / Cancel while busy
    pending.resolve({ terminalId: 'term-3', workspaceId: 'default' })
    await run
    expect(boardStore.getState().launchedTerminals['term-3']?.label).toBe('api')
    expect(boardStore.getState().viewMode).toBe('board')
    expect(toasts()).toEqual([['success', 'Started "api"', 'Open']])
  })

  it('an Open whose workspace switch outlives a newly opened modal does not take the view', async () => {
    const ws = deferred<{ activeId: string; workspaces: [] }>()
    ;(window as unknown as { workspaces: unknown }).workspaces = { setActive: () => ws.promise }
    const prompt = openCreate()
    const run = submitLaunch(prompt, 'api', manualClock())
    boardStore.getState().clearSessionNamePrompt()
    pending.resolve({ terminalId: 'term-5', workspaceId: 'other' })
    await run
    const started = toastStore.getState().toasts.find((t) => t.title === 'Started "api"')
    if (started === undefined) throw new Error('no Started toast')
    toastStore.getState().runAction(started.id)
    boardStore.getState().openSessionsDialog('templates') // a modal opens during the switch's round trip
    ws.resolve({ activeId: 'other', workspaces: [] })
    await settle()
    expect(workspacesStore.getState().activeId).toBe('other')
    expect(boardStore.getState().viewMode).toBe('board')
    expect(boardStore.getState().focusedTerminalId).toBeNull()
    boardStore.getState().closeSessionsDialog()
  })

  it('the guard says nothing once the operator has already closed the prompt', async () => {
    const clock = manualClock()
    const prompt = openCreate()
    const run = submitLaunch(prompt, 'api', clock)
    boardStore.getState().clearSessionNamePrompt()
    const second = openCreate({ cwd: '/home/op/web', initialName: 'web' })
    clock.advance(LAUNCH_GUARD_MS)
    expect(boardStore.getState().sessionNamePrompt).toBe(second)
    expect(toasts()).toEqual([])
    pending.resolve({ terminalId: 'term-6', workspaceId: 'default' })
    await run
  })

  it('late failure after Escape is an error toast with the same copy', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const prompt = openCreate()
    const run = submitLaunch(prompt, 'api', manualClock())
    boardStore.getState().clearSessionNamePrompt()
    pending.reject(new Error('claude_version'))
    await run
    expect(toasts()).toEqual([
      ['error', 'Update claude to 2.1.245 or newer to launch from the app.', undefined]
    ])
  })

  it('a NEWER prompt is never touched by an older launch result', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = openCreate()
    const run = submitLaunch(first, 'api', manualClock())
    boardStore.getState().clearSessionNamePrompt()
    const second = openCreate({ cwd: '/home/op/web', initialName: 'web' })
    pending.reject(new Error('folder_missing'))
    await run
    expect(boardStore.getState().sessionNamePrompt).toBe(second)
    expect(boardStore.getState().sessionNamePromptError).toBeNull()
    expect(boardStore.getState().sessionNamePromptBusy).toBe(false)
  })

  it('Open on a session that already ended says so and changes nothing', async () => {
    const prompt = openCreate()
    const run = submitLaunch(prompt, 'api', manualClock())
    boardStore.getState().clearSessionNamePrompt()
    pending.resolve({ terminalId: 'term-5', workspaceId: 'default' })
    await run
    boardStore.getState().forgetLaunchedTerminal('term-5') // its pty exited meanwhile
    const started = toastStore.getState().toasts.find((t) => t.title === 'Started "api"')
    if (started === undefined) throw new Error('no Started toast')
    toastStore.getState().runAction(started.id)
    await settle()
    expect(boardStore.getState().viewMode).toBe('board')
    expect(boardStore.getState().launchedTerminals['term-5']).toBeUndefined()
    expect(toasts().at(-1)).toEqual(['info', 'That session has ended.', undefined])
  })

  it('Open switches to the launch workspace first when it is not the active one', async () => {
    const setActive = vi.fn(() => Promise.resolve({ activeId: 'w2', workspaces: [] }))
    ;(window as unknown as { workspaces: unknown }).workspaces = { setActive }
    const prompt = openCreate()
    const run = submitLaunch(prompt, 'api', manualClock())
    boardStore.getState().clearSessionNamePrompt()
    pending.resolve({ terminalId: 'term-4', workspaceId: 'w2' })
    await run
    const started = toastStore.getState().toasts[0]
    if (started === undefined) throw new Error('no toast')
    toastStore.getState().runAction(started.id)
    await settle()
    expect(setActive).toHaveBeenCalledWith('w2')
    expect(boardStore.getState().focusedTerminalId).toBe('term-4')
  })
})

describe('submitRename', () => {
  it('success closes the prompt', async () => {
    const prompt = openRename()
    await submitRename(prompt, 'billing')
    expect(rename).toHaveBeenCalledWith('sess-1', 'billing')
    expect(boardStore.getState().sessionNamePrompt).toBeNull()
  })

  it('a refusal keeps it open with the rename copy', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    rename.mockImplementation(() => Promise.reject(new Error('ZodError name')))
    const prompt = openRename()
    await submitRename(prompt, 'billing')
    expect(boardStore.getState().sessionNamePrompt).toBe(prompt)
    expect(boardStore.getState().sessionNamePromptError).toBe(RENAME_ERROR_COPY)
    expect(RENAME_ERROR_COPY).toBe('Could not rename the session.')
  })

  it('a refusal after Cancel is an error toast', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const late = deferred<void>()
    rename.mockImplementation(() => late.promise)
    const prompt = openRename()
    const run = submitRename(prompt, 'billing')
    boardStore.getState().clearSessionNamePrompt()
    late.reject(new Error('x'))
    await run
    expect(toasts()).toEqual([['error', 'Could not rename the session.', undefined]])
  })
})
