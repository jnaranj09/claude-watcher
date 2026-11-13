// Memory — the Commands page (addendum "UI", PICK look 5): the commands that worked in a session,
// one workspace's, newest first. A row per command (the command in mono, its folder, its runs and
// last run, `Session deleted`); a search and the scope only; the right column shows the whole
// command and `Delete` → `Confirm delete`. The real dialog runs; `window.memory` stands in for main.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { flush } from '../../test/renderComponent'
import { MemoryDialog } from './MemoryDialog'
import { workspacesStore } from '../../stores/workspacesStore'
import { settingsStore } from '../../stores/settingsStore'
import { toastStore } from '../../stores/toastStore'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import { dialogToast } from '../../test/toasts'
import {
  MEMORY_NOW,
  commandRow,
  installMemoryBridge,
  type MemoryBridge
} from '../../test/memoryBridge'

let bridge: MemoryBridge
let unmount: (() => void) | undefined

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
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  act(() => {
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
    toastStore.setState({ toasts: [] })
  })
  vi.restoreAllMocks()
})

async function openCommands(): Promise<void> {
  const r = render(<MemoryDialog onClose={vi.fn()} now={() => MEMORY_NOW} />)
  unmount = r.unmount
  await flush(4)
  await userEvent.click(screen.getByRole('button', { name: 'Commands' }))
  await flush(4)
}

const row = (text: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`^${text}`) })

const TWO = [
  commandRow(),
  commandRow({
    id: 'c2',
    text: 'make test',
    folder: '/srv/acme/web',
    count: 1,
    lastAt: MEMORY_NOW - 2 * 86_400_000,
    sessionDeletedAt: MEMORY_NOW - 1000
  })
]

describe('MemoryDialog — Commands', () => {
  it('the Commands page lists commands with their runs and deletes one after the second press', async () => {
    bridge = installMemoryBridge([], TWO)
    await openCommands()
    expect(bridge.commands).toHaveBeenCalledWith({
      workspaceId: 'w1',
      query: null,
      offset: 0,
      limit: 100
    })
    expect(row('npm run build')).toHaveTextContent('api')
    expect(row('npm run build')).toHaveTextContent('3 runs · 7 h ago')
    expect(row('make test')).toHaveTextContent('1 run · 2 d ago')
    expect(within(row('make test')).getByText('Session deleted')).toBeVisible()
    expect(within(row('npm run build')).queryByText('Session deleted')).not.toBeInTheDocument()

    await userEvent.click(row('npm run build'))
    const pane = await screen.findByTestId('memory-command')
    expect(within(pane).getByTestId('memory-command-text')).toHaveTextContent('npm run build')
    expect(within(pane).getByText('Folder')).toBeVisible()
    expect(within(pane).getByText('/srv/acme/api')).toBeVisible()
    expect(within(pane).getByText('Last run')).toBeVisible()
    expect(within(pane).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()

    await userEvent.click(within(pane).getByRole('button', { name: 'Delete' }))
    expect(bridge.removeCommand).not.toHaveBeenCalled()
    await userEvent.click(within(pane).getByRole('button', { name: 'Confirm delete' }))
    expect(bridge.removeCommand).toHaveBeenCalledWith('c1')
    await flush(4)
    expect(dialogToast('memory')).toMatchObject({ kind: 'success', title: 'Command deleted.' })
    expect(screen.queryByRole('button', { name: /^npm run build/ })).not.toBeInTheDocument()
    expect(screen.getByText('Select a command on the left.')).toBeVisible()
  })

  it('a refused command delete shows the store-write copy', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    bridge = installMemoryBridge([], TWO)
    bridge.removeCommand.mockRejectedValue(
      new Error("Error invoking remote method 'memory:delete-command': Error: store_write_failed")
    )
    await openCommands()
    await userEvent.click(row('npm run build'))
    const pane = await screen.findByTestId('memory-command')
    await userEvent.click(within(pane).getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(pane).getByRole('button', { name: 'Confirm delete' }))
    await flush(4)
    expect(dialogToast('memory')).toMatchObject({ kind: 'error', title: STORE_WRITE_FAILED_COPY })
    // Main undid it: the command is still listed and still open.
    expect(row('npm run build')).toBeVisible()
    expect(screen.getByTestId('memory-command')).toBeVisible()
  })

  it('any other refused delete says Could not delete command., never the message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    bridge = installMemoryBridge([], TWO)
    bridge.removeCommand.mockRejectedValue(new Error('disk on fire at /home/x'))
    await openCommands()
    await userEvent.click(row('npm run build'))
    const pane = await screen.findByTestId('memory-command')
    await userEvent.click(within(pane).getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(pane).getByRole('button', { name: 'Confirm delete' }))
    await flush(4)
    expect(dialogToast('memory')).toMatchObject({
      kind: 'error',
      title: 'Could not delete command.'
    })
  })

  it('the search is named Search commands and asks main with the trimmed text', async () => {
    bridge = installMemoryBridge([], TWO)
    await openCommands()
    await userEvent.type(screen.getByRole('textbox', { name: 'Search commands' }), ' make ')
    await flush(4)
    expect(bridge.commands).toHaveBeenLastCalledWith({
      workspaceId: 'w1',
      query: 'make',
      offset: 0,
      limit: 100
    })
  })

  it('a search with no hit says No matches and keeps the search', async () => {
    bridge = installMemoryBridge([], TWO)
    await openCommands()
    bridge.commands.mockResolvedValue({ rows: [], total: 0 })
    await userEvent.type(screen.getByRole('textbox', { name: 'Search commands' }), 'zzz')
    await flush(4)
    expect(screen.getByTestId('memory-command-empty')).toHaveTextContent('No matches')
    expect(screen.getByRole('textbox', { name: 'Search commands' })).toBeVisible()
  })

  it('an empty scope says no commands yet and draws no search', async () => {
    bridge = installMemoryBridge([], [])
    await openCommands()
    expect(screen.getByTestId('memory-command-empty')).toHaveTextContent(
      'No commands yet. Commands that worked in a session are listed here.'
    )
    expect(screen.queryByRole('textbox', { name: 'Search commands' })).not.toBeInTheDocument()
  })

  it('a failed list is the dialog list error Callout, never the message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    bridge = installMemoryBridge([], TWO)
    bridge.commands.mockRejectedValue(
      new Error("Error invoking remote method 'memory:commands': Error: memory_read_failed")
    )
    await openCommands()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load memory.')
    expect(screen.queryByTestId('memory-command-empty')).not.toBeInTheDocument()
  })

  it('Show more asks for the next page of 100', async () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      commandRow({ id: `c${i}`, text: `echo ${i}` })
    )
    bridge = installMemoryBridge([], many)
    await openCommands()
    expect(screen.getAllByTestId('memory-command-row')).toHaveLength(100)
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
    await flush(4)
    expect(bridge.commands).toHaveBeenCalledWith(expect.objectContaining({ offset: 100 }))
    expect(screen.getAllByTestId('memory-command-row')).toHaveLength(150)
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  it('memory:changed lists the page again', async () => {
    bridge = installMemoryBridge([], TWO)
    let push: () => void = () => {}
    bridge.onChanged.mockImplementation((cb: () => void) => {
      push = cb
      return () => {}
    })
    await openCommands()
    bridge.commandRows = [commandRow({ id: 'c9', text: 'git status' })]
    act(() => push())
    await flush(4)
    expect(row('git status')).toBeVisible()
    expect(screen.queryByRole('button', { name: /^npm run build/ })).not.toBeInTheDocument()
  })

  it('the scope offers workspaces only, and Include global and Show stale are not drawn', async () => {
    bridge = installMemoryBridge([], TWO)
    await openCommands()
    expect(screen.getByTestId('memory-scope-filter')).toBeVisible()
    expect(screen.queryByRole('checkbox', { name: 'Include global' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Show stale' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ New' })).not.toBeInTheDocument()
  })

  it('a long command with angle brackets is shown whole, as text', async () => {
    const text = `echo "<script>x</script>" ${'y'.repeat(5000)}`
    bridge = installMemoryBridge([], [commandRow({ text })])
    await openCommands()
    await userEvent.click(screen.getByTestId('memory-command-select-c1'))
    const pane = await screen.findByTestId('memory-command')
    expect(within(pane).getByTestId('memory-command-text')).toHaveTextContent(text, {
      normalizeWhitespace: false
    })
  })
})
