// The Sessions dialog (spec 2026-10-03 B): one dialog, a page column, the scope kept across pages.
// jsdom `unit`; the same store setup as the Past sessions and Templates dialog tests.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, useState, type JSX } from 'react'
import { flush, renderComponent, type RenderResult } from '../../test/renderComponent'
import { chooseOption, selectedValue } from '../../test/selectHarness'
import { SessionsDialog } from './SessionsDialog'
import type { SessionsPage } from '../../stores/boardStore'
import { pastSessionsStore } from '../../stores/pastSessionsStore'
import { templatesStore } from '../../stores/templatesStore'
import { tagsStore } from '../../stores/tagsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { boardStore } from '../../stores/boardStore'
import { deferred } from '../../test/deferred'
import type { Template, Workspace } from '../../../../shared/ipc/contract'

const WS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
]
const TPL: Template = {
  id: 't1',
  name: 'api',
  cwd: '/home/op/api',
  model: 'opus',
  permissionMode: 'plan',
  effort: 'high',
  workspaceId: 'w1',
  initialPrompt: null,
  params: [],
  favorite: false
}

let cleanup: (() => void) | undefined
beforeEach(() => {
  ;(window as unknown as { pastSessions: unknown }).pastSessions = {
    list: vi.fn(() => Promise.resolve([])),
    forget: vi.fn(),
    open: vi.fn(),
    resumeById: vi.fn()
  }
  act(() => {
    workspacesStore.setState({ workspaces: WS, activeId: 'w1', loaded: true })
    tagsStore.setState({ tags: [], loaded: true, activeTagId: null })
    pastSessionsStore.setState({ sessions: [], loaded: true })
    templatesStore.setState({ templates: [TPL], loaded: true, loadFailed: false })
  })
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  delete (window as unknown as { launch?: unknown }).launch
  vi.restoreAllMocks()
})

function Harness({ initial }: { initial: SessionsPage }): JSX.Element {
  const [page, setPage] = useState<SessionsPage>(initial)
  return <SessionsDialog page={page} onPageChange={setPage} onClose={() => {}} />
}

function render(initial: SessionsPage): RenderResult {
  const r = renderComponent(<Harness initial={initial} />)
  cleanup = r.unmount
  return r
}

const q = (r: RenderResult, sel: string): HTMLElement | null =>
  r.container.querySelector<HTMLElement>(sel)
const click = (el: Element | null): void => act(() => (el as HTMLElement | null)?.click())

describe('SessionsDialog', () => {
  it('is ONE dialog titled Sessions with a page column; the asked-for page is current', async () => {
    const r = render('templates')
    await flush()
    expect(q(r, '[data-testid="sessions-overlay"]')?.getAttribute('aria-label')).toBe('Sessions')
    expect(q(r, 'nav[data-manage-pages]')?.getAttribute('aria-label')).toBe('Sessions pages')
    expect(q(r, '[data-testid="sessions-page-templates"]')?.getAttribute('aria-current')).toBe(
      'page'
    )
    expect(q(r, '[data-testid="template-search"]')).not.toBeNull()
  })

  it('a page row switches page', async () => {
    const r = render('templates')
    click(q(r, '[data-testid="sessions-page-past"]'))
    await flush()
    expect(q(r, '[data-testid="template-search"]')).toBeNull()
    expect(q(r, '[data-testid="past-session-search"]')).not.toBeNull()
    expect(q(r, '[data-testid="sessions-page-past"]')?.getAttribute('aria-current')).toBe('page')
  })

  it('a page switch closes what was open', async () => {
    const r = render('templates')
    click(q(r, '[data-template-id="t1"]'))
    expect(q(r, '[data-testid="template-name"]')).not.toBeNull()
    click(q(r, '[data-testid="sessions-page-past"]'))
    await flush()
    click(q(r, '[data-testid="sessions-page-templates"]'))
    await flush()
    expect(q(r, '[data-testid="template-name"]')).toBeNull()
    expect(q(r, '[data-testid="template-placeholder"]')).not.toBeNull()
  })

  it('a page switch keeps the scope', async () => {
    const r = render('templates')
    expect(selectedValue(r.container, 'template-scope-filter')).toBe('ws:w1')
    chooseOption(r.container, 'template-scope-filter', 'ws:default')
    click(q(r, '[data-testid="sessions-page-past"]'))
    await flush()
    expect(selectedValue(r.container, 'past-session-scope-filter')).toBe('ws:default')
  })

  it('Global on Templates falls back to All on Past (Past offers no Global)', async () => {
    const r = render('templates')
    chooseOption(r.container, 'template-scope-filter', 'global')
    click(q(r, '[data-testid="sessions-page-past"]'))
    await flush()
    expect(selectedValue(r.container, 'past-session-scope-filter')).toBe('all')
  })

  it('the fallback is kept: back on Templates the scope reads All, not Global', async () => {
    const r = render('templates')
    chooseOption(r.container, 'template-scope-filter', 'global')
    click(q(r, '[data-testid="sessions-page-past"]'))
    await flush()
    click(q(r, '[data-testid="sessions-page-templates"]'))
    await flush()
    expect(selectedValue(r.container, 'template-scope-filter')).toBe('all')
  })
})

describe('a late Active-page exit (final review 1)', () => {
  afterEach(() => act(() => boardStore.setState({ sessionsById: {}, terminalIdBySessionId: {} })))

  it('never writes into the page open now, and never closes its form', async () => {
    const held = deferred<void>()
    ;(window as unknown as { launch: unknown }).launch = {
      archiveSession: vi.fn(() => held.promise),
      deleteSession: vi.fn()
    }
    act(() =>
      boardStore.setState({
        sessionsById: {
          b: {
            id: 'b',
            sessionName: 'name-b',
            projectPath: '/home/op/b',
            status: 'x',
            pid: 1,
            column: 'idle',
            enteredColumnAt: 0,
            workspaceId: 'w1',
            tagIds: []
          }
        },
        terminalIdBySessionId: { b: 'tb' },
        launchedTerminals: {},
        selectedId: null
      })
    )
    const r = render('active')
    click(q(r, '[data-testid="active-session-select-b"]'))
    click(q(r, '[data-testid="active-session-archive"]'))
    click(q(r, '[data-testid="sessions-page-templates"]'))
    await flush()
    click(q(r, '[data-template-id="t1"]'))
    expect(q(r, '[data-testid="template-name"]')).not.toBeNull()
    await act(async () => {
      held.resolve()
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    expect(q(r, '[data-testid="template-name"]')).not.toBeNull()
    expect(q(r, '[data-testid="sessions-success"]')).toBeNull()
  })
})

describe('where the dropdown opens (owner 2026-10-12)', () => {
  it('a SESSION page opens on the active workspace, like Templates', async () => {
    for (const [page, id] of [
      ['active', 'active-session-scope-filter'],
      ['past', 'past-session-scope-filter']
    ] as const) {
      const r = render(page)
      await flush()
      expect(selectedValue(r.container, id)).toBe('ws:w1')
      r.unmount()
      cleanup = undefined
    }
  })

  it('Templates opens on the active workspace', () => {
    const r = render('templates')
    expect(selectedValue(r.container, 'template-scope-filter')).toBe('ws:w1')
  })
})
