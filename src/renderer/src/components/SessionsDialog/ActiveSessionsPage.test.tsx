// Sessions → Active (spec 2026-10-03 D): the live sessions of a scope, checkable, oldest
// needs-you first. jsdom `unit`; sessions arrive as store state, the way watch deltas land them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption } from '../../test/selectHarness'
import { SessionsDialog } from './SessionsDialog'
import { boardStore, type BoardSession } from '../../stores/boardStore'
import { tagsStore } from '../../stores/tagsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import type { Workspace } from '../../../../shared/ipc/contract'
import { deferred } from '../../test/deferred'
import { toastStore } from '../../stores/toastStore'

const WS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
]
const NOW = 10 * 60_000
const card = (
  id: string,
  column: BoardSession['column'],
  enteredColumnAt: number,
  workspaceId = 'w1'
): BoardSession => ({
  id,
  sessionName: `name-${id}`,
  projectPath: `/home/op/${id}`,
  status: 'x',
  pid: 1,
  column,
  enteredColumnAt,
  workspaceId,
  tagIds: []
})
const SESSIONS = {
  a: card('a', 'idle', 0),
  b: card('b', 'needs-you', 6 * 60_000),
  c: card('c', 'working', 0),
  d: card('d', 'needs-you', 0, 'default')
}

let cleanup: (() => void) | undefined
let archive: ReturnType<typeof vi.fn>
let del: ReturnType<typeof vi.fn>
beforeEach(() => {
  archive = vi.fn(() => Promise.resolve())
  del = vi.fn(() => Promise.resolve())
  ;(window as unknown as { launch: unknown }).launch = {
    archiveSession: archive,
    deleteSession: del
  }
  act(() => {
    workspacesStore.setState({ workspaces: WS, activeId: 'w1', loaded: true })
    tagsStore.setState({ tags: [], loaded: true, activeTagId: null })
    boardStore.setState({
      sessionsById: SESSIONS,
      terminalIdBySessionId: { a: 'ta', b: 'tb', c: 'tc', d: 'td' },
      launchedTerminals: {},
      selectedId: null
    })
  })
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => boardStore.setState({ sessionsById: {}, terminalIdBySessionId: {} }))
  vi.restoreAllMocks()
})

function render(): RenderResult {
  const r = renderComponent(
    <SessionsDialog page="active" onPageChange={() => {}} onClose={() => {}} now={() => NOW} />
  )
  cleanup = r.unmount
  return r
}
const q = <T extends Element = HTMLElement>(r: RenderResult, sel: string): T | null =>
  r.container.querySelector<T>(sel)
const names = (r: RenderResult): string[] =>
  [...r.container.querySelectorAll('[data-testid="active-session-name"]')].map(
    (e) => e.textContent ?? ''
  )
const box = (r: RenderResult, id: string): HTMLInputElement | null =>
  q<HTMLInputElement>(r, `[data-testid="active-session-check-${id}"]`)
const all = (r: RenderResult): HTMLInputElement | null =>
  q<HTMLInputElement>(r, '[data-testid="active-select-all"]')
const click = (el: Element | null): void => act(() => (el as HTMLElement | null)?.click())

describe('Sessions → Active', () => {
  it('opens on the active workspace: Needs you → Working → Idle, oldest first', () => {
    const r = render()
    expect(names(r)).toEqual(['name-b', 'name-c', 'name-a'])
  })

  it('each row reads status dot + word + time in that status', () => {
    const r = render()
    const row = r.container.querySelector('[data-testid="active-session-row"]')
    expect(row?.querySelector('[data-testid="status-label"]')?.textContent).toBe('Needs you · 4m')
  })

  it('All sessions lists every workspace; the scope offers no Global', () => {
    const r = render()
    chooseOption(r.container, 'active-session-scope-filter', 'all')
    expect(names(r)).toEqual(['name-d', 'name-b', 'name-c', 'name-a'])
    expect(q(r, '[data-testid="active-session-scope-filter-option-global"]')).toBeNull()
  })

  it('three empty sentences: none at all, none in this workspace, no search match', () => {
    const r = render()
    const search = q<HTMLInputElement>(r, '[data-testid="active-session-search"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(search, 'zzz')
      search?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(q(r, '[data-testid="active-sessions-empty"]')?.textContent).toBe(
      'No sessions match your search.'
    )
    act(() => boardStore.setState({ sessionsById: { d: SESSIONS.d } }))
    act(() => {
      setter?.call(search, '')
      search?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(q(r, '[data-testid="active-sessions-empty"]')?.textContent).toBe(
      'No sessions are running in this workspace.'
    )
    act(() => boardStore.setState({ sessionsById: {} }))
    expect(q(r, '[data-testid="active-sessions-empty"]')?.textContent).toBe(
      'No sessions are running.'
    )
    expect(all(r)).toBeNull() // nothing to select
  })

  it('a checkbox does not open the row; the row opens on its own control', () => {
    const r = render()
    click(box(r, 'b'))
    expect(box(r, 'b')?.checked).toBe(true)
    expect(q(r, '[data-testid="active-session-placeholder"]')).not.toBeNull()
  })

  it('Select all checks every visible row; some checked → indeterminate; all → unchecks them', () => {
    const r = render()
    click(box(r, 'b'))
    expect(all(r)?.checked).toBe(false)
    expect(all(r)?.indeterminate).toBe(true)
    click(all(r))
    expect(['a', 'b', 'c'].map((id) => box(r, id)?.checked)).toEqual([true, true, true])
    expect(all(r)?.indeterminate).toBe(false)
    click(all(r))
    expect(['a', 'b', 'c'].map((id) => box(r, id)?.checked)).toEqual([false, false, false])
  })

  it('LIVE: an ended session leaves the list; a new one arrives unchecked', () => {
    const r = render()
    click(all(r))
    act(() => {
      const { a: _gone, ...rest } = SESSIONS
      void _gone
      boardStore.setState({ sessionsById: { ...rest, e: card('e', 'working', 1) } })
    })
    expect(names(r)).toEqual(['name-b', 'name-c', 'name-e'])
    expect(box(r, 'e')?.checked).toBe(false)
    expect(all(r)?.indeterminate).toBe(true)
  })

  it('a scope change clears the checks', () => {
    const r = render()
    click(box(r, 'b'))
    chooseOption(r.container, 'active-session-scope-filter', 'all')
    expect(box(r, 'b')?.checked).toBe(false)
  })
})

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}
const text = (r: RenderResult, id: string): string | null | undefined =>
  q(r, `[data-testid="${id}"]`)?.textContent

describe('Sessions → Active — the bulk bar', () => {
  it('shows only while a row is checked, behind a divider: "N selected [Archive] [Delete]"', () => {
    const r = render()
    expect(q(r, '[data-testid="active-bulk-count"]')).toBeNull()
    click(box(r, 'b'))
    click(box(r, 'c'))
    expect(text(r, 'active-bulk-count')).toBe('2 selected')
    const slot = q(r, '[data-testid="active-bulk-count"]')?.closest('[data-manage-list-bottom]')
    expect(slot?.hasAttribute('data-manage-list-divided')).toBe(true)
    expect(text(r, 'active-bulk-archive')).toBe('Archive')
    expect(text(r, 'active-bulk-delete')).toBe('Delete')
  })

  it('Archive: no confirm; one call per checked row; the slot says so — no toast, no board', async () => {
    act(() => boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'tz' }))
    act(() => toastStore.setState({ toasts: [] }))
    const r = render()
    click(box(r, 'b'))
    click(box(r, 'c'))
    click(q(r, '[data-testid="active-bulk-archive"]'))
    expect(archive.mock.calls.map((c) => c[0]).sort()).toEqual(['tb', 'tc'])
    await flush()
    expect(text(r, 'sessions-success')).toBe('Archived 2 sessions.')
    expect(boardStore.getState().viewMode).toBe('focused') // the card's showBoard() never ran
    expect(toastStore.getState().toasts).toEqual([])
  })

  it('a partial failure names the refused one and keeps it checked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    archive.mockImplementation((t: string) =>
      t === 'tc' ? Promise.reject(new Error('x')) : Promise.resolve()
    )
    const r = render()
    click(box(r, 'b'))
    click(box(r, 'c'))
    click(q(r, '[data-testid="active-bulk-archive"]'))
    await flush()
    expect(text(r, 'active-session-error')).toBe('Archived "name-b". Could not archive "name-c".')
    expect(box(r, 'c')?.checked).toBe(true)
    expect(box(r, 'b')?.checked).toBe(false)
  })

  it('Delete arms in place with the consequence sentence; the second press deletes', async () => {
    const r = render()
    click(box(r, 'b'))
    click(box(r, 'c'))
    click(q(r, '[data-testid="active-bulk-delete"]'))
    expect(del).not.toHaveBeenCalled()
    expect(text(r, 'active-bulk-delete')).toBe('Confirm delete')
    expect(text(r, 'active-bulk-delete-hint')).toBe(
      "The sessions are stopped and nothing is kept in Past sessions. Claude's own files are not touched."
    )
    expect(document.querySelector('[data-testid="stop-confirm-overlay"]')).toBeNull()
    click(q(r, '[data-testid="active-bulk-delete"]'))
    expect(del.mock.calls.map((c) => c.slice(0, 2)).sort()).toEqual([
      ['tb', 'b'],
      ['tc', 'c']
    ])
    await flush()
    expect(text(r, 'sessions-success')).toBe('Deleted 2 sessions.')
  })

  it('both buttons are busy while main answers: one press, one action', async () => {
    const held = deferred<void>()
    archive.mockImplementation(() => held.promise)
    const r = render()
    click(box(r, 'b'))
    click(q(r, '[data-testid="active-bulk-archive"]'))
    await flush()
    expect(q<HTMLButtonElement>(r, '[data-testid="active-bulk-archive"]')?.disabled).toBe(true)
    click(q(r, '[data-testid="active-bulk-archive"]'))
    expect(archive).toHaveBeenCalledTimes(1)
    held.resolve()
    await flush()
  })
})
