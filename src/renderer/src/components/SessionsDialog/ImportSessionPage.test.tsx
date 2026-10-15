// Sessions → Import (spec 2026-10-03 E): a claude session the app did not launch, by its id, into
// the workspace you pick. jsdom `unit`; the same harness as PastSessionsDialog.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { flush, renderComponent, type RenderResult } from '../../test/renderComponent'
import { SessionsDialog } from './SessionsDialog'
import { chooseOption, selectedValue } from '../../test/selectHarness'
import { pastSessionsStore } from '../../stores/pastSessionsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { tagsStore } from '../../stores/tagsStore'
import { boardStore } from '../../stores/boardStore'
import type { Workspace } from '../../../../shared/ipc/contract'

const WS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
]
const ID = '93b82f21-709b-41a5-8d8a-8b1a4af499bf'

let cleanup: (() => void) | undefined
let resumeById: ReturnType<typeof vi.fn>

beforeEach(() => {
  resumeById = vi.fn(() =>
    Promise.resolve({ terminalId: 'term-7', workspaceId: 'w1', name: 'Fix login' })
  )
  ;(window as unknown as { pastSessions: unknown }).pastSessions = {
    list: vi.fn(() => Promise.resolve([])),
    forget: vi.fn(),
    open: vi.fn(),
    resumeById
  }
  ;(window as unknown as { workspaces: unknown }).workspaces = {
    setActive: vi.fn(() => Promise.resolve({ activeId: 'w1', workspaces: WS }))
  }
  act(() => {
    workspacesStore.setState({ workspaces: WS, activeId: 'w1', loaded: true })
    tagsStore.setState({ tags: [], loaded: true, activeTagId: null })
    pastSessionsStore.setState({ sessions: [], loaded: false })
    boardStore.setState({
      viewMode: 'board',
      focusedTerminalId: null,
      launchedTerminals: {},
      sessionsById: {},
      terminalIdBySessionId: {}
    })
  })
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => {
    pastSessionsStore.setState({ sessions: [], loaded: false })
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
    boardStore.setState({ sessionsById: {}, terminalIdBySessionId: {}, selectedId: null })
  })
  vi.restoreAllMocks()
})

function render(): { r: RenderResult; onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  const r = renderComponent(
    <SessionsDialog page="import" onPageChange={() => {}} onClose={onClose} />
  )
  cleanup = r.unmount
  return { r, onClose }
}

const q = (r: RenderResult, sel: string): HTMLElement | null =>
  r.container.querySelector<HTMLElement>(sel)
const field = (r: RenderResult): HTMLInputElement | null =>
  r.container.querySelector<HTMLInputElement>('[data-testid="import-session-id"]')
const submit = (r: RenderResult): HTMLButtonElement | null =>
  r.container.querySelector<HTMLButtonElement>('[data-testid="import-submit"]')

function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Sessions → Import (spec 2026-10-03 E)', () => {
  it('is pages | form: an id field, a Workspace field, Import — and no explaining text', async () => {
    const { r } = render()
    await flush()
    expect(q(r, '[data-manage-rows]')).toBeNull() // no list on this page
    expect(field(r)?.placeholder).toBe('Paste a claude session id')
    expect(q(r, 'label[for="import-session-id"]')?.textContent).toBe('Claude session id')
    expect(submit(r)?.textContent).toBe('Import')
    expect(q(r, '[data-testid="import-form"] p')).toBeNull() // no hint, no sentence
    expect(document.activeElement).toBe(field(r))
  })

  it('Import is disabled while the id is empty or blank', async () => {
    const { r } = render()
    await flush()
    expect(submit(r)?.disabled).toBe(true)
    const input = field(r)
    if (input === null) throw new Error('no field')
    type(input, '   ')
    expect(submit(r)?.disabled).toBe(true)
  })

  it('the Workspace field opens on the ACTIVE workspace', async () => {
    const { r } = render()
    await flush()
    expect(selectedValue(r.container, 'import-workspace')).toBe('w1')
  })

  it('imports into the CHOSEN workspace, opens the terminal and closes the dialog', async () => {
    const { r, onClose } = render()
    await flush()
    chooseOption(r.container, 'import-workspace', 'default')
    const input = field(r)
    if (input === null) throw new Error('no field')
    type(input, ID)
    act(() => submit(r)?.click())
    await flush()
    expect(resumeById).toHaveBeenCalledWith(ID, 'default')
    expect(boardStore.getState().launchedTerminals['term-7']).toBeDefined()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('trims the pasted id and lower-cases it', async () => {
    const { r } = render()
    await flush()
    const input = field(r)
    if (input === null) throw new Error('no field')
    type(input, `  ${ID.toUpperCase()}\n`)
    act(() => submit(r)?.click())
    await flush()
    expect(resumeById).toHaveBeenCalledWith(ID, 'w1')
  })

  it('a refusal stays in the dialog as mapped copy, never the raw message', async () => {
    resumeById.mockRejectedValueOnce(
      new Error("Error invoking remote method 'past-sessions:import': Error: transcript_missing")
    )
    const { r, onClose } = render()
    await flush()
    const input = field(r)
    if (input === null) throw new Error('no field')
    type(input, ID)
    act(() => submit(r)?.click())
    await flush()
    expect(q(r, '[data-testid="import-error"]')?.textContent).toBe(
      'Claude has no conversation with that id'
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(submit(r)?.disabled).toBe(false)
  })

  it('already_open for a card the renderer knows → takes the view to it and closes', async () => {
    resumeById.mockRejectedValueOnce(
      new Error("Error invoking remote method 'past-sessions:import': Error: already_open")
    )
    act(() =>
      boardStore.setState({
        sessionsById: {
          [ID]: {
            id: ID,
            sessionName: 'Fix login',
            projectPath: '/home/op/web',
            status: 'WaitingForInput',
            pid: 1,
            column: 'idle',
            enteredColumnAt: 1,
            workspaceId: 'w1',
            tagIds: []
          }
        },
        terminalIdBySessionId: { [ID]: 'term-live' }
      })
    )
    const { r, onClose } = render()
    await flush()
    const input = field(r)
    if (input === null) throw new Error('no field')
    type(input, ID)
    act(() => submit(r)?.click())
    await flush()
    expect(boardStore.getState().focusedTerminalId).toBe('term-live')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
