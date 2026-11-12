// Memory — every action says what happened (design.md Feedback): Save, + New, Delete, Mark stale,
// the row pin, and a write the disk refused. The real dialog runs; `window.memory` is a stand-in.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen } from '@testing-library/react'
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
  installMemoryBridge,
  specificItem,
  type MemoryBridge
} from '../../test/memoryBridge'

let bridge: MemoryBridge
let unmount: (() => void) | undefined

const WRITE_FAILED = new Error(
  "Error invoking remote method 'memory:edit': Error: store_write_failed"
)

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
  bridge = installMemoryBridge([specificItem()])
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

async function openItem(): Promise<void> {
  const r = render(<MemoryDialog onClose={vi.fn()} now={() => MEMORY_NOW} />)
  unmount = r.unmount
  await flush(4)
  await userEvent.click(screen.getByRole('button', { name: /^API port/ }))
  await screen.findByTestId('memory-form')
}

describe('MemoryDialog — Save', () => {
  it('Save sends the draft to edit and says Memory saved.', async () => {
    await openItem()
    await userEvent.clear(screen.getByLabelText('Value'))
    await userEvent.type(screen.getByLabelText('Value'), '9282')
    await userEvent.type(screen.getByLabelText('Check'), 'ss -ltn')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(bridge.edit).toHaveBeenCalledWith({
      id: 'm1',
      text: { kind: 'specific', key: 'API port', value: '9282' },
      check: 'ss -ltn'
    })
    expect(dialogToast('memory')).toMatchObject({ kind: 'success', title: 'Memory saved.' })
  })

  it('a store_write_failed refusal shows the store-write copy and keeps the draft', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    bridge.edit.mockRejectedValue(WRITE_FAILED)
    await openItem()
    await userEvent.clear(screen.getByLabelText('Value'))
    await userEvent.type(screen.getByLabelText('Value'), '9282')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(dialogToast('memory')).toMatchObject({ kind: 'error', title: STORE_WRITE_FAILED_COPY })
    expect(screen.getByLabelText('Value')).toHaveValue('9282')
  })

  it('+ New creates a specific in the scope workspace, or a global one with Global on', async () => {
    const r = render(<MemoryDialog onClose={vi.fn()} now={() => MEMORY_NOW} />)
    unmount = r.unmount
    await flush(4)
    await userEvent.click(screen.getByRole('button', { name: '+ New' }))
    await userEvent.type(screen.getByLabelText('Key'), 'Node version')
    await userEvent.type(screen.getByLabelText('Value'), 'v22.11.0')
    await userEvent.click(screen.getByRole('switch', { name: 'Global' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(bridge.create).toHaveBeenCalledWith({
      workspaceId: null,
      text: { kind: 'specific', key: 'Node version', value: 'v22.11.0' },
      check: null
    })
    expect(dialogToast('memory')).toMatchObject({ kind: 'success', title: 'Memory saved.' })
  })

  it('a refresh from main while typing keeps the draft', async () => {
    // Main's push reaches every subscriber (the list and the open item).
    const listeners: (() => void)[] = []
    bridge.onChanged.mockImplementation((cb: () => void) => {
      listeners.push(cb)
      return () => {}
    })
    await openItem()
    await userEvent.clear(screen.getByLabelText('Value'))
    await userEvent.type(screen.getByLabelText('Value'), '9282')
    const calls = bridge.list.mock.calls.length
    await act(async () => {
      for (const cb of listeners) cb()
    })
    expect(bridge.list.mock.calls.length).toBeGreaterThan(calls)
    expect(screen.getByLabelText('Value')).toHaveValue('9282')
  })
})

describe('MemoryDialog — Delete', () => {
  it('Delete needs the second press, then says Memory deleted.', async () => {
    await openItem()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(bridge.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(bridge.remove).toHaveBeenCalledWith('m1')
    expect(dialogToast('memory')).toMatchObject({ kind: 'success', title: 'Memory deleted.' })
    expect(screen.getByText('Select an item on the left, or create a new one.')).toBeVisible()
  })
})

describe('MemoryDialog — stale and pin', () => {
  it('Mark stale sets the state and the button says it worked', async () => {
    await openItem()
    await userEvent.click(screen.getByRole('button', { name: 'Mark stale' }))
    expect(bridge.setState).toHaveBeenCalledWith('m1', 'stale')
    // Button feedback: the hidden live region beside the button carries the result.
    expect(await screen.findByText('✓ Saved', { selector: '[role="status"]' })).toBeInTheDocument()
  })

  it('the row pin pins the item', async () => {
    await openItem()
    await userEvent.click(screen.getByRole('button', { name: 'Pin API port' }))
    expect(bridge.setPinned).toHaveBeenCalledWith('m1', true)
  })

  it('a refused pin shows the mapped copy, never the message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    bridge.setPinned.mockRejectedValue(
      new Error("Error invoking remote method 'memory:setPinned': Error: memory_not_found")
    )
    await openItem()
    await userEvent.click(screen.getByRole('button', { name: 'Pin API port' }))
    expect(dialogToast('memory')).toMatchObject({
      kind: 'error',
      title: 'That memory no longer exists.'
    })
  })
})
