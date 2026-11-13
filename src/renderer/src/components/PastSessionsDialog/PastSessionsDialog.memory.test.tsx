// Past sessions — the record form's `Memory:` line (memory phase 2) and, with an episode, its
// title and body read from memory. jsdom `unit`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionsDialog } from '../SessionsDialog/SessionsDialog'
import { pastSessionsStore } from '../../stores/pastSessionsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { tagsStore } from '../../stores/tagsStore'
import { toastStore } from '../../stores/toastStore'
import { cssRule } from '../../test/cssRule'
import { episodeItem, factItem, installMemoryBridge } from '../../test/memoryBridge'
import type { MemoryGetResult } from '../../../../shared/ipc/contract'
import type { PastSession, Workspace } from '../../../../shared/ipc/contract'

/** The element's whole text, exactly (toHaveTextContent alone matches a part). */
const whole = (text: string): RegExp =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

const WS: Workspace[] = [{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }]
const SAVED: PastSession = {
  id: 'sa',
  name: 'fix health check',
  cwd: '/srv/acme/api',
  workspaceId: 'w1',
  tagIds: [],
  launchedAt: 1_000,
  endedAt: 5_000,
  memory: { state: 'saved', specifics: 4, facts: 1, tasks: 2, episodes: 1, episodeId: 'e1' }
}
const OLD: PastSession = {
  id: 'sb',
  name: 'older record',
  cwd: '/srv/acme/web',
  workspaceId: 'w1',
  tagIds: [],
  launchedAt: 2_000,
  endedAt: 9_000
}
const FAILED: PastSession = {
  ...OLD,
  id: 'sc',
  name: 'failed save',
  memory: { state: 'failed', specifics: 0, facts: 0, tasks: 0, episodes: 0, episodeId: null }
}
// A record whose episode id names an item that is not an episode (a fact).
const NOT_EPISODE: PastSession = {
  ...OLD,
  id: 'sd',
  name: 'points at a fact',
  memory: { state: 'saved', specifics: 0, facts: 1, tasks: 0, episodes: 1, episodeId: 'f1' }
}

beforeEach(() => {
  ;(window as unknown as { pastSessions: unknown }).pastSessions = {
    list: vi.fn(() => Promise.resolve([OLD, SAVED, FAILED, NOT_EPISODE])),
    forget: vi.fn(),
    open: vi.fn()
  }
  act(() => {
    workspacesStore.setState({ workspaces: WS, activeId: 'w1', loaded: true })
    tagsStore.setState({ tags: [], loaded: true })
    pastSessionsStore.setState({ sessions: [], loaded: false })
  })
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  act(() => {
    pastSessionsStore.setState({ sessions: [], loaded: false })
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
    toastStore.setState({ toasts: [] })
  })
  delete (window as unknown as { memory?: unknown }).memory
  vi.restoreAllMocks()
})

let unmount: (() => void) | undefined

async function openRecord(id: string): Promise<HTMLElement> {
  unmount = render(
    <SessionsDialog page="past" onPageChange={() => {}} onClose={() => {}} />
  ).unmount
  await userEvent.click(await screen.findByTestId(`past-session-select-${id}`))
  return screen.getByTestId('past-session-form')
}

describe('Past sessions — the Memory line', () => {
  it('a record with an episode shows its title and body, and only the line when the item is gone', async () => {
    const bridge = installMemoryBridge([
      episodeItem({ title: 'Fixed the health check', body: 'Moved the probe.\nThe deploy passed.' })
    ])
    const form = await openRecord('sa')
    expect(within(form).getByText('Memory: 4 specifics, 1 fact, 2 tasks, 1 episode')).toBeVisible()
    expect(await within(form).findByTestId('past-session-form-episode-title')).toHaveTextContent(
      'Fixed the health check'
    )
    expect(within(form).getByTestId('past-session-form-episode-body')).toHaveTextContent(
      'Moved the probe.\nThe deploy passed.',
      { normalizeWhitespace: false }
    )
    expect(bridge.get).toHaveBeenCalledWith('e1')

    // The item is gone: the line stays, no episode, and nothing is toasted.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    bridge.items = []
    await userEvent.click(screen.getByTestId('past-session-select-sb'))
    await userEvent.click(screen.getByTestId('past-session-select-sa'))
    const again = screen.getByTestId('past-session-form')
    expect(within(again).getByText('Memory: 4 specifics, 1 fact, 2 tasks, 1 episode')).toBeVisible()
    await act(async () => {
      await Promise.resolve()
    })
    expect(within(again).queryByTestId('past-session-form-episode-title')).not.toBeInTheDocument()
    expect(within(again).queryByTestId('past-session-form-episode-body')).not.toBeInTheDocument()
    expect(toastStore.getState().toasts).toEqual([])
  })

  it('a record from before the field shows no Memory line and reads nothing from memory', async () => {
    const bridge = installMemoryBridge([episodeItem()])
    const form = await openRecord('sb')
    expect(within(form).queryByText(/^Memory:/)).not.toBeInTheDocument()
    expect(within(form).queryByText(/undefined/)).not.toBeInTheDocument()
    expect(bridge.get).not.toHaveBeenCalled()
  })

  it('saved text is shown as text: angle brackets and a 2,000-character body stay plain', async () => {
    const body = `<b>bold</b>\n${'x'.repeat(2000)}`
    installMemoryBridge([episodeItem({ title: '<img src=x onerror=alert(1)>', body })])
    const form = await openRecord('sa')
    const title = await within(form).findByTestId('past-session-form-episode-title')
    expect(title).toHaveTextContent(whole('<img src=x onerror=alert(1)>'))
    expect(within(title).queryByRole('img')).not.toBeInTheDocument()
    expect(within(form).getByTestId('past-session-form-episode-body')).toHaveTextContent(body, {
      normalizeWhitespace: false
    })
  })

  it('the episode body wraps in full, keeps its line breaks and breaks a long word', () => {
    const rule = cssRule(
      'components/PastSessionsDialog/PastSessionsDialog.module.css',
      '.episodeBody'
    )
    expect(rule).toMatch(/white-space:\s*pre-wrap/)
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
    expect(rule).toMatch(/color:\s*var\(--text-secondary\)/)
  })

  it("a record with no episode never shows the previous record's, in either order", async () => {
    installMemoryBridge([episodeItem({ title: 'Episode of A', body: 'A body' })])
    await openRecord('sa')
    expect(await screen.findByText('Episode of A')).toBeVisible()
    await userEvent.click(screen.getByTestId('past-session-select-sc'))
    const b = screen.getByTestId('past-session-form')
    expect(within(b).getByText('Memory: failed')).toBeVisible()
    expect(within(b).queryByText('Episode of A')).not.toBeInTheDocument()
    expect(within(b).queryByTestId('past-session-form-episode-title')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('past-session-select-sa'))
    expect(await screen.findByText('Episode of A')).toBeVisible()
  })

  it('a slow episode read for one record that lands after another was opened is not shown', async () => {
    const bridge = installMemoryBridge([episodeItem({ title: 'Episode of A', body: 'A body' })])
    let land: (answer: MemoryGetResult) => void = () => {}
    const answer = await bridge.get('e1')
    bridge.get.mockImplementationOnce(
      () =>
        new Promise<MemoryGetResult>((resolve) => {
          land = resolve
        })
    )
    await openRecord('sa')
    await userEvent.click(screen.getByTestId('past-session-select-sc'))
    await act(async () => {
      land(answer)
      await Promise.resolve()
    })
    const b = screen.getByTestId('past-session-form')
    expect(within(b).getByText('Memory: failed')).toBeVisible()
    expect(within(b).queryByText('Episode of A')).not.toBeInTheDocument()
  })

  it('an episode id that names another kind of item shows the line only', async () => {
    const bridge = installMemoryBridge([factItem({ id: 'f1', title: 'A fact', body: 'Fact body' })])
    const form = await openRecord('sd')
    expect(within(form).getByText('Memory: 1 fact, 1 episode')).toBeVisible()
    await act(async () => {
      await Promise.resolve()
    })
    expect(bridge.get).toHaveBeenCalledWith('f1')
    expect(within(form).queryByText('A fact')).not.toBeInTheDocument()
    expect(within(form).queryByTestId('past-session-form-episode-title')).not.toBeInTheDocument()
  })

  it('a record whose episode changes while shown never paints the older read over the newer', async () => {
    const bridge = installMemoryBridge([
      episodeItem({ title: 'Older episode', body: 'old' }),
      episodeItem({ id: 'e2', title: 'Newer episode', body: 'new' })
    ])
    let land: (answer: MemoryGetResult) => void = () => {}
    const older = await bridge.get('e1')
    bridge.get.mockImplementationOnce(
      () =>
        new Promise<MemoryGetResult>((resolve) => {
          land = resolve
        })
    )
    await openRecord('sa')
    // A later save of the same session names another episode while the form is open.
    act(() =>
      pastSessionsStore.setState({
        sessions: pastSessionsStore
          .getState()
          .sessions.map((r) =>
            r.id === 'sa' && r.memory !== undefined
              ? { ...r, memory: { ...r.memory, episodeId: 'e2' } }
              : r
          )
      })
    )
    expect(await screen.findByText('Newer episode')).toBeVisible()
    await act(async () => {
      land(older)
      await Promise.resolve()
    })
    expect(screen.getByText('Newer episode')).toBeVisible()
    expect(screen.queryByText('Older episode')).not.toBeInTheDocument()
  })

  it('an episode shown for a record goes when a later save of it names none', async () => {
    installMemoryBridge([episodeItem({ title: 'Earlier episode', body: 'old' })])
    await openRecord('sa')
    expect(await screen.findByText('Earlier episode')).toBeVisible()
    act(() =>
      pastSessionsStore.setState({
        sessions: pastSessionsStore.getState().sessions.map((r) =>
          r.id === 'sa'
            ? {
                ...r,
                memory: {
                  state: 'saving',
                  specifics: 0,
                  facts: 0,
                  tasks: 0,
                  episodes: 0,
                  episodeId: null
                }
              }
            : r
        )
      })
    )
    const form = screen.getByTestId('past-session-form')
    expect(within(form).getByText('Memory: saving…')).toBeVisible()
    expect(within(form).queryByText('Earlier episode')).not.toBeInTheDocument()
  })
})
