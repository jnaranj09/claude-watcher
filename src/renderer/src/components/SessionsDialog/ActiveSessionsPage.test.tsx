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
beforeEach(() => {
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
