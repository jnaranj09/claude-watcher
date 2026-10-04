// Session-naming A2 — App-level RENAME flow tests.
//
// The whole path, end to end in the renderer: the board card's pencil opens the name dialog in
// RENAME mode (not create mode), submitting calls `window.launch.rename(sessionId, name)`, and the
// renderer does NOT write the new name into the store — session truth is main's, so the retitled
// card only appears when main echoes a `session.updated` delta back.
//
// DO NOT MODIFY: App.launch.test.tsx (the frozen B-1 guardrail). This file is a SIBLING, mirroring
// its beforeEach/seams. (The one edit made there was a compile fix forced by turning
// `SessionNamePromptPayload` into a create|rename union — narrowing before reading `.cwd`. No
// behaviour assertion in that file changed.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import { boardStore } from './stores/boardStore'
import { pointerInput } from './test/pointerInput'
import type { WatchEventsPayload } from '../../shared/ipc/contract'

/** Resolve a microtask/Promise chain inside act() so async effects settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** A main→renderer `session.updated` delta, already enriched (column + enteredColumnAt + pid). */
function updated(id: string, sessionName: string): WatchEventsPayload {
  return {
    epoch: 0,
    event: {
      type: 'session.updated',
      id,
      sessionName,
      projectPath: '/home/op/project',
      status: 'Working',
      column: 'working',
      enteredColumnAt: 100,
      pid: 4242,
      workspaceId: 'default',
      tagIds: []
    }
  }
}

let cleanup: (() => void) | undefined
let renameSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null,
    sessionsById: {},
    acknowledgedById: {},
    terminalIdBySessionId: {},
    launchedTerminals: {},
    sessionNamePrompt: null
  })

  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {
      /* no-op shim — jsdom has no layout */
    }
    unobserve(): void {
      /* no-op shim */
    }
    disconnect(): void {
      /* no-op shim */
    }
  }
  ;(window as unknown as { pty: unknown }).pty = {
    smokeConfig: vi.fn(() => Promise.resolve({ enabled: false, electron: '', abi: '', node: '' }))
  }
  ;(window as unknown as { watch: unknown }).watch = {
    onEvents: vi.fn(() => () => {}),
    onStatus: vi.fn(() => () => {})
  }
  ;(window as unknown as { attention: unknown }).attention = {
    onActivate: vi.fn(() => () => {}),
    onReminder: vi.fn(() => () => {}),
    reportFocusedTerminal: vi.fn()
  }
  ;(window as unknown as { settings: unknown }).settings = {
    get: vi.fn(() =>
      Promise.resolve({
        version: 1,
        soundEnabled: true,
        terminalFontSize: 14,
        reminderCount: 3,
        reminderFirstDelayMinutes: 2
      })
    ),
    set: vi.fn(() =>
      Promise.resolve({
        version: 1,
        soundEnabled: true,
        terminalFontSize: 14,
        reminderCount: 3,
        reminderFirstDelayMinutes: 2
      })
    )
  }
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => () => {})
  }
  renameSpy = vi.fn(() => Promise.resolve())
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory: vi.fn(() => Promise.resolve('/home/op/project')),
    launch: vi.fn(() => Promise.resolve({ terminalId: 'launch-term-xyz', workspaceId: 'default' })),
    launchFromTemplate: vi.fn(() =>
      Promise.resolve({ terminalId: 'launch-term-tpl', workspaceId: 'default' })
    ),
    rename: renameSpy,
    onCorrelated: vi.fn(() => () => {}),
    markSeen: vi.fn(() => Promise.resolve(undefined))
  }
  // Session templates: loadTemplates() now runs on every App mount — stub it so it never
  // console.warns a code (App.templates.test.tsx amendment #2).
  ;(window as unknown as { templates: unknown }).templates = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(),
    remove: vi.fn()
  }
  window.location.hash = ''
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

async function renderApp(): Promise<RenderResult> {
  const r = renderComponent(<App />)
  cleanup = r.unmount
  await flush()
  return r
}

/** Seed one board card and render, returning the card's rename pencil. */
async function renderWithCard(
  id = 'sess-1',
  name = 'project'
): Promise<{ r: RenderResult; pencil: HTMLButtonElement }> {
  const r = await renderApp()
  act(() => boardStore.getState().applyWatchEvent(updated(id, name)))
  await flush()
  const pencil = r.container.querySelector<HTMLButtonElement>('[data-testid="card-rename"]')
  expect(pencil).not.toBeNull()
  return { r, pencil: pencil as HTMLButtonElement }
}

describe('App — rename an existing session (session-naming A2)', () => {
  it('the card pencil opens the name prompt in RENAME mode, prefilled with the current name', async () => {
    const { r, pencil } = await renderWithCard('sess-1', 'project')

    act(() => pencil.click())
    await flush()

    const prompt = boardStore.getState().sessionNamePrompt
    expect(prompt?.mode).toBe('rename')
    expect(prompt !== null && prompt.mode === 'rename' ? prompt.sessionId : null).toBe('sess-1')
    expect(prompt?.initialName).toBe('project')
    // The dialog is on screen, reading as a rename rather than a create.
    const dialog = r.container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('Rename')
    // Nothing was renamed by merely opening it.
    expect(renameSpy).not.toHaveBeenCalled()
  })

  it('submitting calls window.launch.rename with the session id and the typed name', async () => {
    const { r, pencil } = await renderWithCard('sess-1', 'project')
    act(() => pencil.click())
    await flush()

    // The dialog's own field, by testid: the board's search box is a text input too, and sits first.
    const input = r.container.querySelector<HTMLInputElement>('[data-testid="session-name-input"]')
    expect(input).not.toBeNull()
    act(() => {
      // Drive React's onChange the way jsdom requires (native setter + input event).
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(input, 'deploy-prod')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = r.container.querySelector('form')
    act(() => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    expect(renameSpy).toHaveBeenCalledTimes(1)
    expect(renameSpy).toHaveBeenCalledWith('sess-1', 'deploy-prod')
    // The prompt closed.
    expect(boardStore.getState().sessionNamePrompt).toBeNull()
  })

  it('does NOT write the new name into the store — main owns session truth', async () => {
    const { r, pencil } = await renderWithCard('sess-1', 'project')
    act(() => pencil.click())
    await flush()
    // The dialog's own field, by testid: the board's search box is a text input too, and sits first.
    const input = r.container.querySelector<HTMLInputElement>('[data-testid="session-name-input"]')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(input, 'deploy-prod')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      r.container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    // The IPC fired, but the projection still shows the OLD name: the renderer never invents
    // session truth (state.md). It changes only when main echoes the delta back.
    expect(renameSpy).toHaveBeenCalled()
    expect(boardStore.getState().sessionsById['sess-1']?.sessionName).toBe('project')

    // ...and when main DOES echo it, the card updates through the normal delta path.
    act(() => boardStore.getState().applyWatchEvent(updated('sess-1', 'deploy-prod')))
    await flush()
    expect(boardStore.getState().sessionsById['sess-1']?.sessionName).toBe('deploy-prod')
    expect(r.container.querySelector('[data-testid="session-name"]')?.textContent).toBe(
      'deploy-prod'
    )
  })

  it('cancelling the rename prompt is a complete no-op (no IPC, name unchanged)', async () => {
    const { r, pencil } = await renderWithCard('sess-1', 'project')
    act(() => pencil.click())
    await flush()

    const cancel = [...r.container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Cancel'
    )
    expect(cancel).not.toBeUndefined()
    act(() => cancel?.click())
    await flush()

    expect(boardStore.getState().sessionNamePrompt).toBeNull()
    expect(renameSpy).not.toHaveBeenCalled()
    expect(boardStore.getState().sessionsById['sess-1']?.sessionName).toBe('project')
  })

  it('a rejected rename invoke is swallowed — the board survives and logs no value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renameSpy.mockImplementation(() => Promise.reject(new Error('boundary rejected')))
    const { r, pencil } = await renderWithCard('sess-1', 'project')
    act(() => pencil.click())
    await flush()
    // The dialog's own field, by testid: the board's search box is a text input too, and sits first.
    const input = r.container.querySelector<HTMLInputElement>('[data-testid="session-name-input"]')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(input, 'client-acme-secret')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      r.container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    // Never-crash: the card is still on the board with its old name.
    expect(r.container.querySelector('[data-testid="session-name"]')?.textContent).toBe('project')
    // never-log-the-value: a code only, and the typed name appears in NO log argument.
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain('code=rename_failed')
    expect(logged).not.toContain('client-acme-secret')
  })

  it('the pencil does not also activate the card (still on the board, not the focused view)', async () => {
    const { pencil } = await renderWithCard('sess-1', 'project')

    act(() => pencil.click())
    await flush()

    // If the click had bubbled to the card root, activateCard would have switched the view and
    // selected the session — leaving the rename dialog floating over the focused terminal.
    expect(boardStore.getState().viewMode).toBe('board')
    expect(boardStore.getState().selectedId).toBeNull()
  })

  it('the rename dialog carries the one helper line; the create dialog does not', async () => {
    const { r, pencil } = await renderWithCard('sess-1', 'project')
    act(() => pencil.click())
    await flush()

    expect(document.querySelector('[data-testid="session-name-helper"]')?.textContent).toBe(
      'Applies in Claude on your next prompt.'
    )

    // Cancel the rename prompt (a complete no-op — see the case above) before opening create mode:
    // the two prompts share the single-modal z-60 layer and can never co-exist.
    const cancel = [...r.container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Cancel'
    )
    act(() => cancel?.click())
    await flush()
    expect(boardStore.getState().sessionNamePrompt).toBeNull()

    // Now open the CREATE dialog the same way App.launch.test.tsx does: the header's `+ New
    // session` popover → `Pick a folder…`, which resolves window.launch.pickDirectory and opens
    // the prompt in create mode.
    act(() =>
      (r.container.querySelector('[data-testid="header-new-session"]') as HTMLButtonElement).click()
    )
    act(() =>
      (r.container.querySelector('[data-testid="menu-pick-folder"]') as HTMLButtonElement).click()
    )
    await flush()

    expect(boardStore.getState().sessionNamePrompt?.mode).toBe('create')
    expect(r.container.querySelector('[data-testid="session-name-helper"]')).toBeNull()
  })

  it('refuses to re-enter while a prompt is already open (no payload swap under the dialog)', async () => {
    const r = await renderApp()
    act(() => {
      boardStore.getState().applyWatchEvent(updated('sess-1', 'first'))
      boardStore.getState().applyWatchEvent(updated('sess-2', 'second'))
    })
    await flush()

    const pencils = r.container.querySelectorAll<HTMLButtonElement>('[data-testid="card-rename"]')
    expect(pencils.length).toBe(2)
    act(() => pencils[0]?.click())
    await flush()
    const firstPrompt = boardStore.getState().sessionNamePrompt
    act(() => pencils[1]?.click())
    await flush()

    // Still the FIRST session's prompt — the second click was refused, so the dialog's input can
    // never hold one session's typed name while onSubmit closes over another's id.
    expect(boardStore.getState().sessionNamePrompt).toEqual(firstPrompt)
  })

  // Overlay motion (2026-10-04 review): main's answer clears the prompt AND its busy flag in one
  // update. The dialog fading out must keep the label it had ("Renaming…"), not flip back to
  // "Rename" for its last 150 ms.
  it('the prompt fading out after a busy submit keeps its busy label', async () => {
    const { r, pencil } = await renderWithCard()
    act(() => pencil.click())
    await flush()
    act(() => boardStore.getState().setSessionNamePromptBusy(true))
    const confirm = (): HTMLButtonElement | null =>
      r.container.querySelector<HTMLButtonElement>('[data-testid="session-name-confirm"]')
    expect(confirm()?.textContent).toContain('Renaming…')
    const clearInput = pointerInput()
    act(() => boardStore.getState().clearSessionNamePrompt())
    expect(
      r.container
        .querySelector('[data-testid="session-name-overlay"]')
        ?.hasAttribute('data-leaving')
    ).toBe(true)
    expect(confirm()?.textContent).toContain('Renaming…')
    clearInput()
  })
})
