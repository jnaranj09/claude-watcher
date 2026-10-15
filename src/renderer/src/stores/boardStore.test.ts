// boardStore tests, part 1: reducing validated deltas into the session projection, the column
// selectors (grouping, sort, counts), the cold-load contract and the pinned hero column. jsdom
// `unit` project. Drives the store with VALIDATED `WatchEventsPayload` deltas and an INJECTED
// now(); the store never re-parses with Zod. View-state is in boardStore.view.test.ts, workspace
// scoping and filters in boardStore.filters.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createBoardStore,
  selectColumn,
  selectColumnCount,
  selectTotalCount,
  selectColdLoaded,
  HERO_COLUMN,
  NO_FILTER,
  type BoardState
} from './boardStore'
import { watchRemoved, watchUpdated } from '../../../__fixtures__/watchEvents'
import { FIXED_NOW } from '../test/boardStoreFixtures'

describe('boardStore — reduces validated deltas into a BoardSession projection (AC-8)', () => {
  it('upserts a session.updated into the projection map keyed by id, building from the delta', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(
      watchUpdated(1, 'a', 'working', 100, {
        sessionName: 'web',
        projectPath: '/x',
        pid: 42,
        pendingToolName: 'Bash'
      })
    )
    const s = store.getState().sessionsById['a']
    expect(s).toEqual({
      id: 'a',
      sessionName: 'web',
      projectPath: '/x',
      status: 'Working',
      pid: 42,
      column: 'working',
      enteredColumnAt: 100,
      workspaceId: 'default',
      tagIds: [],
      pendingToolName: 'Bash'
    })
    expect(selectTotalCount(store.getState(), 'default', NO_FILTER)).toBe(1)
  })

  it('coldLoaded flips true on the FIRST delta (epoch ≥ 1)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    expect(selectColdLoaded(store.getState())).toBe(false)
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
    expect(selectColdLoaded(store.getState())).toBe(true)
  })

  it('discards a STALE-epoch delta (idempotent epoch apply — AC-6)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(5, 'a', 'working', 100, { status: 'Working' }))
    // A delta from an OLDER epoch must be ignored (stale across a reconnect).
    store
      .getState()
      .applyWatchEvent(watchUpdated(3, 'a', 'idle', 999, { status: 'WaitingForInput' }))
    const s = store.getState().sessionsById['a']
    expect(s?.column).toBe('working') // unchanged — the stale delta was dropped
    expect(s?.status).toBe('Working')
    expect(store.getState().epoch).toBe(5)
  })

  it('applies a SAME-epoch delta (live watch lines share the current epoch — not stale)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(4, 'a', 'working', 100))
    store
      .getState()
      .applyWatchEvent(watchUpdated(4, 'a', 'needs-you', 200, { status: 'NeedsAttention' }))
    expect(store.getState().sessionsById['a']?.column).toBe('needs-you')
  })

  it('session.removed makes the card VANISH (no Done column — AC-2)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
    expect(selectTotalCount(store.getState(), 'default', NO_FILTER)).toBe(1)
    store.getState().applyWatchEvent(watchRemoved(2, 'a'))
    expect(store.getState().sessionsById['a']).toBeUndefined()
    expect(selectTotalCount(store.getState(), 'default', NO_FILTER)).toBe(0)
  })

  it('attention.raised is IGNORED by the board projection (Epic 2/3 consume it)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
    store.getState().applyWatchEvent({
      epoch: 2,
      event: {
        type: 'attention.raised',
        id: 'a',
        sessionName: 's',
        projectPath: '/p',
        status: 'NeedsAttention',
        timestamp: FIXED_NOW
      }
    })
    // The session is unchanged (still one card, still working); only epoch/liveness move.
    expect(selectTotalCount(store.getState(), 'default', NO_FILTER)).toBe(1)
    expect(store.getState().sessionsById['a']?.column).toBe('working')
    expect(store.getState().epoch).toBe(2)
  })

  it('does NOT call any Zod schema (no re-parse of the parse-once boundary)', () => {
    // The store module imports the contract types + the pure sort util ONLY — never a
    // schema. Assert structurally: applying a delta stores the value VERBATIM (a Zod
    // transform would, e.g., coerce a field). Also assert the store SOURCE imports no
    // `zod` and no session schema (no re-validation of the parse-once boundary).
    const store = createBoardStore({ now: () => FIXED_NOW })
    store
      .getState()
      .applyWatchEvent(watchUpdated(1, 'a', 'idle', 12345, { status: 'WaitingForInput' }))
    expect(store.getState().sessionsById['a']?.enteredColumnAt).toBe(12345) // not coerced
    const src = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/stores/boardStore.ts'),
      'utf8'
    )
    expect(src).not.toMatch(/from ['"]zod['"]/)
    expect(src).not.toMatch(/schemas\/session/)
  })

  it('holds NO terminal/xterm reference (terminals are imperative refs, not in the store)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/stores/boardStore.ts'),
      'utf8'
    )
    // Strip line comments so the rule's own "Terminals are NOT in the store" note does
    // not trip the assertion — we are asserting no terminal CODE, not no mention.
    const code = src
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    expect(code).not.toMatch(/@xterm|node-pty/)
    expect(code).not.toMatch(/\bnew Terminal\b/)
    // And the state shape holds no terminal INSTANCE/REFERENCE. The Story-3.2 view-state DOES
    // carry a `focusedTerminalId` — but that is an OPAQUE STRING id (which terminal is focused),
    // exactly like `selectedId` is a session-id string; the xterm/PTY/MessagePort INSTANCES stay
    // in imperative refs inside EmbeddedTerminal (terminal.md / state.md). So the invariant is
    // "no terminal OBJECT in the store", not "no string id naming a terminal". Assert every
    // non-function state value is a primitive / plain projection — never an xterm-like object
    // (an object exposing terminal methods like open/write/dispose/onData).
    const store = createBoardStore({ now: () => FIXED_NOW })
    const looksLikeTerminal = (v: unknown): boolean =>
      typeof v === 'object' &&
      v !== null &&
      ['write', 'dispose', 'onData', 'open', 'resize', 'kill'].some(
        (m) => typeof (v as Record<string, unknown>)[m] === 'function'
      )
    const terminalLikeValues = Object.entries(store.getState())
      .filter(([, v]) => typeof v !== 'function')
      .filter(([, v]) => looksLikeTerminal(v))
    expect(terminalLikeValues).toEqual([])
    // focusedTerminalId is a string id (view-state), not a terminal reference.
    expect(store.getState().focusedTerminalId === null).toBe(true)
  })
})

describe('boardStore selectors — column grouping + per-column sort (AC-3)', () => {
  function seed(): ReturnType<typeof createBoardStore> {
    const store = createBoardStore({ now: () => FIXED_NOW })
    const st = store.getState()
    // working: entered at 100, 300, 200 → DESC = [300, 200, 100]
    st.applyWatchEvent(watchUpdated(1, 'w1', 'working', 100))
    st.applyWatchEvent(watchUpdated(1, 'w2', 'working', 300))
    st.applyWatchEvent(watchUpdated(1, 'w3', 'working', 200))
    // needs-you: entered at 500, 400 → ASC (longest-waiting first) = [400, 500]
    st.applyWatchEvent(watchUpdated(1, 'n1', 'needs-you', 500, { status: 'NeedsAttention' }))
    st.applyWatchEvent(watchUpdated(1, 'n2', 'needs-you', 400, { status: 'NeedsPermission' }))
    // idle: entered at 700, 600 → ASC = [600, 700]
    st.applyWatchEvent(watchUpdated(1, 'i1', 'idle', 700, { status: 'WaitingForInput' }))
    st.applyWatchEvent(watchUpdated(1, 'i2', 'idle', 600, { status: 'WaitingForInput' }))
    return store
  }

  it('working column is sorted DESC (most-recent on top)', () => {
    const state = seed().getState()
    expect(selectColumn(state, 'working', 'default', NO_FILTER).map((s) => s.id)).toEqual([
      'w2',
      'w3',
      'w1'
    ])
    expect(selectColumnCount(state, 'working', 'default', NO_FILTER)).toBe(3)
  })

  it('needs-you column is sorted ASC (longest-waiting on top)', () => {
    const state = seed().getState()
    expect(selectColumn(state, 'needs-you', 'default', NO_FILTER).map((s) => s.id)).toEqual([
      'n2',
      'n1'
    ])
    expect(selectColumnCount(state, 'needs-you', 'default', NO_FILTER)).toBe(2)
  })

  it('idle column is sorted ASC (longest-waiting on top)', () => {
    const state = seed().getState()
    expect(selectColumn(state, 'idle', 'default', NO_FILTER).map((s) => s.id)).toEqual(['i2', 'i1'])
    expect(selectColumnCount(state, 'idle', 'default', NO_FILTER)).toBe(2)
  })

  it('grouping is exact — every session is in exactly one column, none missing/duplicated (AC-1)', () => {
    const state = seed().getState()
    const ids = (['working', 'needs-you', 'idle'] as const).flatMap((c) =>
      selectColumn(state, c, 'default', NO_FILTER).map((s) => s.id)
    )
    expect(ids.sort()).toEqual(['i1', 'i2', 'n1', 'n2', 'w1', 'w2', 'w3'])
    expect(new Set(ids).size).toBe(ids.length) // no duplicates
  })
})

describe('boardStore — the engine-started cold-load contract (Story 5.3 / 6.4: watch:status clears the skeleton)', () => {
  it('setReconnecting(false) with NO prior deltas flips coldLoaded true (the ONLY skeleton-clear when no delta ever arrives)', () => {
    // The Story-6.4 native engine emits `CH.watchStatus { reconnecting: false }` at engine
    // start; the Board routes it here. On a fresh, no-launch start ZERO deltas ever ship —
    // this flip is the ONLY thing that clears the cold-load skeleton to the empty board.
    // FAULT-INJECTION: deleting the coldLoaded flip inside setReconnecting turns this red
    // (and the app's skeleton would hang forever on an empty cold start).
    const store = createBoardStore({ now: () => FIXED_NOW })
    // Non-vacuous: confirm coldLoaded starts false (no delta has arrived).
    expect(selectColdLoaded(store.getState())).toBe(false)
    expect(selectTotalCount(store.getState(), 'default', NO_FILTER)).toBe(0) // truly no sessions — empty cold start
    store.getState().setReconnecting(false)
    expect(selectColdLoaded(store.getState())).toBe(true)
  })

  it('the TWO-SHOT engine-started emit is idempotent — a repeat push changes NOTHING (no UI flap)', () => {
    // index.ts emits the signal twice (a lost first emit would strand the skeleton; the
    // consumer must make the repeat harmless). A second push on a cold-loaded store must
    // not produce a new state object (no re-render churn) and must not perturb anything.
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().setReconnecting(false)
    const afterFirst = store.getState()
    store.getState().setReconnecting(false)
    expect(store.getState()).toBe(afterFirst) // the exact same state reference — a true no-op
    expect(selectColdLoaded(store.getState())).toBe(true)
  })

  it('ANY watch:status push flips coldLoaded (the flag value is vestigial in the native engine)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    expect(selectColdLoaded(store.getState())).toBe(false)
    store.getState().setReconnecting(true) // never sent by the native engine, but must not strand the skeleton
    expect(selectColdLoaded(store.getState())).toBe(true)
  })

  it('the status push does NOT perturb the session projection (deltas own the map)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    const st = (): BoardState => store.getState()
    st().applyWatchEvent(watchUpdated(1, 'a', 'working', 100, { status: 'Working' }))
    st().setReconnecting(false)
    expect(st().sessionsById['a']?.column).toBe('working')
    expect(st().epoch).toBe(1)
    expect(selectColdLoaded(st())).toBe(true)
  })
})

describe('boardStore — the PINNED hero column (Needs-you always holds the center)', () => {
  it('HERO_COLUMN is needs-you', () => {
    expect(HERO_COLUMN).toBe('needs-you')
  })

  it('the hero is a module CONSTANT — no hero state, no swap bookkeeping, no mutator (AC-7, AC-8)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    const state = store.getState()
    const keys = Object.keys(state)
    // The retired Story-1.5 adaptive swap kept a committed `heroColumn` plus a
    // heroPendingSince/heroPendingTarget debounce pair and a `tickHero` action. ALL of it is
    // gone — the center cannot move, so there is nothing to debounce. If a swap is ever
    // reintroduced by accident, this is the assertion that turns red first.
    expect(keys.filter((k) => /hero/i.test(k))).toEqual([])
    // AC-8 still holds in the stronger form: no hero card list was ever denormalized.
    expect(keys.some((k) => /heroSessions|heroCards|heroList/i.test(k))).toBe(false)
    // NO-PIN (AC-7) also survives in the stronger form — there is no hero mutator at all.
    const actionNames = keys.filter(
      (k) => typeof (state as unknown as Record<string, unknown>)[k] === 'function'
    )
    expect(actionNames.some((k) => /hero/i.test(k))).toBe(false)
    // The feed-driven input is still there (this test is not passing on an empty store).
    expect(actionNames).toContain('applyWatchEvent')
  })
})
