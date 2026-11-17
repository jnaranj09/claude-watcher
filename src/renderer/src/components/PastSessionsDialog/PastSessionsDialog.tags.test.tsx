// Past sessions — the form's Tags row (spec 2026-11-17): the Memory form's tag button and picker,
// writing through `window.pastSessions.setTags`. A refusal is the dialog's one result toast.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { screen, within } from '@testing-library/react'
import { flush, renderComponent, type RenderResult } from '../../test/renderComponent'
import { deferred } from '../../test/deferred'
import { dialogToast } from '../../test/toasts'
import { SessionsDialog } from '../SessionsDialog/SessionsDialog'
import { pastSessionsStore } from '../../stores/pastSessionsStore'
import { tagsStore } from '../../stores/tagsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import type { PastSession, Tag, Workspace } from '../../../../shared/ipc/contract'

const WS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
]
const A: Tag = { id: 'a', name: 'alpha', color: 'amber', workspaceId: null }
const B: Tag = { id: 'b', name: 'beta', color: 'rose', workspaceId: 'w1' }
const OTHER: Tag = { id: 'o', name: 'other-ws', color: 'blue', workspaceId: 'default' }
const REC: PastSession = {
  id: 'sa',
  name: 'billing api',
  cwd: '/home/op/api',
  workspaceId: 'w1',
  tagIds: [],
  launchedAt: 1_000,
  endedAt: 5_000
}

let r: RenderResult | undefined
let setTags: ReturnType<typeof vi.fn>

beforeEach(() => {
  setTags = vi.fn((id: string, tagIds: string[]) => Promise.resolve([{ ...REC, id, tagIds }]))
  ;(window as unknown as { pastSessions: unknown }).pastSessions = {
    list: vi.fn(() => Promise.resolve([REC])),
    setTags
  }
  act(() => {
    workspacesStore.setState({ workspaces: WS, activeId: 'w1', loaded: true })
    tagsStore.setState({ tags: [A, B, OTHER], loaded: true, pendingBySession: new Map() })
    pastSessionsStore.setState({ sessions: [], loaded: false })
  })
})
afterEach(() => {
  r?.unmount()
  r = undefined
  act(() => {
    pastSessionsStore.setState({ sessions: [], loaded: false })
    tagsStore.setState({ tags: [], loaded: false, pendingBySession: new Map() })
  })
  vi.restoreAllMocks()
})

const find = (id: string): HTMLElement | null => screen.queryByTestId(id)
// The picker is portaled to document.body.
const row = (id: string): HTMLElement => screen.getByTestId(`past-session-tag-picker-row-${id}`)

async function openPicker(): Promise<void> {
  r = renderComponent(<SessionsDialog page="past" onPageChange={() => {}} onClose={() => {}} />)
  await flush()
  act(() => find('past-session-select-sa')?.click())
  act(() => find('past-session-tags-button')?.click())
  await flush()
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

function mockList(records: PastSession[]): void {
  ;(window.pastSessions.list as ReturnType<typeof vi.fn>).mockResolvedValue(records)
}

describe('PastSessionsDialog — editing a record’s tags', () => {
  it('the tag button opens a picker with the tags the record’s workspace may use', async () => {
    await openPicker()
    expect(row('a')).toBeTruthy()
    expect(row('b')).toBeTruthy()
    expect(screen.queryByTestId('past-session-tag-picker-row-o')).not.toBeInTheDocument()
  })

  it('picking a tag sends setTags and the chip shows', async () => {
    await openPicker()
    act(() => row('a').click())
    await settle()
    expect(setTags).toHaveBeenCalledWith('sa', ['a'])
    expect(find('past-session-form-no-tags')).toBeNull()
    expect(
      within(screen.getByTestId('past-session-form-tags')).getAllByTestId('tag-chip')
    ).toHaveLength(1)
  })

  it('two quick toggles send [a] then [a, b]', async () => {
    const first = deferred<PastSession[]>()
    setTags.mockReturnValueOnce(first.promise)
    await openPicker()
    act(() => row('a').click())
    await settle()
    expect(setTags).toHaveBeenCalledTimes(1)
    expect(setTags).toHaveBeenLastCalledWith('sa', ['a'])
    // The first bridge call is still open: the second toggle waits its turn in the write chain.
    act(() => row('b').click())
    await settle()
    expect(setTags).toHaveBeenCalledTimes(1)
    first.resolve([{ ...REC, tagIds: ['a'] }])
    await settle()
    expect(setTags).toHaveBeenCalledTimes(2)
    expect(setTags).toHaveBeenLastCalledWith('sa', ['a', 'b'])
  })

  it('a refused write shows STORE_WRITE_FAILED_COPY as the dialog’s error and the tick reverts', async () => {
    setTags.mockRejectedValueOnce(new Error('store_write_failed'))
    await openPicker()
    act(() => row('a').click())
    await settle()
    expect(dialogToast('sessions')).toMatchObject({ kind: 'error', title: STORE_WRITE_FAILED_COPY })
    expect(find('past-session-form-no-tags')?.textContent).toBe('No tags')
    expect(row('a')).toHaveAttribute('aria-checked', 'false')
  })

  it('a refused write keeps the tags the record already had', async () => {
    setTags.mockRejectedValueOnce(new Error('store_write_failed'))
    mockList([{ ...REC, tagIds: ['a'] }])
    await openPicker()
    act(() => row('b').click())
    await settle()
    expect(
      within(screen.getByTestId('past-session-form-tags')).getAllByTestId('tag-chip')
    ).toHaveLength(1)
    expect(row('a')).toHaveAttribute('aria-checked', 'true')
    expect(row('b')).toHaveAttribute('aria-checked', 'false')
  })

  it('removing the last tag shows No tags', async () => {
    mockList([{ ...REC, tagIds: ['a'] }])
    await openPicker()
    expect(find('past-session-form-no-tags')).toBeNull()
    act(() => row('a').click())
    await settle()
    expect(setTags).toHaveBeenCalledWith('sa', [])
    expect(find('past-session-form-no-tags')?.textContent).toBe('No tags')
  })

  it('a record holding a deleted tag can still be edited', async () => {
    mockList([{ ...REC, tagIds: ['a', 'gone'] }])
    await openPicker()
    act(() => row('b').click())
    await settle()
    expect(setTags).toHaveBeenCalledWith('sa', ['a', 'b'])
  })

  it('tag_not_found shows That tag no longer exists.', async () => {
    setTags.mockRejectedValueOnce(
      new Error("Error invoking remote method 'pastSessions:setTags': Error: tag_not_found")
    )
    await openPicker()
    act(() => row('a').click())
    await settle()
    expect(dialogToast('sessions')).toMatchObject({
      kind: 'error',
      title: 'That tag no longer exists.'
    })
  })

  it('the chip shows at click time, before the bridge answers', async () => {
    const held = deferred<PastSession[]>()
    setTags.mockReturnValueOnce(held.promise)
    await openPicker()
    act(() => row('a').click())
    await settle()
    expect(setTags).toHaveBeenCalledTimes(1)
    expect(find('past-session-form-no-tags')).toBeNull()
    expect(
      within(screen.getByTestId('past-session-form-tags')).getAllByTestId('tag-chip')
    ).toHaveLength(1)
    held.resolve([{ ...REC, tagIds: ['a'] }])
    await settle()
  })

  it('a tag the record’s workspace cannot see is neither drawn nor sent', async () => {
    mockList([{ ...REC, tagIds: ['a', 'o'] }])
    await openPicker()
    expect(
      within(screen.getByTestId('past-session-form-tags')).getAllByTestId('tag-chip')
    ).toHaveLength(1)
    act(() => row('b').click())
    await settle()
    expect(setTags).toHaveBeenCalledWith('sa', ['a', 'b'])
  })

  it('a successful toggle after a refused one clears the old error', async () => {
    setTags.mockRejectedValueOnce(new Error('store_write_failed'))
    await openPicker()
    act(() => row('a').click())
    await settle()
    expect(dialogToast('sessions')).toBeDefined()
    act(() => row('b').click())
    await settle()
    expect(dialogToast('sessions')).toBeUndefined()
  })
})
