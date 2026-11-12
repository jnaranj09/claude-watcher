// A small stand-in for main's memory store behind `window.memory` (the GoalsDialog test's style):
// it keeps the items it answers with, applies the dialog's writes to them, and records every call.
// It does not filter: what the dialog ASKS for is what the tests check. Shared by the Memory
// dialog's tests.
import { vi, type Mock } from 'vitest'
import type {
  MemoryCreateRequest,
  MemoryEditRequest,
  MemoryItem,
  MemoryListRequest,
  MemoryRow,
  MemoryVersion
} from '../../../shared/schemas/memory'
import type { MemoryGetResult, MemoryListResult } from '../../../shared/ipc/contract'

export const MEMORY_NOW = new Date(2026, 10, 12, 15, 0).getTime()
const DAY = 86_400_000

const BASE = {
  workspaceId: 'w1',
  state: 'active',
  pinned: false,
  basis: 'observed',
  check: null,
  lastSeenAt: MEMORY_NOW - DAY,
  createdAt: MEMORY_NOW - 9 * DAY,
  updatedAt: MEMORY_NOW - 2 * DAY,
  origin: { by: 'agent', sessionId: 's-1' },
  originDeletedAt: null,
  meta: {
    folder: '/srv/acme/api',
    sessionName: 'fix-health-check',
    tagIds: [],
    templateId: null,
    goalId: null,
    taskIds: []
  }
} as const satisfies Omit<MemoryItem, 'kind' | 'id' | 'key' | 'value' | 'title' | 'body'>

export function specificItem(
  over: Partial<Extract<MemoryItem, { kind: 'specific' }>> = {}
): MemoryItem {
  return {
    ...BASE,
    meta: { ...BASE.meta, tagIds: [] },
    origin: { ...BASE.origin },
    kind: 'specific',
    id: 'm1',
    key: 'API port',
    value: '9281',
    ...over
  }
}

export function factItem(over: Partial<Extract<MemoryItem, { kind: 'fact' }>> = {}): MemoryItem {
  return {
    ...BASE,
    meta: { ...BASE.meta, tagIds: [] },
    origin: { ...BASE.origin },
    kind: 'fact',
    id: 'f1',
    title: 'Migrations run first',
    body: 'The deploy script runs db/migrate before the API restarts.',
    ...over
  }
}

function head(item: MemoryItem): string {
  return item.kind === 'specific' ? item.key : item.title
}

function text(item: MemoryItem): string {
  return item.kind === 'specific' ? item.value : item.body
}

export function rowOf(item: MemoryItem): MemoryRow {
  return {
    id: item.id,
    kind: item.kind,
    head: head(item),
    body: text(item),
    updatedAt: item.updatedAt,
    basis: item.basis,
    state: item.state,
    pinned: item.pinned,
    workspaceId: item.workspaceId,
    folder: item.meta.folder,
    sessionName: item.meta.sessionName,
    tagIds: [...item.meta.tagIds],
    originDeletedAt: item.originDeletedAt
  }
}

export interface MemoryBridge {
  items: MemoryItem[]
  versions: Record<string, MemoryVersion[]>
  list: Mock<(req: MemoryListRequest) => Promise<MemoryListResult>>
  get: Mock<(id: string) => Promise<MemoryGetResult>>
  create: Mock<(req: MemoryCreateRequest) => Promise<MemoryItem>>
  edit: Mock<(req: MemoryEditRequest) => Promise<MemoryItem>>
  setState: Mock<(id: string, state: MemoryItem['state']) => Promise<MemoryItem>>
  setPinned: Mock<(id: string, pinned: boolean) => Promise<MemoryItem>>
  remove: Mock<(id: string) => Promise<void>>
  restore: Mock<(id: string, versionAt: number) => Promise<MemoryItem>>
  activity: Mock<() => Promise<never>>
  onChanged: Mock<(cb: () => void) => () => void>
}

/** Main's wrapped rejection for an id it does not hold. */
const NOT_FOUND = (): Error =>
  new Error("Error invoking remote method 'memory': Error: memory_not_found")

/** The item, or a REJECTED promise (as the real bridge answers), never a synchronous throw. */
function withItem<T>(bridge: MemoryBridge, id: string, then: (item: MemoryItem) => T): Promise<T> {
  const item = bridge.items.find((i) => i.id === id)
  return item === undefined ? Promise.reject(NOT_FOUND()) : Promise.resolve(then(item))
}

function replace(bridge: MemoryBridge, next: MemoryItem): MemoryItem {
  bridge.items = bridge.items.map((i) => (i.id === next.id ? next : i))
  return next
}

/** Installs the stand-in as `window.memory` and returns it. */
export function installMemoryBridge(items: MemoryItem[]): MemoryBridge {
  const bridge: MemoryBridge = {
    items,
    versions: {},
    list: vi.fn((req: MemoryListRequest) => {
      const rows = bridge.items.filter((i) => i.kind === req.kind).map(rowOf)
      return Promise.resolve({
        rows: rows.slice(req.offset, req.offset + req.limit),
        total: rows.length
      })
    }),
    get: vi.fn((id: string) =>
      withItem(bridge, id, (item) => ({
        item,
        versions: bridge.versions[id] ?? [
          {
            at: item.updatedAt,
            by: item.origin.by,
            reason: null,
            head: head(item),
            body: text(item)
          }
        ]
      }))
    ),
    create: vi.fn((req: MemoryCreateRequest) => {
      const item: MemoryItem =
        req.text.kind === 'specific'
          ? specificItem({
              id: 'm-new',
              key: req.text.key,
              value: req.text.value,
              check: req.check,
              workspaceId: req.workspaceId
            })
          : factItem({
              id: 'f-new',
              title: req.text.title,
              body: req.text.body,
              check: req.check,
              workspaceId: req.workspaceId
            })
      bridge.items = [item, ...bridge.items]
      return Promise.resolve(item)
    }),
    edit: vi.fn((req: MemoryEditRequest) =>
      withItem(bridge, req.id, (item) =>
        replace(bridge, { ...item, ...req.text, check: req.check })
      )
    ),
    setState: vi.fn((id: string, state: MemoryItem['state']) =>
      withItem(bridge, id, (item) => replace(bridge, { ...item, state }))
    ),
    setPinned: vi.fn((id: string, pinned: boolean) =>
      withItem(bridge, id, (item) => replace(bridge, { ...item, pinned }))
    ),
    remove: vi.fn((id: string) => {
      bridge.items = bridge.items.filter((i) => i.id !== id)
      return Promise.resolve()
    }),
    restore: vi.fn((id: string) => withItem(bridge, id, (item) => item)),
    activity: vi.fn(() => Promise.reject(new Error('not used'))),
    onChanged: vi.fn(() => () => {})
  }
  Object.defineProperty(window, 'memory', { value: bridge, configurable: true, writable: true })
  return bridge
}
