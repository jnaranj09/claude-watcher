// A small stand-in for main's memory store behind `window.memory` (the GoalsDialog test's style):
// it keeps the items it answers with, applies the dialog's writes to them, and records every call.
// It does not filter: what the dialog ASKS for is what the tests check. A create stamps the
// request's context (no session name), an edit's context patch replaces the fields it sends. Shared by the Memory
// dialog's tests. `twins` stands in for main's `Same value` rule: `list` marks the rows it returns
// that have an entry there, and `get` answers the first five of an item's entry and counts the rest.
import { vi, type Mock } from 'vitest'
import type {
  MemoryCommand,
  MemoryCreateRequest,
  MemoryEditRequest,
  MemoryItem,
  MemoryListRequest,
  MemoryRow,
  MemoryVersion
} from '../../../shared/schemas/memory'
import type {
  MemoryCommandsResult,
  MemoryGetResult,
  MemoryListResult,
  MemoryTwin
} from '../../../shared/ipc/contract'

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
  source: null,
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

/** An episode: what a session did, written by extraction only. */
export function episodeItem(
  over: Partial<Extract<MemoryItem, { kind: 'episode' }>> = {}
): MemoryItem {
  return {
    ...BASE,
    meta: { ...BASE.meta, tagIds: [] },
    origin: { by: 'extract', sessionId: 's-1' },
    basis: 'inferred',
    kind: 'episode',
    id: 'e1',
    title: 'Fixed the health check',
    body: 'Moved the probe to /healthz.\nThe deploy passed.',
    endedAt: MEMORY_NOW - DAY,
    ...over
  }
}

/** A command a session ran that worked. */
export function commandRow(over: Partial<MemoryCommand> = {}): MemoryCommand {
  return {
    id: 'c1',
    workspaceId: 'w1',
    folder: '/srv/acme/api',
    text: 'npm run build',
    count: 3,
    lastAt: MEMORY_NOW - 7 * 3_600_000,
    sessionDeletedAt: null,
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
  /** Each item id → the twins main would answer for it. */
  twins: Record<string, MemoryTwin[]>
  list: Mock<(req: MemoryListRequest) => Promise<MemoryListResult>>
  get: Mock<(id: string) => Promise<MemoryGetResult>>
  create: Mock<(req: MemoryCreateRequest) => Promise<MemoryItem>>
  edit: Mock<(req: MemoryEditRequest) => Promise<MemoryItem>>
  setState: Mock<(id: string, state: MemoryItem['state']) => Promise<MemoryItem>>
  setPinned: Mock<(id: string, pinned: boolean) => Promise<MemoryItem>>
  remove: Mock<(id: string) => Promise<void>>
  restore: Mock<(id: string, versionAt: number) => Promise<MemoryItem>>
  activity: Mock<() => Promise<never>>
  sessionCount: Mock<(sessionId: string) => Promise<number>>
  removeSession: Mock<(sessionId: string) => Promise<number>>
  onChanged: Mock<(cb: () => void) => () => void>
  commandRows: MemoryCommand[]
  commands: Mock<
    (req: {
      workspaceId: string
      query: string | null
      offset: number
      limit: number
    }) => Promise<MemoryCommandsResult>
  >
  removeCommand: Mock<(id: string) => Promise<void>>
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

/** Main's rule for "the items this session saved" (`memoryStore.ts`, P3-C29): an item the
 *  operator wrote keeps its session id but is not the session's. */
function savedBy(item: MemoryItem, sessionId: string): boolean {
  return item.origin.sessionId === sessionId && item.origin.by !== 'operator'
}

/** Installs the stand-in as `window.memory` and returns it. */
export function installMemoryBridge(
  items: MemoryItem[],
  commandRows: MemoryCommand[] = []
): MemoryBridge {
  const bridge: MemoryBridge = {
    items,
    commandRows,
    versions: {},
    twins: {},
    list: vi.fn((req: MemoryListRequest) => {
      const rows = bridge.items.filter((i) => i.kind === req.kind).map(rowOf)
      const page = rows.slice(req.offset, req.offset + req.limit)
      return Promise.resolve({
        rows: page,
        total: rows.length,
        twinIds: page.filter((r) => (bridge.twins[r.id] ?? []).length > 0).map((r) => r.id)
      })
    }),
    get: vi.fn((id: string) =>
      withItem(bridge, id, (item) => ({
        item,
        versions: bridge.versions[id] ?? [
          {
            at: item.updatedAt,
            by: item.origin.by,
            basis: item.basis,
            reason: null,
            head: head(item),
            body: text(item)
          }
        ],
        twins: (bridge.twins[id] ?? []).slice(0, 5),
        twinsMore: Math.max(0, (bridge.twins[id] ?? []).length - 5)
      }))
    ),
    create: vi.fn((req: MemoryCreateRequest) => {
      const meta = { ...req.context, sessionName: null, templateId: null, taskIds: [] }
      const item: MemoryItem =
        req.text.kind === 'specific'
          ? specificItem({
              id: 'm-new',
              key: req.text.key,
              value: req.text.value,
              check: req.check,
              workspaceId: req.workspaceId,
              meta
            })
          : factItem({
              id: 'f-new',
              title: req.text.title,
              body: req.text.body,
              check: req.check,
              workspaceId: req.workspaceId,
              meta
            })
      bridge.items = [item, ...bridge.items]
      return Promise.resolve(item)
    }),
    edit: vi.fn((req: MemoryEditRequest) =>
      withItem(bridge, req.id, (item) =>
        replace(bridge, {
          ...item,
          ...req.text,
          check: req.check,
          meta: {
            ...item.meta,
            folder: req.context?.folder === undefined ? item.meta.folder : req.context.folder,
            goalId: req.context?.goalId === undefined ? item.meta.goalId : req.context.goalId,
            tagIds: req.context?.tagIds ?? item.meta.tagIds
          }
        })
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
    sessionCount: vi.fn((sessionId: string) =>
      Promise.resolve(bridge.items.filter((i) => savedBy(i, sessionId)).length)
    ),
    removeSession: vi.fn((sessionId: string) => {
      const kept = bridge.items.filter((i) => !savedBy(i, sessionId))
      const removed = bridge.items.length - kept.length
      bridge.items = kept
      return Promise.resolve(removed)
    }),
    onChanged: vi.fn(() => () => {}),
    commands: vi.fn((req) =>
      Promise.resolve({
        rows: bridge.commandRows.slice(req.offset, req.offset + req.limit),
        total: bridge.commandRows.length
      })
    ),
    removeCommand: vi.fn((id: string) => {
      bridge.commandRows = bridge.commandRows.filter((c) => c.id !== id)
      return Promise.resolve()
    })
  }
  Object.defineProperty(window, 'memory', { value: bridge, configurable: true, writable: true })
  return bridge
}
