// Action feedback (spec 2026-09-29 §2.5) — the Past sessions rail says Loading… while the history
// is fetched; a failed load keeps the error line and offers Retry in the rail foot.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { deferred } from '../../test/deferred'
import { SessionsDialog } from '../SessionsDialog/SessionsDialog'
import { pastSessionsStore } from '../../stores/pastSessionsStore'
import { tagsStore } from '../../stores/tagsStore'
import { workspacesStore } from '../../stores/workspacesStore'

const ROW = {
  id: 's1',
  name: 'billing api',
  cwd: '/c',
  workspaceId: 'default',
  tagIds: [],
  launchedAt: 1,
  endedAt: 2
}

let r: RenderResult | undefined
let list: ReturnType<typeof vi.fn>

beforeEach(() => {
  list = vi.fn()
  ;(window as unknown as { pastSessions: unknown }).pastSessions = { list }
  act(() => {
    pastSessionsStore.setState({ sessions: [], loaded: false })
    tagsStore.setState({ tags: [], loaded: true, activeTagId: null })
    workspacesStore.setState({
      workspaces: [{ id: 'default', name: 'Default', color: 'slate', defaultCwd: null }],
      activeId: 'default',
      loaded: true
    })
  })
})
afterEach(() => {
  r?.unmount()
  r = undefined
  vi.restoreAllMocks()
})

const find = (id: string): Element | null =>
  r?.container.querySelector(`[data-testid="${id}"]`) ?? null

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve()
  })
}

describe('PastSessionsDialog — Loading… and Retry', () => {
  it('says Loading… while the history is fetched, then lists it', async () => {
    const d = deferred<unknown>()
    list.mockImplementation(() => d.promise)
    r = renderComponent(<SessionsDialog page="past" onPageChange={() => {}} onClose={() => {}} />)
    expect(find('past-sessions-loading')?.textContent).toBe('Loading…')
    d.resolve([ROW])
    await settle()
    expect(find('past-sessions-loading')).toBeNull()
    expect(r.container.querySelectorAll('[data-testid="past-session-row"]')).toHaveLength(1)
  })

  it('a failed load keeps the error line and offers Retry, which loads again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    list.mockImplementationOnce(() => Promise.reject(new Error('x')))
    r = renderComponent(<SessionsDialog page="past" onPageChange={() => {}} onClose={() => {}} />)
    await settle()
    expect(find('past-session-error')?.textContent).toBe('Could not load past sessions')
    expect(find('past-sessions-loading')).toBeNull()
    // Retry is the bottom slot's first action, above Resume by id (spec 2026-10-02).
    expect(
      r.container.querySelector('[data-manage-list-bottom] [data-testid="past-sessions-retry"]')
    ).toBeTruthy()
    list.mockImplementationOnce(() => Promise.resolve([ROW]))
    act(() => (find('past-sessions-retry') as HTMLButtonElement).click())
    await settle()
    expect(list).toHaveBeenCalledTimes(2)
    expect(find('past-session-error')).toBeNull()
    expect(find('past-sessions-retry')).toBeNull()
    expect(r.container.querySelectorAll('[data-testid="past-session-row"]')).toHaveLength(1)
  })

  it('a reopen with cached rows refetches without saying Loading…', async () => {
    act(() => pastSessionsStore.setState({ sessions: [ROW], loaded: true }))
    const d = deferred<unknown>()
    list.mockImplementation(() => d.promise)
    r = renderComponent(<SessionsDialog page="past" onPageChange={() => {}} onClose={() => {}} />)
    expect(find('past-sessions-loading')).toBeNull()
    expect(r.container.querySelectorAll('[data-testid="past-session-row"]')).toHaveLength(1)
    expect(list).toHaveBeenCalledTimes(1)
    d.resolve([ROW])
    await settle()
  })
})
