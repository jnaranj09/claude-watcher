// Memory — the rail's search and filters (spec 2026-11-11 memory §8, option B: the Past sessions
// page's `RailFilter`). Each control changes what the dialog ASKS main for; main does the
// filtering. The chip types come from `MEMORY_FILTER_FIELDS`, and this file pins that every field
// is both offered and sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { flush } from '../../test/renderComponent'
import { MemoryDialog } from './MemoryDialog'
import { MEMORY_CHIP_TYPES, toMemoryFilters } from './memoryFilterMap'
import { MEMORY_FILTER_FIELDS } from '../../../../shared/memory/filterFields'
import { FILTER_TYPE_LABEL } from '../../lib/filterCopy'
import { NO_FILTERS, dayKey } from '../../lib/sessionFilters'
import { workspacesStore } from '../../stores/workspacesStore'
import { settingsStore } from '../../stores/settingsStore'
import { tagsStore } from '../../stores/tagsStore'
import { goalsStore } from '../../stores/goalsStore'
import {
  MEMORY_NOW,
  installMemoryBridge,
  specificItem,
  type MemoryBridge
} from '../../test/memoryBridge'

let bridge: MemoryBridge
let unmount: (() => void) | undefined

const PROD = { id: 't-prod', name: 'acme/prod', color: 'amber' as const, workspaceId: null }
const SHIP = {
  id: 'g1',
  workspaceId: 'w1',
  name: 'Ship v2',
  defaultCwd: '/repo',
  saveToFile: false,
  createdAt: 1,
  memorySessionIds: []
}

beforeEach(() => {
  act(() => {
    workspacesStore.setState({
      workspaces: [{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }],
      activeId: 'w1',
      loaded: true
    })
    settingsStore.getState().applyPatch({ includeGlobal: true, memoryEnabled: true })
    tagsStore.setState({ tags: [PROD], loaded: true })
    goalsStore.setState({ goals: [SHIP], tasks: [], fileProblems: [], loaded: true })
  })
  bridge = installMemoryBridge([
    specificItem(),
    specificItem({
      id: 'm2',
      key: 'Deploy command',
      meta: {
        folder: '/srv/acme/web',
        sessionName: 'release-2.4',
        tagIds: ['t-prod'],
        templateId: null,
        goalId: null,
        taskIds: []
      }
    })
  ])
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  act(() => {
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
    tagsStore.setState({ tags: [], loaded: false })
    goalsStore.setState({ goals: [], tasks: [], fileProblems: [], loaded: false })
  })
  vi.restoreAllMocks()
})

async function open(): Promise<void> {
  const r = render(<MemoryDialog onClose={vi.fn()} now={() => MEMORY_NOW} />)
  unmount = r.unmount
  await flush(4)
}

async function addFilter(type: RegExp): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
  await userEvent.click(screen.getByRole('button', { name: '+ Add filter' }))
  await userEvent.hover(screen.getByRole('menuitem', { name: type }))
}

const lastFilters = (): unknown => bridge.list.mock.lastCall?.[0].filters

describe('MemoryFilters — what the dialog asks for', () => {
  it('typing in Search sends the query', async () => {
    await open()
    await userEvent.type(screen.getByRole('textbox', { name: 'Search memory' }), 'port')
    expect(bridge.list).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'port' }))
  })

  it('Folder sends the picked folder', async () => {
    await open()
    await addFilter(/Folder/)
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^web/ }))
    expect(lastFilters()).toEqual({ folder: '/srv/acme/web' })
  })

  it('Session sends the picked session name', async () => {
    await open()
    await addFilter(/Session$/)
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'release-2.4' }))
    expect(lastFilters()).toEqual({ session: 'release-2.4' })
  })

  it('Tag sends the picked tag by name', async () => {
    await open()
    await addFilter(/Tag/)
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /acme\/prod/ }))
    expect(lastFilters()).toEqual({ tags: ['acme/prod'] })
  })

  it('Updated today sends today as since', async () => {
    await open()
    await addFilter(/Updated/)
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Today' }))
    expect(lastFilters()).toEqual({ since: dayKey(MEMORY_NOW) })
  })

  it('Goal sends the picked goal by name', async () => {
    await open()
    await addFilter(/Goal/)
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Ship v2' }))
    expect(lastFilters()).toEqual({ goal: 'Ship v2' })
  })

  it('Session deleted sends sessionDeleted', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.click(screen.getByRole('button', { name: '+ Add filter' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Session deleted' }))
    expect(lastFilters()).toEqual({ sessionDeleted: true })
  })

  it('Show stale in the header sends includeStale', async () => {
    await open()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show stale' }))
    expect(lastFilters()).toEqual({ includeStale: true })
  })

  it('the Filter button counts the types that are on', async () => {
    await open()
    await addFilter(/Goal/)
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Ship v2' }))
    expect(screen.getByRole('button', { name: 'Filter, 1 on' })).toHaveAttribute('data-lit')
  })
})

describe('MemoryFilters — every field of the filter list', () => {
  it('+ Add filter offers one row per chip type, in the list order', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.click(screen.getByRole('button', { name: '+ Add filter' }))
    const menu = screen.getByRole('menu', { name: 'Add a filter' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((r) => r.textContent)
    ).toEqual(MEMORY_CHIP_TYPES.map((t) => expect.stringContaining(FILTER_TYPE_LABEL[t])))
  })

  it('with every chip on and Show stale, every field of MEMORY_FILTER_FIELDS is sent', () => {
    const sent = toMemoryFilters(
      {
        ...NO_FILTERS,
        folders: ['/srv/acme/api'],
        sessionNames: ['release-2.4'],
        tagIds: ['t-prod'],
        updated: { kind: 'on', day: '2026-11-10' },
        goalIds: ['g1'],
        sessionDeleted: true
      },
      { tags: [PROD], goals: [SHIP], showStale: true, now: MEMORY_NOW }
    )
    expect(Object.keys(sent).sort()).toEqual(MEMORY_FILTER_FIELDS.map((f) => f.name).sort())
  })
})
