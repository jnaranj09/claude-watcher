// Past sessions — the history dialog (D-6), on the ManageDialog shell. jsdom `unit`; the
// `renderComponent` harness and `selectHarness` for the scope dropdown, like TagsDialog.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption, optionValues } from '../../test/selectHarness'
import { SessionsDialog } from '../SessionsDialog/SessionsDialog'
import { pastSessionsStore } from '../../stores/pastSessionsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { tagsStore } from '../../stores/tagsStore'
import { boardStore } from '../../stores/boardStore'
import type { PastSession, Tag, Workspace } from '../../../../shared/ipc/contract'

const WS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
]
const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }
const A: PastSession = {
  id: 'sa',
  name: 'billing api',
  cwd: '/home/op/api',
  workspaceId: 'w1',
  tagIds: ['t-prod', 't-gone'],
  launchedAt: 1_000,
  endedAt: 5_000
}
const B: PastSession = {
  id: 'sb',
  name: 'deploy',
  cwd: '/home/op/deploy',
  workspaceId: 'default',
  tagIds: [],
  launchedAt: 2_000,
  endedAt: 9_000
}

let cleanup: (() => void) | undefined
let list: ReturnType<typeof vi.fn>
let forget: ReturnType<typeof vi.fn>
let open: ReturnType<typeof vi.fn>

beforeEach(() => {
  list = vi.fn(() => Promise.resolve([B, A]))
  forget = vi.fn(() => Promise.resolve([B]))
  open = vi.fn(() =>
    Promise.resolve({ terminalId: 'term-9', workspaceId: 'w1', name: 'billing api' })
  )
  ;(window as unknown as { pastSessions: unknown }).pastSessions = { list, forget, open }
  ;(window as unknown as { workspaces: unknown }).workspaces = {
    setActive: vi.fn(() => Promise.resolve({ activeId: 'w1', workspaces: WS }))
  }
  act(() => {
    workspacesStore.setState({ workspaces: WS, activeId: 'w1', loaded: true })
    tagsStore.setState({ tags: [PROD], loaded: true, activeTagId: null })
    pastSessionsStore.setState({ sessions: [], loaded: false })
    boardStore.setState({ viewMode: 'board', focusedTerminalId: null, launchedTerminals: {} })
  })
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => {
    pastSessionsStore.setState({ sessions: [], loaded: false })
    tagsStore.setState({ tags: [], loaded: false, activeTagId: null })
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
  })
  vi.restoreAllMocks()
})

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function render(): { r: RenderResult; onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  const r = renderComponent(
    <SessionsDialog page="past" onPageChange={() => {}} onClose={onClose} />
  )
  cleanup = r.unmount
  return { r, onClose }
}

const q = (r: RenderResult, sel: string): HTMLElement | null =>
  r.container.querySelector<HTMLElement>(sel)
const rows = (r: RenderResult): string[] =>
  [
    ...r.container.querySelectorAll(
      '[data-testid="past-session-row"] [data-testid="past-session-name"]'
    )
  ].map((e) => e.textContent ?? '')

function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('PastSessionsDialog', () => {
  it('loads on open, opens on the active workspace, no Global / orphan entry', async () => {
    const { r } = render()
    await flush()
    expect(list).toHaveBeenCalledTimes(1)
    expect(q(r, '[data-testid="sessions-panel"]')).not.toBeNull()
    // The dropdown opens on the active workspace (owner 2026-10-12); sessions are never global.
    expect(rows(r)).toEqual(['billing api'])
    expect(optionValues(r.container, 'past-session-scope-filter')).toEqual([
      'all',
      'ws:default',
      'ws:w1'
    ])
  })

  // The first open of a run has nothing loaded yet: "No past sessions yet." would be a lie for the
  // moment the list is in flight.
  it('says nothing about an empty history until the list has loaded', async () => {
    const { r } = render()
    expect(q(r, '[data-testid="past-sessions-empty"]')).toBeNull()
    await flush()
    act(() => pastSessionsStore.setState({ sessions: [], loaded: true }))
    expect(q(r, '[data-testid="past-sessions-empty"]')?.textContent).toBe('No past sessions yet.')
  })

  // A failed load must not look like a load still in flight: it goes on the ONE error line, as
  // copy — never the thrown message — and no empty sentence claims the history is empty.
  it('a failed load says so on the error line, and no empty sentence is shown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    list.mockRejectedValueOnce(new Error('/home/op/secret leaked'))
    const { r } = render()
    await flush()
    const error = q(r, '[data-testid="past-session-error"]')
    expect(error?.textContent).toBe('Could not load past sessions')
    expect(error?.getAttribute('role')).toBe('alert')
    expect(q(r, '[data-testid="past-sessions-empty"]')).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      '[claude-watcher][past-sessions] code=past_sessions_load_failed'
    )
  })

  // A re-open: the store still holds an earlier (empty) load. A failed refresh must not claim
  // "No past sessions yet." beside the error — that is exactly what could not be checked.
  it('a failed refresh over an earlier empty load shows the error, not an empty sentence', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    act(() => pastSessionsStore.setState({ sessions: [], loaded: true }))
    list.mockRejectedValueOnce(new Error('x'))
    const { r } = render()
    await flush()
    expect(q(r, '[data-testid="past-session-error"]')?.textContent).toBe(
      'Could not load past sessions'
    )
    expect(q(r, '[data-testid="past-sessions-empty"]')).toBeNull()
  })

  // App passes an inline `onClose`, so every App render hands the dialog a new one. That must not
  // re-run the mount effect: no second load, and focus stays where the operator put it.
  it('a re-render with a new onClose neither reloads the list nor steals focus', async () => {
    const { r } = render()
    await flush()
    act(() => q(r, '[data-testid="past-session-select-sa"]')?.focus())
    act(() =>
      r.root.render(<SessionsDialog page="past" onPageChange={() => {}} onClose={vi.fn()} />)
    )
    await flush()
    expect(list).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(q(r, '[data-testid="past-session-select-sa"]'))
  })

  it('a successful load leaves the error line empty', async () => {
    const { r } = render()
    await flush()
    expect(q(r, '[data-testid="past-session-error"]')).toBeNull()
  })

  it('All sessions shows every workspace; the search narrows by name; empty sentences differ', async () => {
    const { r } = render()
    await flush()
    chooseOption(r.container, 'past-session-scope-filter', 'all')
    expect(rows(r)).toEqual(['deploy', 'billing api'])
    type(q(r, '[data-testid="past-session-search"]') as HTMLInputElement, ' API ')
    expect(rows(r)).toEqual(['billing api'])
    type(q(r, '[data-testid="past-session-search"]') as HTMLInputElement, 'zzz')
    expect(q(r, '[data-testid="past-sessions-empty"]')?.textContent).toBe(
      'No past sessions match “zzz”.'
    )
    chooseOption(r.container, 'past-session-scope-filter', 'ws:default')
    type(q(r, '[data-testid="past-session-search"]') as HTMLInputElement, '')
    expect(rows(r)).toEqual(['deploy'])
  })

  it('a workspace with no history says so, not "no matches"', async () => {
    list.mockReturnValueOnce(Promise.resolve([B]))
    const { r } = render()
    await flush()
    chooseOption(r.container, 'past-session-scope-filter', 'ws:w1')
    expect(q(r, '[data-testid="past-sessions-empty"]')?.textContent).toBe(
      'No past sessions in this workspace.'
    )
  })

  it('a row draws the folder basename, the relative end and only SURVIVING tag chips', async () => {
    const onClose = vi.fn()
    const r = renderComponent(
      <SessionsDialog
        page="past"
        onPageChange={() => {}}
        onClose={onClose}
        now={() => A.endedAt + 5 * 60_000}
      />
    )
    cleanup = r.unmount
    await flush()
    chooseOption(r.container, 'past-session-scope-filter', 'ws:w1')
    const row = q(r, '[data-testid="past-session-row"]')
    expect(row?.querySelector('[data-testid="past-session-folder"]')?.textContent).toBe('api')
    expect(row?.querySelector('[data-testid="past-session-ended"]')?.textContent).toBe('5 min ago')
    expect(row?.querySelectorAll('[data-testid="tag-chip"]')).toHaveLength(1)
  })

  it('Open is not rendered with no selection; selecting fills the read-only form', async () => {
    const { r } = render()
    await flush()
    expect(q(r, '[data-testid="past-session-open"]')).toBeNull()
    act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
    expect(q(r, '[data-testid="past-session-open"]')?.textContent).toBe('Open')
    expect((q(r, '[data-testid="past-session-open"]') as HTMLButtonElement).disabled).toBe(false)
    expect(q(r, '[data-testid="past-session-form-name"]')?.textContent).toBe('billing api')
    expect(q(r, '[data-testid="past-session-form-folder"]')?.getAttribute('title')).toBe(
      '/home/op/api'
    )
    expect(q(r, '[data-testid="past-session-form-workspace"]')?.textContent).toContain('Ops')
    expect(
      q(r, '[data-testid="past-session-form-workspace"] [data-tone]')?.getAttribute('data-tone')
    ).toBe('blue')
    expect(
      q(r, '[data-testid="past-session-form-tags"]')?.querySelectorAll('[data-testid="tag-chip"]')
    ).toHaveLength(1)
    // The form is read-only: nothing in it can be typed into.
    expect(q(r, '[data-testid="past-session-form"]')?.querySelector('input, textarea')).toBeNull()
  })

  it('a record with no surviving tag says "No tags" instead of an empty field', async () => {
    const { r } = render()
    await flush()
    chooseOption(r.container, 'past-session-scope-filter', 'all')
    act(() => q(r, '[data-testid="past-session-select-sb"]')?.click())
    expect(q(r, '[data-testid="past-session-form-no-tags"]')?.textContent).toBe('No tags')
  })

  // The cascade makes this unreachable through the app; if it ever happens the form still draws a
  // workspace the design's way (the untinted `(no workspace)` name), never a raw id.
  it('a record whose workspace is gone draws the orphan workspace, not its id', async () => {
    list.mockReturnValueOnce(Promise.resolve([{ ...A, workspaceId: 'gone-id' }]))
    const { r } = render()
    await flush()
    chooseOption(r.container, 'past-session-scope-filter', 'all')
    act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
    const ws = q(r, '[data-testid="past-session-form-workspace"]')
    expect(ws?.textContent).toBe('(no workspace)')
    expect(ws?.textContent).not.toContain('gone-id')
    expect(ws?.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('orphan')
  })

  it('Open resumes it, takes the view and closes the dialog', async () => {
    const { r, onClose } = render()
    await flush()
    act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
    act(() => q(r, '[data-testid="past-session-open"]')?.click())
    await flush()
    expect(open).toHaveBeenCalledWith('sa')
    expect(boardStore.getState().focusedTerminalId).toBe('term-9')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a refused Open shows the code as copy on the ONE error line and keeps the dialog', async () => {
    open.mockRejectedValueOnce(new Error('folder_missing'))
    const { r, onClose } = render()
    await flush()
    act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
    act(() => q(r, '[data-testid="past-session-open"]')?.click())
    await flush()
    expect(q(r, '[data-testid="past-session-error"]')?.textContent).toBe(
      'That folder no longer exists'
    )
    expect(q(r, '[data-testid="past-session-error"]')?.getAttribute('role')).toBe('alert')
    expect(onClose).not.toHaveBeenCalled()
    // Not left busy: the operator can pick another row and try again.
    expect((q(r, '[data-testid="past-session-open"]') as HTMLButtonElement).disabled).toBe(false)
  })

  // Spec, Open step 3: `already_open` → "the renderer focuses the live card". The record can still
  // be listed while its session runs (a dead-pane Reopen of a resumed session re-runs a listed id).
  describe('Open on a session that is already LIVE', () => {
    // Electron's wrapping of a main-side throw, verbatim shape.
    const ALREADY_OPEN = new Error(
      "Error invoking remote method 'past-sessions:open': Error: already_open"
    )
    const liveCard = {
      id: 'sa',
      sessionName: 'billing api',
      projectPath: '/home/op/api',
      status: 'WaitingForInput',
      pid: 4242,
      column: 'idle' as const,
      enteredColumnAt: 1,
      // The live card sits in Default while the operator browses from Ops (w1): moved since.
      workspaceId: 'default',
      tagIds: []
    }

    afterEach(() => {
      act(() =>
        boardStore.setState({ sessionsById: {}, terminalIdBySessionId: {}, selectedId: null })
      )
    })

    it('takes the view to the live card — switching to its workspace — and closes the dialog', async () => {
      open.mockRejectedValueOnce(ALREADY_OPEN)
      const setActive = vi.fn(() => Promise.resolve({ activeId: 'default', workspaces: WS }))
      ;(window as unknown as { workspaces: unknown }).workspaces = { setActive }
      act(() =>
        boardStore.setState({
          sessionsById: { sa: liveCard },
          terminalIdBySessionId: { sa: 'term-live' }
        })
      )
      const { r, onClose } = render()
      await flush()
      act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
      act(() => q(r, '[data-testid="past-session-open"]')?.click())
      await flush()

      expect(setActive).toHaveBeenCalledWith('default')
      expect(workspacesStore.getState().activeId).toBe('default')
      expect(boardStore.getState().viewMode).toBe('focused')
      expect(boardStore.getState().focusedTerminalId).toBe('term-live')
      expect(boardStore.getState().selectedId).toBe('sa')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('stays in the workspace when the live card is already in the active one', async () => {
      open.mockRejectedValueOnce(ALREADY_OPEN)
      const setActive = vi.fn(() => Promise.resolve({ activeId: 'w1', workspaces: WS }))
      ;(window as unknown as { workspaces: unknown }).workspaces = { setActive }
      act(() =>
        boardStore.setState({
          sessionsById: { sa: { ...liveCard, workspaceId: 'w1' } },
          terminalIdBySessionId: { sa: 'term-live' }
        })
      )
      const { r, onClose } = render()
      await flush()
      act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
      act(() => q(r, '[data-testid="past-session-open"]')?.click())
      await flush()

      expect(setActive).not.toHaveBeenCalled()
      expect(boardStore.getState().focusedTerminalId).toBe('term-live')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('without a known terminal for it, keeps the dialog and says so on the error line', async () => {
      open.mockRejectedValueOnce(ALREADY_OPEN)
      const { r, onClose } = render()
      await flush()
      act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
      act(() => q(r, '[data-testid="past-session-open"]')?.click())
      await flush()

      expect(q(r, '[data-testid="past-session-error"]')?.textContent).toBe(
        'That session is already open'
      )
      expect(boardStore.getState().viewMode).toBe('board')
      expect(boardStore.getState().focusedTerminalId).toBeNull()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('another refusal never focuses a live card, even one the renderer knows', async () => {
      open.mockRejectedValueOnce(new Error('folder_missing'))
      act(() =>
        boardStore.setState({
          sessionsById: { sa: liveCard },
          terminalIdBySessionId: { sa: 'term-live' }
        })
      )
      const { r, onClose } = render()
      await flush()
      act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
      act(() => q(r, '[data-testid="past-session-open"]')?.click())
      await flush()

      expect(boardStore.getState().focusedTerminalId).toBeNull()
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  it('Forget arms in place (Forget → Confirm forget), then removes the record and returns to the empty form', async () => {
    const { r } = render()
    await flush()
    act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
    const btn = q(r, '[data-testid="past-session-forget"]')
    expect(btn?.textContent).toBe('Forget')
    act(() => btn?.click())
    expect(q(r, '[data-testid="past-session-forget"]')?.textContent).toBe('Confirm forget')
    expect(forget).not.toHaveBeenCalled()
    act(() => q(r, '[data-testid="past-session-forget"]')?.click())
    await flush()
    expect(forget).toHaveBeenCalledWith('sa')
    expect(q(r, '[data-testid="past-session-form-name"]')).toBeNull()
    expect(q(r, '[data-testid="sessions-success"]')?.textContent).toBe('Session forgotten.')
  })

  it('a refused Forget keeps the record and says so on the error line', async () => {
    forget.mockRejectedValueOnce(new Error('boom'))
    const { r } = render()
    await flush()
    act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
    act(() => q(r, '[data-testid="past-session-forget"]')?.click())
    act(() => q(r, '[data-testid="past-session-forget"]')?.click())
    await flush()
    expect(q(r, '[data-testid="past-session-error"]')?.textContent).toBe(
      'Could not forget the session'
    )
    expect(q(r, '[data-testid="past-session-form-name"]')?.textContent).toBe('billing api')
  })

  it('offers no Forget with nothing selected, and no + New (there is nothing to create)', async () => {
    const { r } = render()
    await flush()
    expect(q(r, '[data-testid="past-session-forget"]')).toBeNull()
    expect(r.container.textContent).not.toContain('+ New')
  })

  it('changing the scope drops the selection (design.md)', async () => {
    const { r } = render()
    await flush()
    act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
    chooseOption(r.container, 'past-session-scope-filter', 'all')
    expect(q(r, '[data-testid="past-session-form-name"]')).toBeNull()
  })

  it('UX-15: says the history keeps only the 200 most recent sessions', async () => {
    const { r } = render()
    await flush()
    expect(q(r, '[data-testid="past-sessions-cap-note"]')?.textContent).toBe(
      'Keeps the 200 most recent sessions'
    )
  })

  it('the cap note sits in the rail`s divided bottom slot; no Resume by id on this page (spec 2026-10-03 E)', async () => {
    const { r } = render()
    await flush()
    const slot = q(r, '[data-manage-list-bottom]')
    expect(slot?.hasAttribute('data-manage-list-divided')).toBe(true)
    expect(slot?.querySelector('[data-testid="past-sessions-cap-note"]')).toBeTruthy()
    expect(r.container.querySelector('[data-testid="past-session-resume-by-id"]')).toBeNull()
  })

  it('focuses the search box on open (an aria-modal dialog takes focus)', async () => {
    const { r } = render()
    await flush()
    expect(document.activeElement).toBe(q(r, '[data-testid="past-session-search"]'))
  })
})

describe('nothing open → placeholder (spec 2026-09-29)', () => {
  it('opens on the placeholder, with no Open button rendered', async () => {
    const { r } = render()
    await flush()
    expect(q(r, '[data-testid="past-session-placeholder"]')?.textContent).toBe(
      'Select a session on the left.'
    )
    expect(q(r, '[data-testid="past-session-open"]')).toBeNull()
  })

  it('picking a row replaces the placeholder with that row', async () => {
    const { r } = render()
    await flush()
    act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
    expect(q(r, '[data-testid="past-session-placeholder"]')).toBeNull()
    expect(q(r, '[data-testid="past-session-open"]')).not.toBeNull()
  })
})
