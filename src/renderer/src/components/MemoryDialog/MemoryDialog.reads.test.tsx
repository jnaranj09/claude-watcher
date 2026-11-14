// Memory — how the dialog READS main (spec 2026-11-11 memory §8): a row shows its value, the open
// item is read once per selection (never again because the App re-rendered), a new list keeps the
// old rows on screen until it answers, `Show more` asks for the next page, and History closes when
// the selection moves. The real dialog runs; `window.memory` is a stand-in for main.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { flush } from '../../test/renderComponent'
import { cssRule } from '../../test/cssRule'
import { deferred } from '../../test/deferred'
import { MemoryDialog } from './MemoryDialog'
import { workspacesStore } from '../../stores/workspacesStore'
import { settingsStore } from '../../stores/settingsStore'
import { toast, toastStore } from '../../stores/toastStore'
import type { MemoryListResult } from '../../../../shared/ipc/contract'
import {
  MEMORY_NOW,
  factItem,
  installMemoryBridge,
  rowOf,
  specificItem,
  type MemoryBridge
} from '../../test/memoryBridge'

let bridge: MemoryBridge
let unmount: (() => void) | undefined
let rerender: ((onClose: () => void) => void) | undefined

beforeEach(() => {
  act(() => {
    workspacesStore.setState({
      workspaces: [{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }],
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

async function open(): Promise<void> {
  const r = render(<MemoryDialog onClose={vi.fn()} now={() => MEMORY_NOW} />)
  unmount = r.unmount
  rerender = (onClose) => r.rerender(<MemoryDialog onClose={onClose} now={() => MEMORY_NOW} />)
  await flush(4)
}

const row = (name: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`^${name}`) })

describe('MemoryDialog — a row shows its value', () => {
  it('a specific row shows its value under the key', async () => {
    bridge = installMemoryBridge([specificItem()])
    await open()
    expect(within(row('API port')).getByTestId('memory-row-value')).toHaveTextContent('9281')
  })

  it('a fact row shows the first line of its body only', async () => {
    bridge = installMemoryBridge([factItem({ body: 'Migrate first.\nThen restart the API.' })])
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Facts' }))
    const value = within(await screen.findByRole('button', { name: /^Migrations/ })).getByTestId(
      'memory-row-value'
    )
    expect(value).toHaveTextContent('Migrate first.')
    expect(value).not.toHaveTextContent('Then restart')
  })

  it('CSS: the value is one mono line that ends in an ellipsis', () => {
    const rule = cssRule('components/MemoryDialog/MemoryDialog.module.css', '.rowValue')
    expect(rule).toMatch(/font-family:\s*var\(--font-mono\)/)
    expect(rule).toMatch(/white-space:\s*nowrap/)
    expect(rule).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule).toMatch(/overflow:\s*hidden/)
  })
})

describe('MemoryDialog — the open item is read once', () => {
  it('an App re-render (a new onClose) does not read the open item again', async () => {
    bridge = installMemoryBridge([specificItem()])
    await open()
    await userEvent.click(row('API port'))
    await screen.findByTestId('memory-form')
    rerender?.(vi.fn())
    rerender?.(vi.fn())
    await flush(4)
    expect(bridge.get).toHaveBeenCalledTimes(1)
  })

  it('a failed read says so once, however often the App re-renders', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(toast, 'error')
    bridge = installMemoryBridge([specificItem()])
    bridge.get.mockRejectedValue(
      new Error("Error invoking remote method 'memory:get': Error: memory_read_failed")
    )
    await open()
    await userEvent.click(row('API port'))
    await flush(4)
    rerender?.(vi.fn())
    rerender?.(vi.fn())
    await flush(4)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('Could not load memory.', expect.anything())
  })
})

describe('MemoryDialog — a new list keeps the old rows until it answers', () => {
  it('typing in Search keeps the rows and the open row while main answers', async () => {
    bridge = installMemoryBridge([
      specificItem(),
      specificItem({ id: 'm2', key: 'Deploy command' })
    ])
    await open()
    await userEvent.click(row('API port'))
    const held = deferred<MemoryListResult>()
    bridge.list.mockImplementation((req) =>
      req.query === null
        ? Promise.resolve({ rows: bridge.items.map(rowOf), total: 2, twinIds: [] })
        : held.promise
    )
    await userEvent.type(screen.getByRole('textbox', { name: 'Search memory' }), 'p')
    expect(row('API port')).toBeVisible()
    expect(row('Deploy command')).toBeVisible()
    expect(screen.getAllByTestId('memory-row')[0]).toHaveAttribute('data-selected', 'true')
    await act(async () => held.resolve({ rows: [rowOf(specificItem())], total: 1, twinIds: [] }))
    expect(screen.queryByRole('button', { name: /^Deploy command/ })).not.toBeInTheDocument()
  })
})

describe('MemoryDialog — Show more', () => {
  it('asks for the next page at offset 100 and adds its rows under the first page', async () => {
    const items = Array.from({ length: 101 }, (_, i) =>
      specificItem({ id: `m${i}`, key: `key ${String(i).padStart(3, '0')}` })
    )
    bridge = installMemoryBridge(items)
    await open()
    expect(screen.getAllByTestId('memory-row')).toHaveLength(100)
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(bridge.list).toHaveBeenCalledWith(expect.objectContaining({ offset: 100, limit: 100 }))
    expect(screen.getAllByTestId('memory-row')).toHaveLength(101)
    expect(row('key 100')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })
})

describe('MemoryDialog — History follows the selection', () => {
  it('History closes when another row is selected, and reopening the first shows its form', async () => {
    bridge = installMemoryBridge([
      specificItem(),
      specificItem({ id: 'm2', key: 'Deploy command' })
    ])
    await open()
    await userEvent.click(row('API port'))
    await userEvent.click(await screen.findByRole('button', { name: 'History' }))
    expect(screen.getByRole('radiogroup', { name: 'History' })).toBeVisible()
    await userEvent.click(row('Deploy command'))
    await userEvent.click(row('API port'))
    expect(await screen.findByLabelText('Key')).toHaveValue('API port')
    expect(screen.queryByRole('radiogroup', { name: 'History' })).not.toBeInTheDocument()
  })

  it('a version names who wrote it in plain words', async () => {
    bridge = installMemoryBridge([specificItem()])
    bridge.versions.m1 = [
      {
        at: MEMORY_NOW - 1000,
        by: 'operator',
        basis: 'stated',
        reason: null,
        head: 'API port',
        body: '9282'
      },
      {
        at: MEMORY_NOW - 2000,
        by: 'agent',
        basis: 'inferred',
        reason: null,
        head: 'API port',
        body: '9281'
      },
      {
        at: MEMORY_NOW - 3000,
        by: 'extract',
        basis: 'inferred',
        reason: null,
        head: 'API port',
        body: '9280'
      }
    ]
    await open()
    await userEvent.click(row('API port'))
    await userEvent.click(await screen.findByRole('button', { name: 'History' }))
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      '9282 · just now, by you',
      '9281 · just now, by Claude',
      '9280 · just now, by Claude at session end'
    ])
  })
})
