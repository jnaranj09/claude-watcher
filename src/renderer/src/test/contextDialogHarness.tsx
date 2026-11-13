// The Context dialog test harness: a stubbed `window.context` and `window.memory`, the dialog
// mounted on one terminal, and the hooks that reset them. Shared by the Context dialog's tests.
//
// Usage:
//   registerContextDialogHooks()            // at the top of the file: registers beforeEach/afterEach
//   const bridge = await openContext()   // stubs `window.context` and mounts the dialog
//   const memory = stubMemory(activity)  // before `openContext()`
import { act } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { ContextDialog } from '../components/ContextDialog/ContextDialog'
import { boardStore } from '../stores/boardStore'
import { modReportFixture, MOD_REPORT_SESSION_ID as SID } from '../../../__fixtures__/modReport'
import type {
  FileHistoryDiffResult,
  FileHistoryListResult,
  FileVersion,
  SessionSetupState
} from '../../../shared/ipc/contract'
import type { MemoryActivity } from '../../../shared/schemas/memory'

export const TERMINAL = 'term-1'
export const NOW = 1_000_000_000
export const V2: FileVersion = {
  id: 'v2',
  path: '/work/app/CLAUDE.md',
  hash: 'b'.repeat(64),
  size: 2048,
  seenAt: NOW - 60_000
}
export const V1: FileVersion = {
  id: 'v1',
  path: '/work/app/CLAUDE.md',
  hash: 'a'.repeat(64),
  size: 1024,
  seenAt: NOW - 3_600_000
}

export type Bridge = {
  getSetup: ReturnType<typeof vi.fn<(id: string) => Promise<SessionSetupState>>>
  onSetupChanged: ReturnType<typeof vi.fn<(cb: (id: string) => void) => () => void>>
  listHistory: ReturnType<typeof vi.fn<(id: string, i: number) => Promise<FileHistoryListResult>>>
  diff: ReturnType<typeof vi.fn<(v: string) => Promise<FileHistoryDiffResult>>>
  open: ReturnType<typeof vi.fn<(id: string, i: number) => Promise<void>>>
  restore: ReturnType<typeof vi.fn<(v: string) => Promise<{ fileName: string }>>>
  fire: (id: string) => void
}

export function stubContext(state: SessionSetupState): Bridge {
  let listener: ((id: string) => void) | null = null
  const bridge: Bridge = {
    getSetup: vi.fn(() => Promise.resolve(state)),
    onSetupChanged: vi.fn((cb) => {
      listener = cb
      return () => {
        listener = null
      }
    }),
    listHistory: vi.fn(() => Promise.resolve({ versions: [V2, V1], tooLarge: false })),
    diff: vi.fn(() =>
      Promise.resolve({
        lines: [
          { op: 'same', text: '# app' },
          { op: 'del', text: 'old rule' },
          { op: 'add', text: 'new rule' }
        ]
      })
    ),
    open: vi.fn(() => Promise.resolve()),
    restore: vi.fn(() => Promise.resolve({ fileName: 'CLAUDE.md' })),
    fire: (id) => listener?.(id)
  }
  ;(window as unknown as { context: unknown }).context = bridge
  return bridge
}

export const NO_ACTIVITY: MemoryActivity = { injected: null, entries: [], recall: null }

export type MemoryStub = {
  activity: ReturnType<typeof vi.fn<(id: string) => Promise<MemoryActivity>>>
  onChanged: ReturnType<typeof vi.fn<(cb: () => void) => () => void>>
  off: ReturnType<typeof vi.fn<() => void>>
  fire: () => void
}

export function stubMemory(answer: MemoryActivity = NO_ACTIVITY): MemoryStub {
  let listener: (() => void) | null = null
  const off = vi.fn<() => void>(() => {
    listener = null
  })
  const stub: MemoryStub = {
    activity: vi.fn(() => Promise.resolve(answer)),
    onChanged: vi.fn((cb) => {
      listener = cb
      return off
    }),
    off,
    fire: () => listener?.()
  }
  ;(window as unknown as { memory: unknown }).memory = stub
  return stub
}

let rendered: RenderResult | undefined
export const onClose = vi.fn()

/** Mount the dialog on `TERMINAL` (the bridges must be stubbed first). */
export function renderContext(): RenderResult {
  rendered = render(<ContextDialog terminalId={TERMINAL} onClose={onClose} />)
  return rendered
}

/** Unmount what `renderContext` mounted, if it still is. */
export function unmountContext(): void {
  rendered?.unmount()
  rendered = undefined
}

/** Stub `window.context` with `state`, mount the dialog and let its first read settle. */
export async function openContext(
  state: SessionSetupState = { state: 'ready', report: modReportFixture() }
): Promise<Bridge> {
  const bridge = stubContext(state)
  renderContext()
  await act(async () => {
    await Promise.resolve()
  })
  return bridge
}

/** Call once at the top of a test file: a fixed `Date.now`, the terminal bound to the fixture
 *  session, an empty memory stub before each test; unmount and drop both bridges after it. */
export function registerContextDialogHooks(): void {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    boardStore.setState({ terminalIdBySessionId: { [SID]: TERMINAL } })
    stubMemory()
  })
  afterEach(() => {
    unmountContext()
    delete (window as unknown as { context?: unknown }).context
    delete (window as unknown as { memory?: unknown }).memory
  })
}
