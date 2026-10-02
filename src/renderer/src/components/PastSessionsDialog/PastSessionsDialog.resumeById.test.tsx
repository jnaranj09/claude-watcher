// Resume by id — the rail's bottom row in Past sessions. jsdom `unit`; the same harness as
// PastSessionsDialog.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { PastSessionsDialog } from './PastSessionsDialog'
import { pastSessionsStore } from '../../stores/pastSessionsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { tagsStore } from '../../stores/tagsStore'
import { boardStore } from '../../stores/boardStore'
import type { PastSession, Workspace } from '../../../../shared/ipc/contract'

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

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function render(): { r: RenderResult; onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  const r = renderComponent(<PastSessionsDialog onClose={onClose} />)
  cleanup = r.unmount
  return { r, onClose }
}

const q = (r: RenderResult, sel: string): HTMLElement | null =>
  r.container.querySelector<HTMLElement>(sel)
const field = (r: RenderResult): HTMLInputElement | null =>
  r.container.querySelector<HTMLInputElement>('[data-testid="past-session-resume-id"]')
const submit = (r: RenderResult): HTMLButtonElement | null =>
  r.container.querySelector<HTMLButtonElement>('[data-testid="past-session-resume-id-submit"]')

function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Past sessions — Resume by id', () => {
  it('shows the field and a disabled Resume while the field is empty or blank', async () => {
    const { r } = render()
    await flush()
    expect(field(r)?.placeholder).toBe('Paste a claude session id')
    expect(field(r)?.getAttribute('aria-label')).toBe('Claude session id')
    expect(submit(r)?.textContent).toBe('Resume')
    expect(submit(r)?.disabled).toBe(true)
    const input = field(r)
    if (input === null) throw new Error('no field')
    type(input, '   ')
    expect(submit(r)?.disabled).toBe(true)
  })

  it('resumes into the ACTIVE workspace, opens the terminal and closes the dialog', async () => {
    const { r, onClose } = render()
    await flush()
    const input = field(r)
    if (input === null) throw new Error('no field')
    type(input, ID)
    act(() => submit(r)?.click())
    await flush()
    expect(resumeById).toHaveBeenCalledWith(ID, 'w1')
    expect(boardStore.getState().launchedTerminals['term-7']).toBeDefined()
    expect(boardStore.getState().focusedTerminalId).toBe('term-7')
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
    expect(q(r, '[data-testid="past-session-error"]')?.textContent).toBe(
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

  describe('Open and Resume never run at once (two launches)', () => {
    const REC: PastSession = {
      id: 'sa',
      name: 'billing api',
      cwd: '/home/op/api',
      workspaceId: 'w1',
      tagIds: [],
      launchedAt: 1_000,
      endedAt: 5_000
    }
    const never = (): Promise<never> => new Promise<never>(() => {})
    let open: ReturnType<typeof vi.fn>

    beforeEach(() => {
      open = vi.fn(never)
      ;(window as unknown as { pastSessions: unknown }).pastSessions = {
        list: vi.fn(() => Promise.resolve([REC])),
        forget: vi.fn(),
        open,
        resumeById
      }
    })

    async function selectRecord(r: RenderResult): Promise<void> {
      await flush()
      act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
      await flush()
    }
    const openButton = (r: RenderResult): HTMLButtonElement | null =>
      r.container.querySelector<HTMLButtonElement>('[data-testid="past-session-open"]')

    it('Resume is disabled while Open is running', async () => {
      const { r } = render()
      await selectRecord(r)
      const input = field(r)
      if (input === null) throw new Error('no field')
      type(input, ID)
      expect(submit(r)?.disabled).toBe(false)
      act(() => openButton(r)?.click())
      await flush()
      expect(open).toHaveBeenCalledTimes(1)
      expect(submit(r)?.disabled).toBe(true)
    })

    it('Open is disabled while Resume is running', async () => {
      resumeById.mockImplementationOnce(never)
      const { r } = render()
      await selectRecord(r)
      expect(openButton(r)?.disabled).toBe(false)
      const input = field(r)
      if (input === null) throw new Error('no field')
      type(input, ID)
      act(() => submit(r)?.click())
      await flush()
      expect(resumeById).toHaveBeenCalledTimes(1)
      expect(openButton(r)?.disabled).toBe(true)
    })
  })
})
