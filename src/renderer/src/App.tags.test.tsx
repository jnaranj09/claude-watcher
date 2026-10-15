// Tags — App-level wiring (spec §4.3, §4.4): the header ☰ menu's Tags submenu opens the Tags dialog
// under the single-modal rule (UX-DR14), Escape closes it, and the quit guard closes it. FAKE window
// bridges, the real App — the shared App harness (test/appHarness.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import type { RenderResult } from './test/renderComponent'
import { renderApp, resetBoardView, stubAppBridges, unmountApp } from './test/appHarness'
import { boardStore } from './stores/boardStore'
import { tagsStore } from './stores/tagsStore'
import type { QuitGuardPayload, Tag, WatchEventsPayload } from '../../shared/ipc/contract'

const DEPLOY: Tag = { id: 't-deploy', name: 'deploy', color: 'amber', workspaceId: null }

/** An untagged card in the Default workspace (the one a fresh workspacesStore is active on). */
function untaggedCard(id: string): WatchEventsPayload {
  return {
    epoch: 0,
    event: {
      type: 'session.updated',
      id,
      sessionName: 'card',
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

let guardShow: ((payload: QuitGuardPayload) => void) | undefined

beforeEach(() => {
  resetBoardView()
  stubAppBridges({
    tags: { list: vi.fn(() => Promise.resolve([DEPLOY])) },
    rules: {},
    quit: {
      onGuardShow: vi.fn((cb: (payload: QuitGuardPayload) => void) => {
        guardShow = cb
        return () => {
          guardShow = undefined
        }
      })
    }
  })
})

afterEach(() => {
  unmountApp()
  act(() => tagsStore.setState({ tags: [], loaded: false, activeTagId: null }))
  vi.restoreAllMocks()
})

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

const click = (el: Element): void => act(() => (el as HTMLElement).click())

/** The header ☰ menu → its Tags submenu → one of the submenu's rows. */
function chooseFromTagsSubmenu(r: RenderResult, row: 'manage-tags' | 'manage-rules'): void {
  click(q(r, '[data-testid="app-menu"]'))
  click(q(r, '[data-testid="app-menu-tags"]'))
  click(q(r, `[data-testid="tags-menu-${row}"]`))
}

function openManageTags(r: RenderResult): void {
  chooseFromTagsSubmenu(r, 'manage-tags')
}

describe('App — tags', () => {
  it('loads the tags on mount; the board filter bar lists them', async () => {
    const r = await renderApp()
    act(() => boardStore.getState().applyWatchEvent(untaggedCard('s1')))
    click(q(r, '[data-testid="filter-toggle"]'))
    click(q(r, '[data-testid="filter-add"]'))
    expect(r.container.querySelector('[data-testid="filter-tag-row-t-deploy"]')).not.toBeNull()
  })

  it('the header filters nothing: the filter bar lives in the board', async () => {
    const r = await renderApp()
    act(() => boardStore.getState().applyWatchEvent(untaggedCard('s1')))
    const header = q(r, '[data-testid="app-header"]')
    expect(header.querySelector('[data-testid="filter-bar"]')).toBeNull()
    expect(q(r, '[data-testid="board-layer"] [data-testid="filter-bar"]')).toBeTruthy()
  })

  it('Manage tags… opens the Tags dialog; Escape closes it', async () => {
    const r = await renderApp()
    openManageTags(r)
    expect(r.container.querySelector('[data-testid="tags-overlay"]')).not.toBeNull()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(r.container.querySelector('[data-testid="tags-overlay"]')).toBeNull()
  })

  // jsdom ignores `inert`, so the click DOES reach the button while the Templates dialog is open —
  // which is exactly what makes this test able to fail: `handleManageTags` itself must refuse.
  // Reverting its `isModalOpen()` guard turns this red.
  it('the single-modal rule: Manage tags… does nothing while another dialog is open', async () => {
    const r = await renderApp()
    act(() => boardStore.getState().openSessionsDialog('templates'))
    openManageTags(r)
    expect(boardStore.getState().tagsDialog).toBeNull()
  })

  it('the quit guard closes the Tags dialog (never two modals stacked)', async () => {
    const r = await renderApp()
    openManageTags(r)
    expect(boardStore.getState().tagsDialog).toBe('tags')
    act(() => guardShow?.({ total: 1, workingCount: 0, sessions: [] }))
    expect(boardStore.getState().tagsDialog).toBeNull()
  })

  it('with no tags yet, a card tags button opens the Tags dialog', async () => {
    ;(window as unknown as { tags: { list: () => Promise<Tag[]> } }).tags.list = vi.fn(() =>
      Promise.resolve([])
    )
    const r = await renderApp()
    act(() => boardStore.getState().applyWatchEvent(untaggedCard('s1')))
    click(q(r, '[data-session-id="s1"] [data-testid="card-tags-button"]'))
    expect(r.container.querySelector('[data-testid="tags-overlay"]')).not.toBeNull()
  })

  it('Manage rules… opens the Tags dialog on Rules under the single-modal rule; Escape closes it', async () => {
    const r = await renderApp()
    chooseFromTagsSubmenu(r, 'manage-rules')
    expect(r.container.querySelector('[data-testid="tags-overlay"]')).not.toBeNull()
    expect(
      r.container.querySelector('[data-testid="tags-page-rules"]')?.getAttribute('aria-current')
    ).toBe('page')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(r.container.querySelector('[data-testid="tags-overlay"]')).toBeNull()
    act(() => boardStore.getState().openTagsDialog('tags'))
    chooseFromTagsSubmenu(r, 'manage-rules')
    // The opener refused: the open dialog stays on Tags.
    expect(boardStore.getState().tagsDialog).toBe('tags')
  })
})
