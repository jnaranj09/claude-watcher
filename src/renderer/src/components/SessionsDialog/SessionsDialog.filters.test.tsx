// The Sessions dialog keeps Active's and Past's rail filters (spec 2026-10-16 §3): "remembered per
// scope while the dialog stays open, cleared when it closes". The dialog holds them, so a page
// switch, which unmounts the page, keeps them. jsdom `unit`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, useState, type JSX } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionsDialog } from './SessionsDialog'
import { boardStore, type BoardSession, type SessionsPage } from '../../stores/boardStore'
import { pastSessionsStore } from '../../stores/pastSessionsStore'
import { tagsStore } from '../../stores/tagsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import type { Workspace } from '../../../../shared/ipc/contract'

const WS: Workspace[] = [{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }]
const live = (id: string): BoardSession => ({
  id,
  sessionName: `name-${id}`,
  projectPath: `/home/op/${id}`,
  status: 'x',
  pid: 1,
  column: 'idle',
  enteredColumnAt: 0,
  workspaceId: 'w1',
  tagIds: []
})

// No RTL auto-cleanup in this project (test/setup.ts): unmount what each test rendered.
let unmount: (() => void) | undefined
beforeEach(() => {
  ;(window as unknown as { pastSessions: unknown }).pastSessions = {
    list: vi.fn(() => Promise.resolve([])),
    forget: vi.fn(),
    open: vi.fn(),
    resumeById: vi.fn()
  }
  act(() => {
    workspacesStore.setState({ workspaces: WS, activeId: 'w1', loaded: true })
    tagsStore.setState({ tags: [], loaded: true })
    pastSessionsStore.setState({ sessions: [], loaded: true })
    boardStore.setState({
      sessionsById: { a: live('a'), b: live('b') },
      terminalIdBySessionId: { a: 'ta', b: 'tb' },
      launchedTerminals: {},
      selectedId: null
    })
  })
})
afterEach(() => {
  unmount?.()
  unmount = undefined
  act(() => boardStore.setState({ sessionsById: {}, terminalIdBySessionId: {} }))
})

function Harness(): JSX.Element {
  const [page, setPage] = useState<SessionsPage>('active')
  return <SessionsDialog page={page} onPageChange={setPage} onClose={() => {}} />
}
function open(): void {
  ;({ unmount } = render(<Harness />))
}
const names = (): string[] =>
  screen.queryAllByTestId('active-session-name').map((e) => e.textContent ?? '')

describe('SessionsDialog — the rail filters across pages', () => {
  it("Active's filter survives a trip to Past and back", async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.click(screen.getByTestId('active-filter-add'))
    await userEvent.click(screen.getByTestId('active-filter-type-folder'))
    await userEvent.click(screen.getByTestId('active-filter-folder-row-/home/op/a'))
    expect(names()).toEqual(['name-a'])

    await userEvent.click(screen.getByTestId('sessions-page-past'))
    expect(screen.getByTestId('past-session-search')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('sessions-page-active'))
    expect(screen.getByRole('button', { name: 'Filter, 1 on' })).toBeInTheDocument()
    expect(names()).toEqual(['name-a'])
  })

  it('closing the dialog drops the filters: a reopen starts with none', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.click(screen.getByTestId('active-filter-add'))
    await userEvent.click(screen.getByTestId('active-filter-type-folder'))
    await userEvent.click(screen.getByTestId('active-filter-folder-row-/home/op/a'))
    unmount?.()
    open()
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
    expect(names()).toEqual(['name-a', 'name-b'])
  })
})
