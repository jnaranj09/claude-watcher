// Memory — the Episodes page (addendum D30, PICK look 4): what each session did, read-only. A row
// per episode with no pin and no `+ New`; the right column shows the episode with `Mark stale` /
// `Mark active`, `Past sessions` while its record is listed, and `Delete` only (no `Save`). The real
// dialog runs; `window.memory` and `window.pastSessions` stand in for main.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { flush } from '../../test/renderComponent'
import { MemoryDialog } from './MemoryDialog'
import { workspacesStore } from '../../stores/workspacesStore'
import { settingsStore } from '../../stores/settingsStore'
import { boardStore } from '../../stores/boardStore'
import { pastSessionsStore } from '../../stores/pastSessionsStore'
import { toastStore } from '../../stores/toastStore'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import { dialogToast } from '../../test/toasts'
import type { PastSession } from '../../../../shared/ipc/contract'
import {
  MEMORY_NOW,
  episodeItem,
  installMemoryBridge,
  specificItem,
  type MemoryBridge
} from '../../test/memoryBridge'

let bridge: MemoryBridge
let unmount: (() => void) | undefined
let onClose: Mock<() => void>

const RECORD: PastSession = {
  id: 's-1',
  name: 'fix-health-check',
  cwd: '/srv/acme/api',
  workspaceId: 'w1',
  tagIds: [],
  launchedAt: MEMORY_NOW - 2 * 86_400_000,
  endedAt: MEMORY_NOW - 86_400_000
}

function installPastSessions(records: PastSession[]): void {
  ;(window as unknown as { pastSessions: unknown }).pastSessions = {
    list: vi.fn(() => Promise.resolve(records))
  }
}

beforeEach(() => {
  act(() => {
    workspacesStore.setState({
      workspaces: [
        { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
        { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
      ],
      activeId: 'w1',
      loaded: true
    })
    settingsStore.getState().applyPatch({ includeGlobal: true, memoryEnabled: true })
  })
  installPastSessions([])
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  act(() => {
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
    pastSessionsStore.setState({ sessions: [], loaded: false })
    boardStore.getState().closeSessionsDialog()
    toastStore.setState({ toasts: [] })
  })
  vi.restoreAllMocks()
})

async function openEpisodes(): Promise<void> {
  onClose = vi.fn()
  const r = render(<MemoryDialog onClose={onClose} now={() => MEMORY_NOW} />)
  unmount = r.unmount
  await flush(4)
  await userEvent.click(screen.getByRole('button', { name: 'Episodes' }))
  await flush(4)
}

async function openEpisode(): Promise<HTMLElement> {
  await openEpisodes()
  await userEvent.click(screen.getByRole('button', { name: /^Fixed the health check/ }))
  return screen.findByTestId('memory-episode')
}

describe('MemoryDialog — Episodes', () => {
  it('the Episodes page lists episodes, offers no + New, and shows one read-only with no Save', async () => {
    bridge = installMemoryBridge([specificItem(), episodeItem()])
    await openEpisodes()
    expect(bridge.list).toHaveBeenCalledWith(expect.objectContaining({ kind: 'episode' }))
    expect(screen.getByRole('button', { name: /^Fixed the health check/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^API port/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ New' })).not.toBeInTheDocument()
    expect(screen.getByText('Select an episode on the left.')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: /^Fixed the health check/ }))
    const pane = await screen.findByTestId('memory-episode')
    expect(within(pane).getByTestId('memory-episode-title')).toHaveTextContent(
      'Fixed the health check'
    )
    expect(within(pane).getByTestId('memory-episode-body')).toHaveTextContent(
      'Moved the probe to /healthz.\nThe deploy passed.',
      { normalizeWhitespace: false }
    )
    expect(within(pane).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(pane).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(within(pane).queryByRole('button', { name: 'History' })).not.toBeInTheDocument()
    expect(within(pane).getByText('Ended')).toBeVisible()
    expect(within(pane).getByTestId('memory-form-origin')).toHaveTextContent('fix-health-check')
    expect(within(pane).getByTestId('memory-form-folder')).toHaveTextContent('/srv/acme/api')
    expect(within(pane).getByTestId('memory-form-workspace')).toHaveTextContent('Ops')
    expect(within(pane).getByRole('button', { name: 'Delete' })).toBeVisible()
  })

  it('an episode row has no pin', async () => {
    bridge = installMemoryBridge([episodeItem()])
    await openEpisodes()
    expect(screen.queryByRole('button', { name: /^Pin / })).not.toBeInTheDocument()
    expect(screen.queryByTestId('memory-pin-e1')).not.toBeInTheDocument()
  })

  it('an empty Episodes page says a session leaves one when it ends', async () => {
    bridge = installMemoryBridge([specificItem()])
    await openEpisodes()
    expect(screen.getByTestId('memory-empty')).toHaveTextContent(
      'No episodes yet. A session leaves one when it ends.'
    )
  })

  it('an episode from a deleted session says so beside its origin session', async () => {
    bridge = installMemoryBridge([episodeItem({ originDeletedAt: MEMORY_NOW - 1000 })])
    const pane = await openEpisode()
    expect(within(pane).getByTestId('memory-form-origin')).toHaveTextContent('Session deleted')
  })

  it('Mark stale on an episode calls setState and Delete needs the second press', async () => {
    bridge = installMemoryBridge([episodeItem()])
    const pane = await openEpisode()
    await userEvent.click(within(pane).getByRole('button', { name: 'Mark stale' }))
    expect(bridge.setState).toHaveBeenCalledWith('e1', 'stale')
    expect(await within(pane).findByRole('status')).toHaveTextContent('✓ Saved')

    await userEvent.click(within(pane).getByRole('button', { name: 'Delete' }))
    expect(bridge.remove).not.toHaveBeenCalled()
    await userEvent.click(within(pane).getByRole('button', { name: 'Confirm delete' }))
    expect(bridge.remove).toHaveBeenCalledWith('e1')
    await flush(4)
    expect(dialogToast('memory')).toMatchObject({ kind: 'success', title: 'Memory deleted.' })
    expect(screen.getByText('Select an episode on the left.')).toBeVisible()
  })

  it('a stale episode offers Mark active', async () => {
    bridge = installMemoryBridge([episodeItem({ state: 'stale' })])
    await openEpisodes()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show stale' }))
    await flush(4)
    await userEvent.click(screen.getByRole('button', { name: /^Fixed the health check/ }))
    const pane = await screen.findByTestId('memory-episode')
    await userEvent.click(within(pane).getByRole('button', { name: 'Mark active' }))
    expect(bridge.setState).toHaveBeenCalledWith('e1', 'active')
  })

  it('a refused episode delete shows the store-write copy and keeps the episode', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    bridge = installMemoryBridge([episodeItem()])
    bridge.remove.mockRejectedValue(
      new Error("Error invoking remote method 'memory:delete': Error: store_write_failed")
    )
    const pane = await openEpisode()
    await userEvent.click(within(pane).getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(pane).getByRole('button', { name: 'Confirm delete' }))
    await flush(4)
    expect(dialogToast('memory')).toMatchObject({ kind: 'error', title: STORE_WRITE_FAILED_COPY })
    expect(screen.getByTestId('memory-episode')).toBeVisible()
  })

  it('Past sessions shows only while the record is listed, and opens the Sessions dialog on Past with it selected', async () => {
    bridge = installMemoryBridge([
      episodeItem(),
      episodeItem({
        id: 'e2',
        title: 'Tidied the readme',
        origin: { by: 'extract', sessionId: 's-gone' }
      })
    ])
    installPastSessions([RECORD])
    await openEpisodes()
    await userEvent.click(screen.getByRole('button', { name: /^Tidied the readme/ }))
    const other = await screen.findByTestId('memory-episode')
    await flush(4)
    expect(within(other).queryByRole('button', { name: 'Past sessions' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Fixed the health check/ }))
    const past = await screen.findByRole('button', { name: 'Past sessions' })
    await userEvent.click(past)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(boardStore.getState().sessionsDialog).toBe('past')
    expect(boardStore.getState().pastSessionTarget).toBe('s-1')
  })

  it('hostile saved text renders as text, line breaks kept', async () => {
    const body = `<img src=x onerror="alert(1)">\n${'x'.repeat(2000)}`
    bridge = installMemoryBridge([episodeItem({ title: '<b>bold</b>', body })])
    await openEpisodes()
    await userEvent.click(screen.getByRole('button', { name: /^<b>bold<\/b>/ }))
    const pane = await screen.findByTestId('memory-episode')
    expect(within(pane).getByTestId('memory-episode-title')).toHaveTextContent('<b>bold</b>')
    expect(within(pane).getByTestId('memory-episode-body')).toHaveTextContent(body, {
      normalizeWhitespace: false
    })
    expect(within(pane).queryByRole('img')).not.toBeInTheDocument()
  })

  it('a javascript: URL, a right-to-left override and 200 lines render as text, never a link', async () => {
    const title = 'javascript:alert(1) \u202Etxt.exe'
    const body = Array.from({ length: 200 }, (_, i) => `javascript:void(${i}) \u202Eline`).join(
      '\n'
    )
    bridge = installMemoryBridge([episodeItem({ title, body })])
    await openEpisodes()
    await userEvent.click(screen.getByRole('button', { name: /^javascript:alert\(1\)/ }))
    const pane = await screen.findByTestId('memory-episode')
    expect(within(pane).getByTestId('memory-episode-title')).toHaveTextContent(title)
    expect(within(pane).getByTestId('memory-episode-body')).toHaveTextContent(body, {
      normalizeWhitespace: false
    })
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})
