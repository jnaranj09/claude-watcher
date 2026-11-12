// Memory — the dialog that lists what sessions saved (spec 2026-11-11 memory §8, mockup option B):
// pages Specifics and Facts, a row per item, the form, History, the empty page and memory off. The
// real dialog runs; only `window.memory` is a stand-in for main.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { flush } from '../../test/renderComponent'
import { MemoryDialog } from './MemoryDialog'
import { workspacesStore } from '../../stores/workspacesStore'
import { settingsStore } from '../../stores/settingsStore'
import {
  MEMORY_NOW,
  factItem,
  installMemoryBridge,
  specificItem,
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
    settingsStore.getState().applyPatch({ includeGlobal: true, memoryEnabled: true })
  })
  vi.restoreAllMocks()
})

async function open(): Promise<void> {
  const r = render(<MemoryDialog onClose={vi.fn()} now={() => MEMORY_NOW} />)
  unmount = r.unmount
  await flush(4)
}

const row = (name: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`^${name}`) })

describe('MemoryDialog — pages', () => {
  it('Specifics lists the specifics main returns, and Facts the facts', async () => {
    bridge = installMemoryBridge([specificItem(), factItem()])
    await open()
    expect(screen.getByRole('dialog', { name: 'Memory' })).toBeVisible()
    expect(row('API port')).toBeVisible()
    expect(bridge.list).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'specific', workspaceId: 'w1', includeGlobal: true })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Facts' }))
    expect(await screen.findByRole('button', { name: /^Migrations run first/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /API port/ })).not.toBeInTheDocument()
  })

  it('a row says its age and basis, and where it lives', async () => {
    bridge = installMemoryBridge([specificItem()])
    await open()
    expect(row('API port')).toHaveTextContent('2 d ago · observed')
    expect(within(row('API port')).getByTestId('scope-marker')).toHaveTextContent('Ops')
  })

  it('a row from a deleted session shows Session deleted', async () => {
    bridge = installMemoryBridge([specificItem({ originDeletedAt: MEMORY_NOW - 1000 })])
    await open()
    expect(within(row('API port')).getByText('Session deleted')).toBeVisible()
  })

  it('a stale row shows Stale', async () => {
    bridge = installMemoryBridge([specificItem({ state: 'stale' })])
    await open()
    expect(within(row('API port')).getByText('Stale')).toBeVisible()
  })

  it('opens on the placeholder', async () => {
    bridge = installMemoryBridge([specificItem()])
    await open()
    expect(screen.getByText('Select an item on the left, or create a new one.')).toBeVisible()
  })
})

describe('MemoryDialog — empty, failed and off', () => {
  it('an empty page says nothing is saved yet', async () => {
    bridge = installMemoryBridge([])
    await open()
    expect(screen.getByText('Nothing saved yet. Memory fills as sessions run.')).toBeVisible()
  })

  it('a failed load is a danger Callout in the rail, not the empty sentence', async () => {
    bridge = installMemoryBridge([])
    bridge.list.mockRejectedValue(
      new Error("Error invoking remote method 'memory:list': memory_read_failed")
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await open()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load memory.')
    expect(
      screen.queryByText('Nothing saved yet. Memory fills as sessions run.')
    ).not.toBeInTheDocument()
  })

  it('memory off: a Callout says so and names the Settings row', async () => {
    act(() => settingsStore.getState().applyPatch({ memoryEnabled: false }))
    bridge = installMemoryBridge([])
    await open()
    const off = screen.getByTestId('memory-off')
    expect(off).toHaveTextContent('Memory is off.')
    expect(off).toHaveTextContent('Turn it on in Settings, under Memory.')
    expect(
      screen.queryByText('Nothing saved yet. Memory fills as sessions run.')
    ).not.toBeInTheDocument()
  })
})

describe('MemoryDialog — the form', () => {
  it('opening a row reads the item and shows its fields and read-only lines', async () => {
    bridge = installMemoryBridge([specificItem({ check: 'ss -ltn' })])
    await open()
    await userEvent.click(row('API port'))
    expect(await screen.findByLabelText('Key')).toHaveValue('API port')
    expect(screen.getByLabelText('Value')).toHaveValue('9281')
    expect(screen.getByLabelText('Check')).toHaveValue('ss -ltn')
    expect(screen.getByTestId('memory-form-basis')).toHaveTextContent('observed')
    expect(screen.getByTestId('memory-form-origin')).toHaveTextContent('fix-health-check')
    expect(screen.getByTestId('memory-form-folder')).toHaveTextContent('/srv/acme/api')
    expect(bridge.get).toHaveBeenCalledWith('m1')
  })

  it('an item from a deleted session says so beside its origin session', async () => {
    bridge = installMemoryBridge([specificItem({ originDeletedAt: MEMORY_NOW - 1000 })])
    await open()
    await userEvent.click(row('API port'))
    expect(await screen.findByTestId('memory-form-origin')).toHaveTextContent('Session deleted')
  })

  it('a value over 500 characters greys Save and the hint names Value', async () => {
    bridge = installMemoryBridge([specificItem()])
    await open()
    await userEvent.click(row('API port'))
    const value = await screen.findByLabelText('Value')
    await userEvent.clear(value)
    await userEvent.click(value)
    await userEvent.paste('9'.repeat(501))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByTestId('memory-hint')).toHaveTextContent(
      'Value must be 1–500 characters on one line.'
    )
  })

  it('the form shows Mark stale on an active item and Mark active on a stale one', async () => {
    bridge = installMemoryBridge([
      specificItem(),
      specificItem({ id: 'm2', key: 'Old host', state: 'stale' })
    ])
    await open()
    await userEvent.click(row('API port'))
    expect(await screen.findByRole('button', { name: 'Mark stale' })).toBeVisible()
    await userEvent.click(row('Old host'))
    expect(await screen.findByRole('button', { name: 'Mark active' })).toBeVisible()
  })

  it('has no pin button in the form: the pin is on the row', async () => {
    bridge = installMemoryBridge([specificItem()])
    await open()
    await userEvent.click(row('API port'))
    const form = await screen.findByTestId('memory-form')
    expect(within(form).queryByRole('button', { name: /Pin/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pin API port' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })
})

describe('MemoryDialog — History', () => {
  it('lists the versions and Restore this version restores the picked one by its at', async () => {
    bridge = installMemoryBridge([specificItem()])
    bridge.versions.m1 = [
      {
        at: MEMORY_NOW - 2 * 86_400_000,
        by: 'agent',
        reason: 'port moved',
        head: 'API port',
        body: '9281'
      },
      {
        at: MEMORY_NOW - 40 * 86_400_000,
        by: 'operator',
        reason: null,
        head: 'API port',
        body: '9280'
      }
    ]
    await open()
    await userEvent.click(row('API port'))
    await userEvent.click(await screen.findByRole('button', { name: 'History' }))
    const versions = screen.getAllByRole('radio')
    expect(versions).toHaveLength(2)
    await userEvent.click(versions[1] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }))
    expect(bridge.restore).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm restore' }))
    expect(bridge.restore).toHaveBeenCalledWith('m1', MEMORY_NOW - 40 * 86_400_000)
  })

  it('the picked version shows its reason', async () => {
    bridge = installMemoryBridge([specificItem()])
    bridge.versions.m1 = [
      {
        at: MEMORY_NOW - 2 * 86_400_000,
        by: 'agent',
        reason: 'port moved',
        head: 'API port',
        body: '9281'
      },
      {
        at: MEMORY_NOW - 40 * 86_400_000,
        by: 'operator',
        reason: null,
        head: 'API port',
        body: '9280'
      }
    ]
    await open()
    await userEvent.click(row('API port'))
    await userEvent.click(await screen.findByRole('button', { name: 'History' }))
    await userEvent.click(screen.getAllByRole('radio')[0] as HTMLElement)
    expect(screen.getByText('Reason: port moved')).toBeVisible()
  })
})
