// Past sessions — the history dialog (D-6), on the ManageDialog shell. jsdom `unit`; the
// `renderComponent` harness and `selectHarness` for the scope dropdown, like TagsDialog.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption, optionValues } from '../../test/selectHarness'
import { PastSessionsDialog } from './PastSessionsDialog'
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
  const r = renderComponent(<PastSessionsDialog onClose={onClose} />)
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
  it('loads on open, opens on the ACTIVE workspace, lists newest first, no Global / orphan entry', async () => {
    const { r } = render()
    await flush()
    expect(list).toHaveBeenCalledTimes(1)
    expect(q(r, '[data-testid="past-sessions-panel"]')).not.toBeNull()
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
    expect(q(r, '[data-testid="past-sessions-empty"]')?.textContent).toBe(
      'No past sessions in this workspace.'
    )
  })

  it('a row draws the folder basename, the relative end and only SURVIVING tag chips', async () => {
    const onClose = vi.fn()
    const r = renderComponent(
      <PastSessionsDialog onClose={onClose} now={() => A.endedAt + 5 * 60_000} />
    )
    cleanup = r.unmount
    await flush()
    const row = q(r, '[data-testid="past-session-row"]')
    expect(row?.querySelector('[data-testid="past-session-folder"]')?.textContent).toBe('api')
    expect(row?.querySelector('[data-testid="past-session-ended"]')?.textContent).toBe('5 min ago')
    expect(row?.querySelectorAll('[data-testid="tag-chip"]')).toHaveLength(1)
  })

  it('Open is disabled with no selection; selecting fills the read-only form', async () => {
    const { r } = render()
    await flush()
    expect((q(r, '[data-testid="past-session-open"]') as HTMLButtonElement).disabled).toBe(true)
    expect(q(r, '[data-testid="past-session-open"]')?.textContent).toBe('Open')
    act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
    expect((q(r, '[data-testid="past-session-open"]') as HTMLButtonElement).disabled).toBe(false)
    expect(q(r, '[data-testid="past-session-form-name"]')?.textContent).toBe('billing api')
    expect(q(r, '[data-testid="past-session-form-folder"]')?.getAttribute('title')).toBe(
      '/home/op/api'
    )
    expect(q(r, '[data-testid="past-session-form-workspace"]')?.textContent).toContain('Ops')
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
  // workspace the design's way (the orphan disc + `(no workspace)`), never a raw id.
  it('a record whose workspace is gone draws the orphan workspace, not its id', async () => {
    list.mockReturnValueOnce(Promise.resolve([{ ...A, workspaceId: 'gone-id' }]))
    const { r } = render()
    await flush()
    chooseOption(r.container, 'past-session-scope-filter', 'all')
    act(() => q(r, '[data-testid="past-session-select-sa"]')?.click())
    const ws = q(r, '[data-testid="past-session-form-workspace"]')
    expect(ws?.textContent).toBe('(no workspace)')
    expect(ws?.textContent).not.toContain('gone-id')
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

  it('focuses the search box on open (an aria-modal dialog takes focus)', async () => {
    const { r } = render()
    await flush()
    expect(document.activeElement).toBe(q(r, '[data-testid="past-session-search"]'))
  })
})
