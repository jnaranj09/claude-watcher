// Session templates — Task 15: App-level integration tests.
//
// Drives the header `+ New session` → popover (folder / template rows / Manage) → the whole
// wire-up end to end through the real App component with FAKE window bridges (no Electron):
//   - the popover lists loaded templates (loadTemplates() runs on mount);
//   - picking a template opens the name prompt with templateId + the template name as the
//     prefill, hint = the template's cwd, and does NOT touch window.launch.pickDirectory;
//   - submitting the prompt launches via window.launch.launchFromTemplate (never launch());
//   - "Pick a folder…" still runs the plain folder flow unchanged;
//   - "Manage templates…" opens the Sessions dialog on its Templates page; UX-DR14 single-modal rule refuses Ctrl+N
//     while it is open; ✕ closes it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import type { RenderResult } from './test/renderComponent'
import { renderApp, resetBoardView, stubAppBridges, unmountApp } from './test/appHarness'
import { boardStore } from './stores/boardStore'
import { templatesStore } from './stores/templatesStore'
import type { Template } from '../../shared/ipc/contract'

const T1: Template = {
  id: 'tpl-a',
  name: 'work api',
  cwd: '/home/op/api',
  model: 'opus',
  permissionMode: 'plan',
  effort: null,
  workspaceId: null,
  initialPrompt: null,
  params: [],
  favorite: false
}

/** Resolve a microtask/Promise chain inside act() so async effects settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

let launch: ReturnType<typeof vi.fn>
let launchFromTemplate: ReturnType<typeof vi.fn>
let pickDirectory: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetBoardView()
  launch = vi.fn(() =>
    Promise.resolve({ terminalId: 'launch-term-folder', workspaceId: 'default' })
  )
  launchFromTemplate = vi.fn(() =>
    Promise.resolve({ terminalId: 'launch-term-tpl', workspaceId: 'default' })
  )
  pickDirectory = vi.fn(() => Promise.resolve('/home/op/project'))
  stubAppBridges({
    launch: { pickDirectory, launch, launchFromTemplate },
    templates: { list: vi.fn(() => Promise.resolve([T1])) }
  })
})

afterEach(() => {
  unmountApp()
  act(() => templatesStore.getState().hydrate([]))
  vi.restoreAllMocks()
})

/** The `+ New session` menu is portaled to document.body. */
function qDoc<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}
function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

const click = (el: Element): void => act(() => (el as HTMLElement).click())

describe('App — session templates', () => {
  it('loads templates on mount and the header menu lists them', async () => {
    const r = await renderApp()
    click(q(r, '[data-testid="header-new-session"]'))
    expect(document.querySelectorAll('[data-testid="menu-template"]')).toHaveLength(1)
  })

  it('picking a template opens the name prompt with templateId + the template name, hint = cwd', async () => {
    const r = await renderApp()
    click(q(r, '[data-testid="header-new-session"]'))
    click(qDoc('[data-template-id="tpl-a"]'))
    const prompt = boardStore.getState().sessionNamePrompt
    expect(prompt).toEqual({
      mode: 'create',
      cwd: '/home/op/api',
      initialName: 'work api',
      templateId: 'tpl-a'
    })
    expect(q(r, '[data-testid="session-name-hint"]').textContent).toBe('/home/op/api')
    expect(pickDirectory).not.toHaveBeenCalled()
  })

  it('submitting the prompt launches FROM THE TEMPLATE (launch() untouched) and opens the terminal', async () => {
    const r = await renderApp()
    click(q(r, '[data-testid="header-new-session"]'))
    click(qDoc('[data-template-id="tpl-a"]'))
    click(q(r, '[data-testid="session-name-confirm"]'))
    await flush()
    expect(launchFromTemplate).toHaveBeenCalledWith('tpl-a', 'work api')
    expect(launch).not.toHaveBeenCalled()
    expect(boardStore.getState().focusedTerminalId).toBe('launch-term-tpl')
  })

  it('"Pick a folder…" still runs the folder flow', async () => {
    const r = await renderApp()
    click(q(r, '[data-testid="header-new-session"]'))
    click(qDoc('[data-testid="menu-pick-folder"]'))
    await flush()
    expect(pickDirectory).toHaveBeenCalledTimes(1)
    expect(boardStore.getState().sessionNamePrompt?.mode).toBe('create')
  })

  it('"Manage templates…" opens the dialog; Ctrl+N is refused while it is open; ✕ closes it', async () => {
    const r = await renderApp()
    click(q(r, '[data-testid="header-new-session"]'))
    click(qDoc('[data-testid="menu-manage"]'))
    expect(q(r, '[data-testid="sessions-overlay"]')).toBeTruthy()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }))
    })
    await flush()
    expect(pickDirectory).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="new-session-menu"]')).toBeNull()
    click(q(r, '[data-testid="sessions-close"]'))
    expect(r.container.querySelector('[data-testid="sessions-overlay"]')).toBeNull()
  })

  it('the dialog takes focus on mount; Escape from the page body closes it', async () => {
    const r = await renderApp()
    click(q(r, '[data-testid="header-new-session"]'))
    click(qDoc('[data-testid="menu-manage"]'))
    // An aria-modal dialog must take focus on mount (a11y) — the list search input does.
    expect(document.activeElement).toBe(q(r, '[data-testid="template-search"]'))
    // Blur it so the keydown reaches window from the page BODY, not from inside the dialog
    // (the dialog's own onKeyDown never sees it) — this is the path that used to leak.
    act(() => {
      ;(document.activeElement as HTMLElement).blur()
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(r.container.querySelector('[data-testid="sessions-overlay"]')).toBeNull()
    expect(boardStore.getState().sessionsDialog).toBeNull()
  })

  // THE BUG THIS CHANGE FIXES. The dead pane's `New session` used to run the folder picker
  // directly; it must now open the SAME popover the header opens and reach the SAME handlers.
  // The popover is portaled to document.body, so it is queried there, not on the container.
  it('the dead pane opens the popover and a template row reaches the SAME template flow', async () => {
    // A capturing onExit so the test can flip the launched terminal into its dead pane.
    const exitCbs: Array<(info: { terminalId: string; exitCode: number }) => void> = []
    ;(window as unknown as { terminal: unknown }).terminal = {
      open: vi.fn(() => () => {}),
      resize: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
      onExit: vi.fn((cb: (info: { terminalId: string; exitCode: number }) => void) => {
        exitCbs.push(cb)
        return () => {}
      })
    }
    boardStore.getState().openLaunchedTerminal('launch-dead', 'dead', 'default')
    const r = await renderApp()

    act(() => exitCbs.forEach((cb) => cb({ terminalId: 'launch-dead', exitCode: 0 })))
    click(q(r, '[data-testid="dead-new-session"]'))

    const menu = document.querySelector('[data-testid="new-session-menu"]')
    expect(menu, 'the dead pane must open the templates popover').not.toBeNull()

    click(document.body.querySelector('[data-template-id="tpl-a"]') as Element)
    await flush()
    // Same destination as the header path: the name prompt, carrying the templateId.
    expect(boardStore.getState().sessionNamePrompt).toEqual({
      mode: 'create',
      cwd: '/home/op/api',
      initialName: 'work api',
      templateId: 'tpl-a'
    })
    // …and it did NOT fall back to the folder picker (the old dead-pane behaviour).
    expect(pickDirectory).not.toHaveBeenCalled()
  })
})
