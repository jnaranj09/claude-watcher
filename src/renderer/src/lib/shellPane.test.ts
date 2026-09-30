// Card shell pane — the renderer side of `>_ Shell`: one invoke on the first open, a pure
// show/hide after that, and mapped copy for a refusal (never the thrown message).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shellOpenErrorCopy, toggleShellPane } from './shellPane'
import { boardStore, selectShellPane } from '../stores/boardStore'
import { toastStore } from '../stores/toastStore'
import { deferred } from '../test/deferred'

function stubShell(
  open: (id: string) => Promise<{ terminalId: string }>
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(open)
  ;(window as unknown as { shell: unknown }).shell = { open: fn }
  return fn
}

beforeEach(() => {
  boardStore.setState({
    launchedTerminals: {},
    shellPanes: {},
    focusedTerminalId: null,
    terminalIdBySessionId: {}
  })
  toastStore.setState({ toasts: [] })
  boardStore.getState().openLaunchedTerminal('t-1', 'proj', 'default')
})
afterEach(() => vi.restoreAllMocks())

describe('shellOpenErrorCopy', () => {
  it('maps folder_missing to the launch copy', () => {
    expect(
      shellOpenErrorCopy(
        new Error("Error invoking remote method 'shell:open': Error: folder_missing")
      )
    ).toBe('That folder no longer exists.')
  })
  it('maps terminal_not_found and anything else to the generic line, never the message', () => {
    expect(shellOpenErrorCopy(new Error('terminal_not_found'))).toBe(
      'Could not open a shell for this session.'
    )
    expect(shellOpenErrorCopy(new Error('/home/op/secret'))).toBe(
      'Could not open a shell for this session.'
    )
  })
})

describe('toggleShellPane', () => {
  it('first press: invokes shell:open for the PARENT id and records the id main returned, visible', async () => {
    const open = stubShell(() => Promise.resolve({ terminalId: 't-1:shell' }))
    await toggleShellPane('t-1')
    expect(open).toHaveBeenCalledWith('t-1')
    expect(selectShellPane(boardStore.getState(), 't-1')).toEqual({
      terminalId: 't-1:shell',
      visible: true
    })
  })
  it('second press hides, third shows — with NO further invoke', async () => {
    const open = stubShell(() => Promise.resolve({ terminalId: 't-1:shell' }))
    await toggleShellPane('t-1')
    await toggleShellPane('t-1')
    expect(selectShellPane(boardStore.getState(), 't-1')?.visible).toBe(false)
    await toggleShellPane('t-1')
    expect(selectShellPane(boardStore.getState(), 't-1')?.visible).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('a refusal pushes ONE error toast with mapped copy, records no pane, logs a code only', async () => {
    stubShell(() => Promise.reject(new Error('Error: folder_missing /home/op/proj')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(toggleShellPane('t-1')).resolves.toBeUndefined()
    expect(selectShellPane(boardStore.getState(), 't-1')).toBeNull()
    const toasts = toastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.kind).toBe('error')
    expect(toasts[0]?.title).toBe('That folder no longer exists.')
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).toContain('code=shell_open_failed')
    expect(logged).not.toContain('/home/op')
  })
  // Only the order where the forget lands BEFORE the reply (a claude exit, a delete). An archive's
  // forget waits for main, so its reply comes first and the pane mounts hidden; main then refuses
  // the orphan shell id (shellCompanion.ts isOrphanCompanionId) — no stray $SHELL either way.
  it('a success that lands after the terminal was forgotten registers nothing', async () => {
    const d = deferred<{ terminalId: string }>()
    stubShell(() => d.promise)
    const pending = toggleShellPane('t-1')
    // Archived while the invoke was in flight: the archive flow (sessionExit.ts) goes to the
    // board, then forgets the terminal once main answered.
    boardStore.getState().showBoard()
    boardStore.getState().forgetLaunchedTerminal('t-1')
    d.resolve({ terminalId: 't-1:shell' })
    await pending
    expect(selectShellPane(boardStore.getState(), 't-1')).toBeNull()
  })
})
