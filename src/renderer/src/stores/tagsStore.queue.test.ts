// Action feedback (spec 2026-09-29 §2.3) — two pickers (the card's, the rail's) write one session's
// tags through ONE queue: the ✓ answers the click at once (pending), two fast clicks cannot
// overwrite each other (one write chain per session, each write built when it RUNS), and a refused
// write reverts only its own tag and says so. Pending is view-state that expires when main answers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { applyPendingTags, setSessionTags, tagsStore } from './tagsStore'
import { toastStore } from './toastStore'
import { deferred, type Deferred } from '../test/deferred'
import type { Tag } from '../../../shared/ipc/contract'

const A: Tag = { id: 'a', name: 'alpha', color: 'amber', workspaceId: null }
const B: Tag = { id: 'b', name: 'beta', color: 'rose', workspaceId: null }

let base: string[]
const readBase = (): readonly string[] => base
let calls: { ids: string[]; d: Deferred<void> }[]

beforeEach(() => {
  base = []
  calls = []
  const setTags = vi.fn((_sessionId: string, ids: string[]) => {
    const d = deferred<void>()
    calls.push({ ids, d })
    return d.promise
  })
  ;(window as unknown as { launch: unknown }).launch = { setTags }
  tagsStore.setState({ tags: [A, B], loaded: true, activeTagId: null, pendingBySession: new Map() })
  toastStore.setState({ toasts: [] })
})
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

// The write chain is module state: answer every write a test left in flight, so the next test's
// first write does not queue behind it.
afterEach(async () => {
  for (let i = 0; i < 4; i++) {
    for (const c of calls) c.d.resolve()
    await settle()
  }
  vi.restoreAllMocks()
})

const effective = (): string[] =>
  applyPendingTags(base, tagsStore.getState().pendingBySession.get('s1'))

describe('applyPendingTags', () => {
  it('adds pending-on, drops pending-off, keeps the rest in order', () => {
    expect(
      applyPendingTags(
        ['x', 'a'],
        new Map([
          ['a', false],
          ['b', true]
        ])
      )
    ).toEqual(['x', 'b'])
    expect(applyPendingTags(['x'], undefined)).toEqual(['x'])
  })
})

describe('setSessionTags — the queue', () => {
  it('the ✓ answers the click at once, before main does', () => {
    void setSessionTags('s1', ['a'], readBase)
    expect(effective()).toEqual(['a'])
  })

  it('two clicks before the delta produce two correct lists', async () => {
    const first = setSessionTags('s1', ['a'], readBase) // click 1: the picker showed []
    await settle()
    expect(calls.map((c) => c.ids)).toEqual([['a']])
    const second = setSessionTags('s1', effective().concat('b'), readBase) // click 2 sees ['a']
    await settle()
    expect(calls.map((c) => c.ids)).toEqual([['a']]) // serialized: the second waits
    base = ['a'] // main applied write 1 and shipped the delta before it answered
    calls[0]?.d.resolve()
    await settle()
    expect(calls.map((c) => c.ids)).toEqual([['a'], ['a', 'b']])
    base = ['a', 'b']
    calls[1]?.d.resolve()
    await Promise.all([first, second])
    expect(tagsStore.getState().pendingBySession.get('s1')).toBeUndefined()
  })

  it('a write sends the base AND the pending toggles as they stand when it runs', async () => {
    // Click 2 lands while write 1 is in flight and main has NOT shipped write 1's delta yet: the
    // second write must still carry 'a' — from pending, since the base does not have it.
    const first = setSessionTags('s1', ['a'], readBase)
    await settle()
    const second = setSessionTags('s1', effective().concat('b'), readBase)
    await settle()
    base = ['x'] // an unrelated change reached the card meanwhile
    calls[0]?.d.resolve()
    await settle()
    // write 1 settled → its 'a' entry is gone; the base does not carry 'a' → only 'b' pending
    expect(calls[1]?.ids).toEqual(['x', 'b'])
    calls[1]?.d.resolve()
    await Promise.all([first, second])
  })

  it('a refused write reverts only its own tag and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    base = ['a']
    const run = setSessionTags('s1', ['a', 'b'], readBase)
    await settle()
    expect(effective()).toEqual(['a', 'b'])
    calls[0]?.d.reject(new Error('tag_out_of_scope'))
    await run
    expect(effective()).toEqual(['a'])
    expect(toastStore.getState().toasts.map((t) => [t.kind, t.title])).toEqual([
      ['error', 'Could not update tags.']
    ])
  })

  it('a refused write leaves a LATER click on another tag pending', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = setSessionTags('s1', ['a'], readBase)
    await settle()
    const second = setSessionTags('s1', effective().concat('b'), readBase)
    await settle()
    calls[0]?.d.reject(new Error('tag_out_of_scope'))
    await settle()
    expect(effective()).toEqual(['b']) // 'a' reverted, 'b' still answers its click
    expect(calls[1]?.ids).toEqual(['b'])
    calls[1]?.d.resolve()
    await Promise.all([first, second])
  })

  it('a settled write keeps a later click that flipped the same tag back', async () => {
    base = []
    const first = setSessionTags('s1', ['a'], readBase) // on
    await settle()
    const second = setSessionTags('s1', [], readBase) // off again, before write 1 answered
    await settle()
    base = ['a']
    calls[0]?.d.resolve()
    await settle()
    expect(effective()).toEqual([]) // write 1's settle must not drop click 2's 'off'
    expect(calls[1]?.ids).toEqual([])
    base = []
    calls[1]?.d.resolve()
    await Promise.all([first, second])
    expect(tagsStore.getState().pendingBySession.get('s1')).toBeUndefined()
  })

  it('a click that changes nothing sends nothing', async () => {
    base = ['a']
    await setSessionTags('s1', ['a'], readBase)
    expect(calls).toEqual([])
  })

  it('an id the catalog does not know is never touched', async () => {
    base = ['ghost']
    const run = setSessionTags('s1', ['a'], readBase) // the picker never lists 'ghost'
    await settle()
    expect(calls[0]?.ids).toEqual(['ghost', 'a'])
    calls[0]?.d.resolve()
    await run
  })

  it('never rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const run = setSessionTags('s1', ['a'], readBase)
    await settle()
    calls[0]?.d.reject(new Error('no_window'))
    await expect(run).resolves.toBeUndefined()
  })
})
