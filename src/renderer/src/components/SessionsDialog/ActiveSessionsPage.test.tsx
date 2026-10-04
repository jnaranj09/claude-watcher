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
import { openFromNotification } from '../../lib/openFromNotification'

vi.mock('../../lib/openFromNotification', () => ({
  openFromNotification: vi.fn(() => Promise.resolve())
}))
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

function renderOpening(): RenderResult {
  const r = renderComponent(
    <SessionsDialog page="active" onPageChange={() => {}} onClose={() => {}} now={() => NOW} />
  )
  cleanup = r.unmount
  return r
}
/** Most cases test one workspace's list: the page OPENS on All (owner 2026-10-03), so pick Ops. */
function render(): RenderResult {
  const r = renderOpening()
  chooseOption(r.container, 'active-session-scope-filter', 'ws:w1')
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
  it('opens on All sessions: every workspace, Needs you → Working → Idle, oldest first', () => {
    const r = renderOpening()
    expect(names(r)).toEqual(['name-d', 'name-b', 'name-c', 'name-a'])
  })

  it('one workspace: its sessions only, same order', () => {
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

describe('Sessions → Active — details', () => {
  function openRow(r: RenderResult, id: string): void {
    click(q(r, `[data-testid="active-session-select-${id}"]`))
  }

  it('the row opens read-only details: Name, Folder, Workspace, Tags, Status, Launched', () => {
    act(() =>
      boardStore.setState({
        launchedTerminals: {
          tb: { terminalId: 'tb', launchedAt: 1_000, label: 'b', workspaceId: 'w1' }
        }
      })
    )
    const r = render()
    openRow(r, 'b')
    expect(text(r, 'active-session-form-name')).toBe('name-b')
    expect(text(r, 'active-session-form-folder')).toBe('/home/op/b')
    expect(
      q(r, '[data-testid="active-session-form-workspace"] [data-tone]')?.getAttribute('data-tone')
    ).toBe('blue')
    expect(
      q(r, '[data-testid="active-session-form-status"] [data-testid="status-label"]')?.textContent
    ).toBe('Needs you')
    expect(q(r, '[data-testid="active-session-form-launched"]')).not.toBeNull()
    openRow(r, 'c') // no registry entry → no Launched row
    expect(q(r, '[data-testid="active-session-form-launched"]')).toBeNull()
  })

  it('the footer is [Delete] [Archive] [Open], Open the primary', () => {
    const r = render()
    openRow(r, 'b')
    const footer = q(r, '[data-manage-footer]')
    expect([...(footer?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Delete',
      'Archive',
      'Open'
    ])
  })

  it('Open closes the dialog FIRST, then opens the session like a notification click', () => {
    const onClose = vi.fn()
    const r = renderComponent(
      <SessionsDialog page="active" onPageChange={() => {}} onClose={onClose} now={() => NOW} />
    )
    cleanup = r.unmount
    openRow(r, 'b')
    click(q(r, '[data-testid="active-session-open"]'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(openFromNotification).toHaveBeenCalledWith('b')
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(openFromNotification).mock.invocationCallOrder[0] ?? 0
    )
  })

  it('Archive here archives this one session and closes the details', async () => {
    const r = render()
    openRow(r, 'b')
    click(q(r, '[data-testid="active-session-archive"]'))
    expect(archive).toHaveBeenCalledWith('tb')
    act(() => {
      const { b: _gone, ...rest } = SESSIONS
      void _gone
      boardStore.setState({ sessionsById: rest })
    })
    await flush()
    expect(text(r, 'sessions-success')).toBe('Archived "name-b".')
    expect(q(r, '[data-testid="active-session-placeholder"]')).not.toBeNull()
  })

  it('Delete here arms in place with the singular sentence; the bulk Delete stays at rest', () => {
    const r = render()
    click(box(r, 'c'))
    openRow(r, 'b')
    click(q(r, '[data-testid="active-session-delete"]'))
    expect(text(r, 'active-session-delete')).toBe('Confirm delete')
    expect(text(r, 'active-bulk-delete')).toBe('Delete')
    expect(text(r, 'active-session-delete-hint')).toBe(
      "The session is stopped and nothing is kept in Past sessions. Claude's own files are not touched."
    )
  })
})

describe('Sessions → Active — the arm and the visible rows (final review 2, 4b–4d)', () => {
  const type = (r: RenderResult, value: string): void => {
    const search = q<HTMLInputElement>(r, '[data-testid="active-session-search"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(search, value)
      search?.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('an armed bulk Delete whose rows ended comes back at rest, never pre-armed', () => {
    const r = render()
    click(box(r, 'b'))
    click(q(r, '[data-testid="active-bulk-delete"]'))
    expect(text(r, 'active-bulk-delete')).toBe('Confirm delete')
    act(() => {
      const { b: _gone, ...rest } = SESSIONS
      void _gone
      boardStore.setState({ sessionsById: rest })
    })
    click(box(r, 'c'))
    expect(text(r, 'active-bulk-delete')).toBe('Delete')
    expect(q(r, '[data-testid="active-bulk-delete-hint"]')).toBeNull()
  })

  it('a half-failed bulk Delete stays armed: one more press retries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    del.mockImplementation((t: string) =>
      t === 'tc' ? Promise.reject(new Error('x')) : Promise.resolve()
    )
    const r = render()
    click(box(r, 'b'))
    click(box(r, 'c'))
    click(q(r, '[data-testid="active-bulk-delete"]'))
    click(q(r, '[data-testid="active-bulk-delete"]'))
    await flush()
    expect(text(r, 'active-bulk-delete')).toBe('Confirm delete')
  })

  it('a bulk Delete that all landed disarms: the next selection starts at rest', async () => {
    const r = render()
    click(box(r, 'b'))
    click(q(r, '[data-testid="active-bulk-delete"]'))
    click(q(r, '[data-testid="active-bulk-delete"]'))
    await flush()
    click(box(r, 'c'))
    expect(text(r, 'active-bulk-delete')).toBe('Delete')
  })

  it('acts only on the checked rows the search leaves visible', async () => {
    const r = render()
    click(box(r, 'b'))
    click(box(r, 'c'))
    type(r, 'name-b')
    expect(text(r, 'active-bulk-count')).toBe('1 selected')
    click(q(r, '[data-testid="active-bulk-archive"]'))
    await flush()
    expect(archive.mock.calls.map((c) => c[0])).toEqual(['tb'])
  })
})
