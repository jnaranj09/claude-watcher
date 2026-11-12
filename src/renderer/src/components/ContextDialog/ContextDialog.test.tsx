// Context (spec 2026-10-18 §5): what a session's claude loaded, per its bridge mod report, with the
// file history of its instruction files. jsdom `unit` project; `window.context` is stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, waitFor, within, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextDialog } from './ContextDialog'
import { boardStore } from '../../stores/boardStore'
import { modReportFixture, MOD_REPORT_SESSION_ID as SID } from '../../../../__fixtures__/modReport'
import type {
  FileHistoryDiffResult,
  FileHistoryListResult,
  FileVersion,
  SessionSetupState
} from '../../../../shared/ipc/contract'
import { cssRule } from '../../test/cssRule'
import { dialogToast } from '../../test/toasts'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import type { MemoryActivity } from '../../../../shared/schemas/memory'

const TERMINAL = 'term-1'
const NOW = 1_000_000_000
const V2: FileVersion = {
  id: 'v2',
  path: '/work/app/CLAUDE.md',
  hash: 'b'.repeat(64),
  size: 2048,
  seenAt: NOW - 60_000
}
const V1: FileVersion = {
  id: 'v1',
  path: '/work/app/CLAUDE.md',
  hash: 'a'.repeat(64),
  size: 1024,
  seenAt: NOW - 3_600_000
}

type Bridge = {
  getSetup: ReturnType<typeof vi.fn<(id: string) => Promise<SessionSetupState>>>
  onSetupChanged: ReturnType<typeof vi.fn<(cb: (id: string) => void) => () => void>>
  listHistory: ReturnType<typeof vi.fn<(id: string, i: number) => Promise<FileHistoryListResult>>>
  diff: ReturnType<typeof vi.fn<(v: string) => Promise<FileHistoryDiffResult>>>
  open: ReturnType<typeof vi.fn<(id: string, i: number) => Promise<void>>>
  restore: ReturnType<typeof vi.fn<(v: string) => Promise<{ fileName: string }>>>
  fire: (id: string) => void
}

function stubContext(state: SessionSetupState): Bridge {
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

const NO_ACTIVITY: MemoryActivity = { injected: null, entries: [] }

type MemoryStub = {
  activity: ReturnType<typeof vi.fn<(id: string) => Promise<MemoryActivity>>>
  onChanged: ReturnType<typeof vi.fn<(cb: () => void) => () => void>>
  off: ReturnType<typeof vi.fn<() => void>>
  fire: () => void
}

function stubMemory(answer: MemoryActivity = NO_ACTIVITY): MemoryStub {
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

const wrapped = (code: string): Error =>
  new Error(`Error invoking remote method 'file-history:restore': Error: ${code}`)

let rendered: RenderResult | undefined
const onClose = vi.fn()
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  boardStore.setState({ terminalIdBySessionId: { [SID]: TERMINAL } })
  stubMemory()
})
afterEach(() => {
  rendered?.unmount()
  rendered = undefined
  delete (window as unknown as { context?: unknown }).context
  delete (window as unknown as { memory?: unknown }).memory
})

async function open(
  state: SessionSetupState = { state: 'ready', report: modReportFixture() }
): Promise<Bridge> {
  const bridge = stubContext(state)
  rendered = render(<ContextDialog terminalId={TERMINAL} onClose={onClose} />)
  await act(async () => {
    await Promise.resolve()
  })
  return bridge
}

const rail = (): HTMLElement[] =>
  within(screen.getByTestId('context-panel'))
    .getAllByRole('button')
    .filter((b) => b.dataset.testid?.startsWith('context-category-') === true)

const fileRow = (name: string): HTMLElement => {
  const row = screen
    .getAllByTestId('context-file')
    .find((r) => within(r).queryByText(name) !== null)
  if (row === undefined) throw new Error(`no row for ${name}`)
  return row
}

describe('ContextDialog — a ready report', () => {
  it('is titled Context', async () => {
    await open()
    expect(screen.getByRole('dialog', { name: 'Context' })).toBeVisible()
  })

  it('lists the eight categories in order, Instructions first and selected', async () => {
    await open()
    expect(rail().map((b) => b.dataset.testid)).toEqual([
      'context-category-instructions',
      'context-category-skills',
      'context-category-agents',
      'context-category-mcp',
      'context-category-commands',
      'context-category-hooks',
      'context-category-plugins',
      'context-category-memory'
    ])
    expect(rail().map((b) => within(b).getByTestId('context-category-label').textContent)).toEqual([
      'Instructions',
      'Skills',
      'Agents',
      'MCP servers',
      'Commands',
      'Hooks',
      'Plugins',
      'Memory'
    ])
    expect(screen.getByTestId('context-category-instructions')).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('shows each category’s total tokens where the report has them', async () => {
    await open()
    const tokens = (id: string): string | null =>
      within(screen.getByTestId(`context-category-${id}`)).queryByTestId('context-category-tokens')
        ?.textContent ?? null
    expect(tokens('instructions')).toBe('1,200 tokens')
    expect(tokens('skills')).toBe('90 tokens')
    expect(tokens('agents')).toBe('300 tokens')
    expect(tokens('mcp')).toBe('900 tokens')
    expect(tokens('commands')).toBe('300 tokens')
    expect(tokens('hooks')).toBeNull()
    expect(tokens('plugins')).toBeNull()
  })

  it('lists instruction files in report order with name, tier and import parent', async () => {
    await open()
    const rows = screen.getAllByTestId('context-file')
    expect(rows.map((r) => within(r).getByTestId('context-file-name').textContent)).toEqual([
      'CLAUDE.md',
      'CLAUDE.md',
      'rules.md'
    ])
    expect(within(rows[0]!).getByText('User')).toBeVisible()
    expect(within(rows[1]!).getByText('Project')).toBeVisible()
    expect(within(rows[2]!).getByText('imported by CLAUDE.md')).toBeVisible()
  })

  it('shows tokens joined from the memory files by path, and none when absent', async () => {
    await open()
    const rows = screen.getAllByTestId('context-file')
    expect(within(rows[1]!).getByText('1,200 tokens')).toBeVisible()
    expect(within(rows[0]!).queryByText(/tokens/)).not.toBeInTheDocument()
  })

  it('keeps the full path in the name’s title', async () => {
    await open()
    expect(
      within(screen.getAllByTestId('context-file')[2]!).getByTestId('context-file-name')
    ).toHaveAttribute('title', '/work/app/docs/rules.md')
  })

  it('Open in editor asks main by session id and file index, never a path', async () => {
    const bridge = await open()
    await userEvent.click(
      within(screen.getAllByTestId('context-file')[1]!).getByRole('button', {
        name: 'Open in editor'
      })
    )
    expect(bridge.open).toHaveBeenCalledWith(SID, 1)
  })

  it('a refused Open says the file no longer exists', async () => {
    const bridge = await open()
    bridge.open.mockRejectedValue(wrapped('file_missing'))
    await userEvent.click(
      within(screen.getAllByTestId('context-file')[1]!).getByRole('button', {
        name: 'Open in editor'
      })
    )
    await waitFor(() =>
      expect(dialogToast('context')).toMatchObject({
        kind: 'error',
        title: 'That file no longer exists.'
      })
    )
  })

  it('another file a report names has Open in editor but no History', async () => {
    await open({
      state: 'ready',
      report: modReportFixture({
        instructionFiles: [
          { path: '/work/app/CLAUDE.md', kind: 'project' },
          { path: '/work/app/notes.txt', kind: 'project', parent: '/work/app/CLAUDE.md' },
          { path: 'relative.md', kind: 'project' }
        ]
      })
    })
    expect(
      within(fileRow('notes.txt'))
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Open in editor'])
    expect(within(fileRow('CLAUDE.md')).getAllByRole('button')).toHaveLength(2)
    expect(within(fileRow('relative.md')).queryAllByRole('button')).toEqual([])
  })

  it('a refused Open of a program says it is not opened', async () => {
    const bridge = await open()
    bridge.open.mockRejectedValue(wrapped('file_runnable'))
    await userEvent.click(
      within(fileRow('rules.md')).getByRole('button', { name: 'Open in editor' })
    )
    await waitFor(() =>
      expect(dialogToast('context')).toMatchObject({
        kind: 'error',
        title: 'rules.md can run as a program, so it is not opened.'
      })
    )
  })

  it('an unknown kind shows as claude sent it', async () => {
    await open({
      state: 'ready',
      report: modReportFixture({ instructionFiles: [{ path: '/a/X.md', kind: 'someNewTier' }] })
    })
    expect(within(fileRow('X.md')).getByText('someNewTier')).toBeVisible()
  })
})

describe('ContextDialog — History', () => {
  async function openHistory(): Promise<Bridge> {
    const bridge = await open()
    await userEvent.click(
      within(screen.getAllByTestId('context-file')[1]!).getByRole('button', { name: 'History' })
    )
    return bridge
  }

  it('lists versions newest first by time and size', async () => {
    const bridge = await openHistory()
    expect(bridge.listHistory).toHaveBeenCalledWith(SID, 1)
    const radios = await screen.findAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      '1 min ago, 2 KB',
      '1 h ago, 1 KB'
    ])
  })

  it('selecting a version shows its diff against the file now, marked', async () => {
    const bridge = await openHistory()
    await userEvent.click((await screen.findAllByRole('radio'))[1]!)
    expect(bridge.diff).toHaveBeenCalledWith('v1')
    const lines = await screen.findAllByTestId('context-diff-line')
    expect(lines.map((l) => [l.dataset.op, l.textContent])).toEqual([
      ['same', ' # app'],
      ['del', '-old rule'],
      ['add', '+new rule']
    ])
  })

  it('a slow diff for an earlier pick never shows under the version picked after it', async () => {
    const bridge = await openHistory()
    let finishFirst: (r: FileHistoryDiffResult) => void = () => {}
    bridge.diff.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve
        })
    )
    bridge.diff.mockImplementationOnce(() =>
      Promise.resolve({ lines: [{ op: 'add', text: 'second' }] })
    )
    const radios = await screen.findAllByRole('radio')
    await userEvent.click(radios[1]!)
    await userEvent.click(radios[0]!)
    await screen.findByText('second', { exact: false })
    await act(async () => {
      finishFirst({ lines: [{ op: 'add', text: 'first' }] })
      await Promise.resolve()
    })
    expect(screen.queryByText('first', { exact: false })).not.toBeInTheDocument()
    expect(screen.getByText('second', { exact: false })).toBeVisible()
  })

  it('a too-large diff says so', async () => {
    const bridge = await openHistory()
    bridge.diff.mockRejectedValue(wrapped('file_too_large'))
    await userEvent.click((await screen.findAllByRole('radio'))[0]!)
    await waitFor(() =>
      expect(dialogToast('context')).toMatchObject({
        kind: 'error',
        title: 'That file is too large to compare.'
      })
    )
  })

  it('Restore this version arms in place, Escape disarms without closing', async () => {
    const bridge = await openHistory()
    await userEvent.click((await screen.findAllByRole('radio'))[0]!)
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }))
    expect(screen.getByRole('button', { name: 'Confirm restore' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Restore this version' })).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
    expect(bridge.restore).not.toHaveBeenCalled()
  })

  it('Confirm restore restores the version and says so', async () => {
    const bridge = await openHistory()
    await userEvent.click((await screen.findAllByRole('radio'))[0]!)
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm restore' }))
    expect(bridge.restore).toHaveBeenCalledWith('v2')
    await waitFor(() =>
      expect(dialogToast('context')).toMatchObject({
        kind: 'success',
        title: 'Restored CLAUDE.md.'
      })
    )
  })

  it.each([
    ['file_restore_failed', 'Could not restore CLAUDE.md.'],
    ['version_not_found', 'That version is no longer in the history.'],
    ['store_write_failed', STORE_WRITE_FAILED_COPY]
  ])('a refused restore (%s) shows its copy', async (code, copy) => {
    const bridge = await openHistory()
    bridge.restore.mockRejectedValue(wrapped(code))
    await userEvent.click((await screen.findAllByRole('radio'))[0]!)
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm restore' }))
    await waitFor(() =>
      expect(dialogToast('context')).toMatchObject({ kind: 'error', title: copy })
    )
  })

  it('a file over the size cap says no versions are kept', async () => {
    const bridge = await open()
    bridge.listHistory.mockResolvedValue({ versions: [], tooLarge: true })
    await userEvent.click(
      within(screen.getAllByTestId('context-file')[1]!).getByRole('button', { name: 'History' })
    )
    expect(
      await screen.findByText('This file is over 1 MB, so no versions are kept.')
    ).toBeVisible()
  })

  it('a new report that reorders the files keeps History on the same file', async () => {
    const bridge = await open()
    await userEvent.click(within(fileRow('rules.md')).getByRole('button', { name: 'History' }))
    const [user, project, rules] = modReportFixture().instructionFiles
    bridge.getSetup.mockResolvedValue({
      state: 'ready',
      report: modReportFixture({ instructionFiles: [rules!, user!, project!] })
    })
    await act(async () => {
      bridge.fire(SID)
      await Promise.resolve()
    })
    expect(within(screen.getByTestId('context-history')).getByText('rules.md')).toBeVisible()
    expect(bridge.listHistory).toHaveBeenLastCalledWith(SID, 0)
  })

  it('a new report without the file closes History back to the list', async () => {
    const bridge = await open()
    await userEvent.click(within(fileRow('rules.md')).getByRole('button', { name: 'History' }))
    const [user, project] = modReportFixture().instructionFiles
    bridge.getSetup.mockResolvedValue({
      state: 'ready',
      report: modReportFixture({ instructionFiles: [user!, project!] })
    })
    await act(async () => {
      bridge.fire(SID)
      await Promise.resolve()
    })
    expect(screen.queryByTestId('context-history')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('context-file')).toHaveLength(2)
  })

  it('a restore reloads the versions, so the kept copy of the file shows', async () => {
    const bridge = await openHistory()
    const kept: FileVersion = { ...V2, id: 'v3', seenAt: NOW, size: 10 }
    await userEvent.click((await screen.findAllByRole('radio'))[0]!)
    bridge.listHistory.mockResolvedValue({ versions: [kept, V2, V1], tooLarge: false })
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm restore' }))
    expect(await screen.findByRole('radio', { name: 'just now, 10 B' })).toBeVisible()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(dialogToast('context')).toMatchObject({ kind: 'success', title: 'Restored CLAUDE.md.' })
  })

  it('the back button returns to the file list', async () => {
    await openHistory()
    await userEvent.click(screen.getByRole('button', { name: 'Instructions' }))
    expect(screen.getAllByTestId('context-file')).toHaveLength(3)
  })
})

describe('ContextDialog — the other pages', () => {
  const page = async (id: string): Promise<HTMLElement> => {
    await userEvent.click(screen.getByTestId(`context-category-${id}`))
    return screen.getByTestId(`context-pane-${id}`)
  }

  it('Skills shows name, source, plugin name and tokens, with no open action', async () => {
    await open()
    const pane = await page('skills')
    expect(within(pane).getByText('tdd')).toBeVisible()
    expect(within(pane).getByText('plugin · superpowers')).toBeVisible()
    expect(within(pane).getByText('userSettings')).toBeVisible()
    expect(within(pane).queryByRole('button', { name: 'Open in editor' })).not.toBeInTheDocument()
  })

  it('Agents shows type, source and tokens', async () => {
    await open()
    const pane = await page('agents')
    expect(within(pane).getByText('Explore')).toBeVisible()
    expect(within(pane).getByText('built-in')).toBeVisible()
  })

  it('MCP servers shows tools and loaded counts', async () => {
    await open()
    const pane = await page('mcp')
    expect(within(pane).getByText('jira')).toBeVisible()
    expect(within(pane).getByText('4 tools · 2 loaded')).toBeVisible()
  })

  it('Commands shows the total', async () => {
    await open()
    expect(within(await page('commands')).getByText('12 commands')).toBeVisible()
  })

  it('Hooks and Plugins show names and sources', async () => {
    await open()
    expect(within(await page('hooks')).getByText('Stop')).toBeVisible()
    expect(
      within(await page('plugins')).getByText('superpowers@claude-plugins-official')
    ).toBeVisible()
  })

  it('a page with nothing says so', async () => {
    await open({ state: 'ready', report: modReportFixture({ skills: null }) })
    expect(within(await page('skills')).getByText('Claude listed no skills.')).toBeVisible()
  })
})

const IDS = Array.from({ length: 12 }, (_, i) => `m${i + 1}`)

describe('ContextDialog — the Memory page', () => {
  const openMemory = async (answer: MemoryActivity): Promise<MemoryStub> => {
    const memory = stubMemory(answer)
    await open()
    await userEvent.click(screen.getByTestId('context-category-memory'))
    return memory
  }

  it('shows the injected token count and the number of items', async () => {
    const memory = await openMemory({ injected: { tokens: 1250, itemIds: IDS }, entries: [] })
    expect(memory.activity).toHaveBeenCalledWith(SID)
    expect(screen.getByTestId('context-memory-injected')).toHaveTextContent(
      '1,250 tokens · 12 items'
    )
  })

  it('totals the injected tokens on the rail row', async () => {
    stubMemory({ injected: { tokens: 1250, itemIds: IDS }, entries: [] })
    await open()
    expect(
      within(screen.getByTestId('context-category-memory')).getByTestId('context-category-tokens')
    ).toHaveTextContent('1,250 tokens')
  })

  it('says Nothing injected. when nothing was injected', async () => {
    await openMemory(NO_ACTIVITY)
    expect(screen.getByTestId('context-memory-injected')).toHaveTextContent('Nothing injected.')
  })

  it('lists a pulled and a saved entry under their headings, with time and tool', async () => {
    await openMemory({
      injected: null,
      entries: [
        { at: NOW - 5 * 60_000, action: 'pulled', tool: 'memory_search', itemId: 'm1' },
        { at: NOW - 2 * 3_600_000, action: 'saved', tool: 'memory_save', itemId: 'm2' },
        { at: NOW - 60_000, action: 'updated', tool: 'memory_update', itemId: 'm2' },
        { at: NOW - 30_000, action: 'marked_stale', tool: 'memory_mark_stale', itemId: 'm3' }
      ]
    })
    const pulled = screen.getByTestId('context-memory-pulled')
    expect(within(pulled).getByText('memory_search')).toBeVisible()
    expect(within(pulled).getByText('5 min ago')).toBeVisible()
    const saved = screen.getByTestId('context-memory-saved')
    expect(within(saved).getByText('memory_save')).toBeVisible()
    expect(within(saved).getByText('2 h ago')).toBeVisible()
    expect(within(saved).getByText('memory_update')).toBeVisible()
    expect(within(saved).getByText('memory_mark_stale')).toBeVisible()
    expect(within(pulled).queryByText('memory_save')).not.toBeInTheDocument()
  })

  it('reloads when memory changes, and stops listening when the dialog closes', async () => {
    const memory = await openMemory(NO_ACTIVITY)
    expect(memory.activity).toHaveBeenCalledTimes(1)
    memory.activity.mockResolvedValue({ injected: { tokens: 10, itemIds: ['m1'] }, entries: [] })
    await act(async () => {
      memory.fire()
      await Promise.resolve()
    })
    expect(screen.getByTestId('context-memory-injected')).toHaveTextContent('10 tokens · 1 item')
    rendered?.unmount()
    rendered = undefined
    expect(memory.off).toHaveBeenCalled()
  })

  it('a failed read shows a danger notice from the page’s own copy, never the error text', async () => {
    const memory = stubMemory()
    memory.activity.mockRejectedValue(new Error('secret_detail'))
    await open()
    await userEvent.click(screen.getByTestId('context-category-memory'))
    const notice = screen.getByTestId('context-memory-load-error')
    expect(notice).toHaveTextContent('Could not load memory.')
    expect(notice).not.toHaveTextContent('secret_detail')
  })
})

describe('ContextDialog — waiting and unavailable', () => {
  it('waiting shows the placeholder sentence', async () => {
    await open({ state: 'waiting' })
    expect(screen.getByText('Waiting for Claude to report its setup.')).toBeVisible()
  })

  it.each([
    ['claude_too_old', 'Update claude to 2.1.304 or newer to see its context.'],
    ['mod_not_installed', 'The app could not set up its Claude mod. Reopen the app to try again.'],
    ['listener_down', 'Status is off for this session, so Claude cannot report its context.']
  ] as const)('unavailable %s shows its copy', async (reason, copy) => {
    await open({ state: 'unavailable', reason })
    expect(screen.getByText(copy)).toBeVisible()
  })

  it('a setup push for this session moves waiting to the Instructions page', async () => {
    const bridge = await open({ state: 'waiting' })
    bridge.getSetup.mockResolvedValue({ state: 'ready', report: modReportFixture() })
    await act(async () => {
      bridge.fire(SID)
      await Promise.resolve()
    })
    expect(screen.getAllByTestId('context-file')).toHaveLength(3)
  })

  it('follows the terminal when a /clear re-keys its session', async () => {
    const NEW = 'bbbbbbbb-0000-4000-8000-0000000000bb'
    const bridge = await open({ state: 'waiting' })
    bridge.getSetup.mockResolvedValue({
      state: 'ready',
      report: modReportFixture({ sessionId: NEW })
    })
    await act(async () => {
      boardStore.setState({ terminalIdBySessionId: { [NEW]: TERMINAL } })
      await Promise.resolve()
    })
    expect(bridge.getSetup).toHaveBeenLastCalledWith(NEW)
    expect(screen.getAllByTestId('context-file')).toHaveLength(3)
  })

  it('a push for another session asks nothing', async () => {
    const bridge = await open({ state: 'waiting' })
    bridge.getSetup.mockClear()
    act(() => bridge.fire('other'))
    expect(bridge.getSetup).not.toHaveBeenCalled()
  })
})

// Spec 2026-10-26: a failed load is a standing notice, not an action result — a danger Callout in
// the pane it describes, never in a toast.
describe('ContextDialog — a load that fails', () => {
  it('a failed setup read says so in the right column, not in a toast', async () => {
    const bridge = stubContext({ state: 'waiting' })
    bridge.getSetup.mockRejectedValue(new Error('no handler'))
    rendered = render(<ContextDialog terminalId={TERMINAL} onClose={onClose} />)
    await act(async () => {
      await Promise.resolve()
    })
    const line = screen.getByTestId('context-load-error')
    expect(line).toHaveAttribute('role', 'alert')
    expect(line).toHaveAttribute('data-callout')
    expect(line).toHaveTextContent('Could not load this session’s context.')
    // It stands in for the waiting sentence, which would claim a report is on its way.
    expect(screen.queryByTestId('context-placeholder')).not.toBeInTheDocument()
    expect(dialogToast('context')).toBeUndefined()
    expect(screen.queryByText('no handler')).not.toBeInTheDocument()
  })

  it('a setup push that loads clears the notice', async () => {
    const bridge = stubContext({ state: 'waiting' })
    bridge.getSetup.mockRejectedValueOnce(new Error('x'))
    rendered = render(<ContextDialog terminalId={TERMINAL} onClose={onClose} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('context-load-error')).toBeVisible()
    bridge.getSetup.mockResolvedValue({ state: 'ready', report: modReportFixture() })
    await act(async () => {
      bridge.fire(SID)
      await Promise.resolve()
    })
    expect(screen.queryByTestId('context-load-error')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('context-file')).toHaveLength(3)
  })

  it('a history list that fails says so in the history pane, not in a toast', async () => {
    const bridge = await open()
    bridge.listHistory.mockRejectedValue(new Error('x'))
    await userEvent.click(
      within(screen.getAllByTestId('context-file')[1]!).getByRole('button', { name: 'History' })
    )
    const line = await within(screen.getByTestId('context-history')).findByTestId(
      'context-load-error'
    )
    expect(line).toHaveAttribute('role', 'alert')
    expect(line).toHaveTextContent(/^Could not load the history of /)
    expect(dialogToast('context')).toBeUndefined()
  })
})

describe('ContextDialog — the session ends', () => {
  it('says the session has ended once its card leaves the board', async () => {
    await open()
    act(() => boardStore.setState({ terminalIdBySessionId: {} }))
    expect(screen.getByTestId('context-placeholder')).toHaveTextContent('This session has ended.')
  })

  it('still says waiting before the terminal is bound to a session', async () => {
    boardStore.setState({ terminalIdBySessionId: {} })
    await open()
    expect(screen.getByTestId('context-placeholder')).toHaveTextContent(
      'Waiting for Claude to report its setup.'
    )
  })
})

describe('ContextDialog — styles', () => {
  const CSS = 'components/ContextDialog/ContextDialog.module.css'

  it('marks added and removed diff lines with the success and danger fills', () => {
    expect(cssRule(CSS, ".line[data-op='add']")).toMatch(/background:\s*var\(--success-fill\)/)
    expect(cssRule(CSS, ".line[data-op='del']")).toMatch(/background:\s*var\(--danger-fill\)/)
  })

  it('truncates a long file name', () => {
    const name = cssRule(CSS, '.name')
    expect(name).toMatch(/text-overflow:\s*ellipsis/)
    expect(name).toMatch(/white-space:\s*nowrap/)
  })
})
