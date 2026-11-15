// Memory — where the dialog places an item (spec 2026-11-14 memory context index §8): the form's
// `Folder`, `Goal` and `Tags`, their start from the rail's filters, what `Global` clears, and what
// a Save sends. The real dialog runs; `window.memory` is a stand-in for main.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { flush } from '../../test/renderComponent'
import { MemoryDialog } from './MemoryDialog'
import { workspacesStore } from '../../stores/workspacesStore'
import { settingsStore } from '../../stores/settingsStore'
import { tagsStore } from '../../stores/tagsStore'
import { goalsStore } from '../../stores/goalsStore'
import { toastStore } from '../../stores/toastStore'
import { dialogToast } from '../../test/toasts'
import type { Goal } from '../../../../shared/schemas/goal'
import type { MemoryItem } from '../../../../shared/schemas/memory'
import {
  MEMORY_NOW,
  episodeItem,
  installMemoryBridge,
  specificItem,
  type MemoryBridge
} from '../../test/memoryBridge'

let bridge: MemoryBridge
let unmount: (() => void) | undefined

const INFRA = { id: 't1', name: 'infra', color: 'amber' as const, workspaceId: null }
const API = { id: 't2', name: 'api', color: 'rose' as const, workspaceId: 'w1' }
const WEB = { id: 't3', name: 'web', color: 'blue' as const, workspaceId: 'w2' }
const goal = (id: string, name: string, defaultCwd: string): Goal => ({
  id,
  workspaceId: 'w1',
  name,
  defaultCwd,
  saveToFile: false,
  createdAt: 1
})
const META: MemoryItem['meta'] = {
  folder: '/srv/acme/api',
  sessionName: 'fix-health-check',
  tagIds: [],
  templateId: null,
  goalId: 'g1',
  taskIds: []
}

beforeEach(() => {
  act(() => {
    workspacesStore.setState({
      workspaces: [{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: '/srv/acme' }],
      activeId: 'w1',
      loaded: true
    })
    settingsStore.getState().applyPatch({ includeGlobal: true, memoryEnabled: true })
    tagsStore.setState({ tags: [INFRA, API, WEB], loaded: true })
    goalsStore.setState({
      goals: [goal('g1', 'Ship v2', '/srv/acme/api'), goal('g2', 'Docs', '/srv/acme/docs')],
      tasks: [],
      fileProblems: [],
      loaded: true
    })
  })
  bridge = installMemoryBridge([specificItem({ meta: META })])
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  act(() => {
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false })
    tagsStore.setState({ tags: [], loaded: false })
    goalsStore.setState({ goals: [], tasks: [], fileProblems: [], loaded: false })
    toastStore.setState({ toasts: [] })
  })
  vi.restoreAllMocks()
})

async function open(): Promise<void> {
  const r = render(<MemoryDialog onClose={vi.fn()} now={() => MEMORY_NOW} />)
  unmount = r.unmount
  await flush(4)
}

async function openItem(): Promise<void> {
  await open()
  await userEvent.click(screen.getByRole('button', { name: /^API port/ }))
  await screen.findByTestId('memory-form')
}

async function newSpecific(): Promise<void> {
  await open()
  await userEvent.click(screen.getByRole('button', { name: '+ New' }))
  await userEvent.type(screen.getByLabelText('Key'), 'Node version')
  await userEvent.type(screen.getByLabelText('Value'), 'v22.11.0')
}

async function choose(testId: string, value: string): Promise<void> {
  await userEvent.click(screen.getByTestId(testId))
  await userEvent.click(screen.getByTestId(`${testId}-option-${value}`))
}

/** Opens the form's tag list and ticks one tag, then closes the list with Escape. */
async function tick(tagId: string): Promise<void> {
  await userEvent.click(screen.getByTestId('memory-tags-button'))
  await userEvent.click(screen.getByTestId(`memory-tag-picker-row-${tagId}`))
  await userEvent.keyboard('{Escape}')
}

const save = (): Promise<void> => userEvent.click(screen.getByRole('button', { name: 'Save' }))
const editContext = (): unknown => bridge.edit.mock.lastCall?.[0].context

describe('MemoryDialog — an item placed by folder, goal and tags', () => {
  it('1. a new item is created with the folder, goal and tags picked', async () => {
    await newSpecific()
    await choose('memory-folder', '/srv/acme/api')
    await choose('memory-goal', 'g1')
    await tick('t1')
    await save()
    expect(bridge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        context: { folder: '/srv/acme/api', goalId: 'g1', tagIds: ['t1'] }
      })
    )
  })

  it('2. a new item starts from the rail filters', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.click(screen.getByRole('button', { name: '+ Add filter' }))
    await userEvent.hover(screen.getByRole('menuitem', { name: /Folder/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^api/ }))
    await userEvent.click(screen.getByRole('button', { name: '+ New' }))
    expect(screen.getByTestId('memory-folder')).toHaveAttribute('data-value', '/srv/acme/api')
  })

  it('3. with no filter the form starts on No folder and No goal, and the hint is shown', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: '+ New' }))
    expect(screen.getByTestId('memory-folder')).toHaveAttribute('data-value', 'none')
    expect(screen.getByTestId('memory-folder')).toHaveTextContent('No folder')
    expect(screen.getByTestId('memory-goal')).toHaveTextContent('No goal')
    expect(screen.getByTestId('memory-context-hint')).toHaveTextContent(
      'Sessions in this folder, goal or with these tags list this item. With none, every session of the workspace does.'
    )
  })

  it('4. Global on hides Goal and drops a workspace tag from the request', async () => {
    await newSpecific()
    await choose('memory-goal', 'g1')
    await tick('t2')
    await tick('t1')
    await userEvent.click(screen.getByRole('switch', { name: 'Global' }))
    expect(screen.queryByTestId('memory-goal')).not.toBeInTheDocument()
    await save()
    expect(bridge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: null,
        context: { folder: null, goalId: null, tagIds: ['t1'] }
      })
    )
  })

  it('5. an open item shows its folder, goal and tags as fields, and Save sends only the changed field', async () => {
    bridge.items = [specificItem({ meta: { ...META, tagIds: ['t1'] } })]
    await openItem()
    expect(screen.getByTestId('memory-folder')).toHaveAttribute('data-value', '/srv/acme/api')
    expect(screen.getByTestId('memory-goal')).toHaveAttribute('data-value', 'g1')
    expect(screen.getByTestId('memory-tags-chips')).toHaveTextContent('infra')
    expect(screen.queryByTestId('memory-form-folder')).not.toBeInTheDocument()
    await choose('memory-goal', 'g2')
    await save()
    expect(editContext()).toEqual({ goalId: 'g2' })
  })

  it('6. a stored folder the dialog does not know is the picked option, and a tags-only Save keeps it', async () => {
    bridge.items = [specificItem({ meta: { ...META, folder: '/gone/place' } })]
    await openItem()
    expect(screen.getByTestId('memory-folder')).toHaveAttribute('data-value', '/gone/place')
    await tick('t2')
    await save()
    expect(editContext()).toEqual({ tagIds: ['t2'] })
  })

  it('7. changing only the context makes Save available; an untouched form sends context null', async () => {
    await openItem()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await choose('memory-folder', 'none')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await choose('memory-folder', '/srv/acme/api')
    await userEvent.clear(screen.getByLabelText('Value'))
    await userEvent.type(screen.getByLabelText('Value'), '9282')
    await save()
    expect(editContext()).toBeNull()
  })

  it('8. memory_context_invalid shows That goal or tag no longer exists. and keeps the draft', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    bridge.edit.mockRejectedValue(
      new Error("Error invoking remote method 'memory:edit': Error: memory_context_invalid")
    )
    await openItem()
    await choose('memory-goal', 'g2')
    await save()
    expect(dialogToast('memory')).toMatchObject({
      kind: 'error',
      title: 'That goal or tag no longer exists.'
    })
    expect(screen.getByTestId('memory-goal')).toHaveAttribute('data-value', 'g2')
  })

  it('9. an episode keeps its read-only Folder and Tags lines', async () => {
    bridge.items = [episodeItem({ meta: { ...META, tagIds: ['t1'] } })]
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Episodes' }))
    await flush(4)
    await userEvent.click(screen.getByRole('button', { name: /^Fixed the health check/ }))
    await screen.findByTestId('memory-episode')
    expect(screen.getByTestId('memory-form-folder')).toHaveTextContent('/srv/acme/api')
    expect(screen.getByTestId('memory-form-tags')).toHaveTextContent('infra')
    expect(screen.queryByTestId('memory-folder')).not.toBeInTheDocument()
  })

  it("the form's tag list takes focus on open, Space ticks, Escape returns to its button", async () => {
    await openItem()
    const button = screen.getByTestId('memory-tags-button')
    await userEvent.click(button)
    expect(screen.getByTestId('memory-tag-picker-row-t1')).toHaveFocus()
    await userEvent.keyboard(' ')
    await userEvent.keyboard('{Escape}')
    expect(button).toHaveFocus()
    expect(screen.getByTestId('memory-form')).toBeInTheDocument()
    await save()
    expect(editContext()).toEqual({ tagIds: ['t1'] })
  })

  it('a stored goal that is gone shows No goal and is not sent', async () => {
    bridge.items = [specificItem({ meta: { ...META, goalId: 'gone' } })]
    await openItem()
    expect(screen.getByTestId('memory-goal')).toHaveAttribute('data-value', 'none')
    await choose('memory-goal', 'none')
    await choose('memory-folder', 'none')
    await save()
    expect(editContext()).toEqual({ folder: null })
  })
})
