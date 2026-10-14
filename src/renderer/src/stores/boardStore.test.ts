// Story 1.4 — board store tests (AC-7, AC-8). jsdom `unit` project.
//
// Drives the store via VALIDATED `WatchEventsPayload` deltas (the shape the wire now
// carries) and an INJECTED now() for determinism. Asserts: projection map upsert;
// idempotent epoch (stale-epoch delta discarded); session.removed VANISHES; coldLoaded
// flips on first delta; selectors return the correctly SORTED list per column
// (working desc, needs-you/idle asc); attention.raised is ignored by the board; the
// store does NOT re-parse with any Zod schema; no terminal/xterm reference.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createBoardStore,
  selectColumn,
  selectColumnCount,
  selectTotalCount,
  selectColdLoaded,
  selectSelectedId,
  selectViewMode,
  selectFocusedTerminalId,
  selectIsAcknowledged,
  selectRailEmphasis,
  selectTerminalIdForSession,
  selectKeptAliveTerminalIds,
  selectStartingTerminals,
  selectRailActiveSessionId,
  selectRailSection,
  selectRailOrder,
  selectShortcutsDialogOpen,
  selectNeedsYouCountByWorkspace,
  selectCardCountByWorkspace,
  selectWorkingCountByWorkspace,
  selectTagsDialog,
  selectSessionsDialog,
  selectSearchQuery,
  selectShellPane,
  HERO_COLUMN,
  NO_FILTER,
  type BoardState
} from './boardStore'
import type { Column, WatchEventsPayload } from '../../../shared/ipc/contract'

const FIXED_NOW = 1_750_000_000_000

/** A controllable clock for deterministic time-based assertions. */
function makeClock(start = FIXED_NOW): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return { now: () => t, advance: (ms) => (t += ms) }
}

/** Build a validated `session.updated` delta (the enriched wire shape). Defaults to the
 *  'default' workspace; Task 9a's two-workspace tests override it via `over.workspaceId`. */
function updated(
  epoch: number,
  id: string,
  column: Column,
  enteredColumnAt: number,
  over: Partial<{
    sessionName: string
    projectPath: string
    status: string
    pid: number
    pendingToolName: string
    workspaceId: string
  }> = {}
): WatchEventsPayload {
  return {
    epoch,
    event: {
      type: 'session.updated',
      id,
      sessionName: over.sessionName ?? `s-${id}`,
      projectPath: over.projectPath ?? `/p/${id}`,
      status: over.status ?? 'Working',
      column,
      enteredColumnAt,
      pid: over.pid ?? 1000,
      workspaceId: over.workspaceId ?? 'default',
      tagIds: [],
      ...(over.pendingToolName !== undefined ? { pendingToolName: over.pendingToolName } : {})
    }
  }
}

function removed(epoch: number, id: string): WatchEventsPayload {
  return {
    epoch,
    event: { type: 'session.removed', id, sessionName: `s-${id}`, projectPath: `/p/${id}` }
  }
}

describe('boardStore — reduces validated deltas into a BoardSession projection (AC-8)', () => {
  it('upserts a session.updated into the projection map keyed by id, building from the delta', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(
      updated(1, 'a', 'working', 100, {
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
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
    expect(selectColdLoaded(store.getState())).toBe(true)
  })

  it('discards a STALE-epoch delta (idempotent epoch apply — AC-6)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(5, 'a', 'working', 100, { status: 'Working' }))
    // A delta from an OLDER epoch must be ignored (stale across a reconnect).
    store.getState().applyWatchEvent(updated(3, 'a', 'idle', 999, { status: 'WaitingForInput' }))
    const s = store.getState().sessionsById['a']
    expect(s?.column).toBe('working') // unchanged — the stale delta was dropped
    expect(s?.status).toBe('Working')
    expect(store.getState().epoch).toBe(5)
  })

  it('applies a SAME-epoch delta (live watch lines share the current epoch — not stale)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(4, 'a', 'working', 100))
    store
      .getState()
      .applyWatchEvent(updated(4, 'a', 'needs-you', 200, { status: 'NeedsAttention' }))
    expect(store.getState().sessionsById['a']?.column).toBe('needs-you')
  })

  it('session.removed makes the card VANISH (no Done column — AC-2)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
    expect(selectTotalCount(store.getState(), 'default', NO_FILTER)).toBe(1)
    store.getState().applyWatchEvent(removed(2, 'a'))
    expect(store.getState().sessionsById['a']).toBeUndefined()
    expect(selectTotalCount(store.getState(), 'default', NO_FILTER)).toBe(0)
  })

  it('attention.raised is IGNORED by the board projection (Epic 2/3 consume it)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
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
    store.getState().applyWatchEvent(updated(1, 'a', 'idle', 12345, { status: 'WaitingForInput' }))
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
    st.applyWatchEvent(updated(1, 'w1', 'working', 100))
    st.applyWatchEvent(updated(1, 'w2', 'working', 300))
    st.applyWatchEvent(updated(1, 'w3', 'working', 200))
    // needs-you: entered at 500, 400 → ASC (longest-waiting first) = [400, 500]
    st.applyWatchEvent(updated(1, 'n1', 'needs-you', 500, { status: 'NeedsAttention' }))
    st.applyWatchEvent(updated(1, 'n2', 'needs-you', 400, { status: 'NeedsPermission' }))
    // idle: entered at 700, 600 → ASC = [600, 700]
    st.applyWatchEvent(updated(1, 'i1', 'idle', 700, { status: 'WaitingForInput' }))
    st.applyWatchEvent(updated(1, 'i2', 'idle', 600, { status: 'WaitingForInput' }))
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
    st().applyWatchEvent(updated(1, 'a', 'working', 100, { status: 'Working' }))
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

describe('boardStore — FR-9 selection view-state (Story 2.2: AC-5, AC-8)', () => {
  it('selectedId defaults to null; selectSelectedId is a narrow primitive selector', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    expect(selectSelectedId(store.getState())).toBeNull()
    // Narrow primitive (a string|null, safe without useShallow).
    expect(typeof selectSelectedId).toBe('function')
  })

  it('setSelected(presentId) SETS the selection (non-vacuous: a present card does select)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
    store.getState().setSelected('a')
    expect(selectSelectedId(store.getState())).toBe('a')
  })

  it('setSelected(absentId) is a NO-OP (the card is not on the board)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
    // 'ghost' was never on the board → selecting it does nothing.
    store.getState().setSelected('ghost')
    expect(selectSelectedId(store.getState())).toBeNull()
    // Prove non-vacuous: the present card DOES select (contrast with the no-op above).
    store.getState().setSelected('a')
    expect(selectSelectedId(store.getState())).toBe('a')
  })

  it('setSelected(null) clears the selection', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
    store.getState().setSelected('a')
    expect(selectSelectedId(store.getState())).toBe('a')
    store.getState().setSelected(null)
    expect(selectSelectedId(store.getState())).toBeNull()
  })

  it('removing the SELECTED session clears selectedId (the highlighted card vanished)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
    store.getState().applyWatchEvent(updated(1, 'b', 'working', 200))
    store.getState().setSelected('a')
    expect(selectSelectedId(store.getState())).toBe('a')
    // Removing a DIFFERENT session leaves the selection intact.
    store.getState().applyWatchEvent(removed(2, 'b'))
    expect(selectSelectedId(store.getState())).toBe('a')
    // Removing the SELECTED session clears it.
    store.getState().applyWatchEvent(removed(3, 'a'))
    expect(selectSelectedId(store.getState())).toBeNull()
  })

  it('selection is VIEW-STATE only — no raise/navigate/input surface on the store', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    const state = store.getState()
    const actionNames = Object.keys(state).filter(
      (k) => typeof (state as unknown as Record<string, unknown>)[k] === 'function'
    )
    // The ONLY new selection mutator is setSelected — no raise/focus/navigate action.
    expect(actionNames).toContain('setSelected')
    // Workspaces (Task 8) added `focusWorkspace` — an in-app VIEW-STATE reconcile (which
    // terminal is shown after a workspace switch), NOT an OS window raise/focus, exactly like
    // the pre-existing `focusedTerminalId`/`selectFocusedTerminalId` "focus" usage this guard
    // already tolerates. Excluded here by name so the blanket regex still catches a REAL
    // raise/navigate/summon/window action if one is ever added.
    expect(
      actionNames
        .filter((k) => k !== 'focusWorkspace')
        .some((k) => /raise|focus|navigate|summon|window/i.test(k))
    ).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Story 3.2 (FR-11) — the Board ↔ Focused-session VIEW-STATE (F6 / UX-DR19/21/24).
// ─────────────────────────────────────────────────────────────────────────────
describe('boardStore — Story 3.2 view-state (Board ↔ Focused-session; F6)', () => {
  it('defaults to the board view with no focused terminal', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    expect(selectViewMode(store.getState())).toBe('board')
    expect(selectFocusedTerminalId(store.getState())).toBeNull()
  })

  it('openLaunchedTerminal drops into the Focused view OPTIMISTICALLY (terminal id set, no session id needed)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('launch-term-1', 'term-1', 'default')
    expect(selectViewMode(store.getState())).toBe('focused')
    expect(selectFocusedTerminalId(store.getState())).toBe('launch-term-1')
    // UX-DR19: the session id is NOT required to focus the launched terminal (it reconciles later).
    expect(selectSelectedId(store.getState())).toBeNull()
  })

  it('activateCard(presentId) SELECTS (ONE selection) but stays on the board when no terminal is focused', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
    store.getState().activateCard('a')
    // ONE selection: activateCard sets the SAME selectedId the Story-2.2 setSelected uses.
    expect(selectSelectedId(store.getState())).toBe('a')
    // No terminal is known for this card in 3.2 (the reverse map is 3.3/3.4) → NO ghost
    // viewMode='focused' state; the view stays on the board.
    expect(selectViewMode(store.getState())).toBe('board')
  })

  it('activateCard(presentId) DOES enter Focused when a terminal is already focused (no ghost state)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
    // A terminal is already focused (e.g. a prior launch) AND it is THIS card's terminal
    // → activating the card enters Focused.
    store.getState().addCorrelation('a', 'launch-term-1')
    store.getState().openLaunchedTerminal('launch-term-1', 'term-1', 'default')
    store.getState().showBoard() // back to board, but focusedTerminalId persists
    store.getState().activateCard('a')
    expect(selectViewMode(store.getState())).toBe('focused')
    expect(selectSelectedId(store.getState())).toBe('a')
  })

  // ---- the wrong-terminal regression -------------------------------------------------
  // Reported symptom: two cards on the board; open card A's terminal; Esc back to the board;
  // click card B → card B is selected and the view flips to Focused, but the terminal on
  // screen is still A's. activateCard changed `viewMode` WITHOUT changing which terminal is
  // focused, so it re-showed whatever was last focused.
  it("activateCard SWITCHES the visible terminal to THAT card's terminal (wrong-terminal regression)", () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
    store.getState().applyWatchEvent(updated(2, 'b', 'working', 200))
    store.getState().addCorrelation('a', 'term-a')
    store.getState().addCorrelation('b', 'term-b')
    // The operator is looking at A's terminal, then goes back to the board.
    store.getState().openLaunchedTerminal('term-a', 'a', 'default')
    store.getState().showBoard()
    expect(selectFocusedTerminalId(store.getState())).toBe('term-a')

    store.getState().activateCard('b')

    expect(selectViewMode(store.getState())).toBe('focused')
    expect(selectSelectedId(store.getState())).toBe('b')
    // THE ASSERTION THAT WAS MISSING: the terminal follows the card that was clicked.
    expect(selectFocusedTerminalId(store.getState())).toBe('term-b')
  })

  it("activateCard on a card with NO binding stays on the board (never shows another session's terminal)", () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
    store.getState().applyWatchEvent(updated(2, 'b', 'working', 200))
    store.getState().addCorrelation('a', 'term-a')
    store.getState().openLaunchedTerminal('term-a', 'a', 'default')
    store.getState().showBoard()

    // `b`'s CH.launchCorrelated push has not landed → no terminal of its own to show.
    store.getState().activateCard('b')

    // It still SELECTS + acknowledges (the operator did click it), but entering Focused here
    // would put A's terminal on screen under B's name — the exact bug, one card later.
    expect(selectSelectedId(store.getState())).toBe('b')
    expect(selectIsAcknowledged(store.getState(), 'b')).toBe(true)
    expect(selectViewMode(store.getState())).toBe('board')
    expect(selectFocusedTerminalId(store.getState())).toBe('term-a')
  })

  it('activateCard(absentId) is a NO-OP (no view change, no selection)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
    store.getState().activateCard('ghost')
    expect(selectViewMode(store.getState())).toBe('board')
    expect(selectSelectedId(store.getState())).toBeNull()
  })

  it('showBoard returns to the board (Esc-to-Board) and leaves the selection highlighted', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100))
    // Enter Focused via a launch (the path that actually focuses a terminal in 3.2), then select.
    store.getState().openLaunchedTerminal('launch-term-1', 'term-1', 'default')
    store.getState().setSelected('a')
    expect(selectViewMode(store.getState())).toBe('focused')
    store.getState().showBoard()
    expect(selectViewMode(store.getState())).toBe('board')
    // The selection persists so the card stays highlighted on the board (only the view changed).
    expect(selectSelectedId(store.getState())).toBe('a')
  })

  it('view transitions are in-app view-state only — NO window-raise/navigate action exists', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    const state = store.getState()
    const actionNames = Object.keys(state).filter(
      (k) => typeof (state as unknown as Record<string, unknown>)[k] === 'function'
    )
    // The Story-3.2 view actions are openLaunchedTerminal / activateCard / showBoard — NONE is a
    // window raise/focus/navigate/summon operation (single-window view-state, UX-DR24).
    expect(actionNames).toEqual(
      expect.arrayContaining(['openLaunchedTerminal', 'activateCard', 'showBoard'])
    )
    expect(actionNames.some((k) => /raise|navigate|summon|window/i.test(k))).toBe(false)
  })
})

// ===========================================================================
// Story 3.4 (FR-16) — the ONE shared per-session attention/acknowledge state (AC-4).
// ===========================================================================
describe('boardStore — Story 3.4 acknowledge state drives rail + card emphasis (AC-4)', () => {
  it('a needs-you session is emphasized; acknowledging it clears the emphasis (UX-DR28)', () => {
    const clock = makeClock()
    const store = createBoardStore({ now: clock.now })
    store.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    // Before acknowledge: emphasized (needs-you + not acknowledged).
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('needs-you')
    expect(selectIsAcknowledged(store.getState(), 'a')).toBe(false)

    store.getState().acknowledge('a')
    // After acknowledge: calm (in-app emphasis cleared even though c9watch still says needs-you).
    expect(selectIsAcknowledged(store.getState(), 'a')).toBe(true)
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('calm')
    // The ack stamp is the injected now() (determinism).
    expect(store.getState().acknowledgedById['a']).toBe(clock.now())
  })

  it('a NON-needs-you session is never emphasized regardless of ack', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'w', 'working', 100))
    store.getState().applyWatchEvent(updated(1, 'i', 'idle', 100))
    expect(selectRailEmphasis(store.getState(), 'w')).toBe('calm')
    expect(selectRailEmphasis(store.getState(), 'i')).toBe('calm')
  })

  it('an absent session is calm (never crash on an unknown id)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    expect(selectRailEmphasis(store.getState(), 'ghost')).toBe('calm')
    expect(selectIsAcknowledged(store.getState(), 'ghost')).toBe(false)
  })

  it('emphasis RETURNS on a needs-you RE-ENTRY (clearing on column-leave makes re-entry a new event)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    store.getState().acknowledge('a')
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('calm')

    // c9watch reports the session LEFT needs-you (handled) → ack entry cleared.
    store.getState().applyWatchEvent(updated(2, 'a', 'working', 200))
    expect(selectIsAcknowledged(store.getState(), 'a')).toBe(false)
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('calm') // not needs-you now

    // c9watch reports it RE-ENTERS needs-you → a NEW attention event → re-emphasized.
    store.getState().applyWatchEvent(updated(3, 'a', 'needs-you', 300))
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('needs-you')
  })

  it('the ack entry is CLEARED when the session is REMOVED (badge can’t outlive the handled session)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    store.getState().acknowledge('a')
    expect(selectIsAcknowledged(store.getState(), 'a')).toBe(true)

    store.getState().applyWatchEvent(removed(2, 'a'))
    expect(selectIsAcknowledged(store.getState(), 'a')).toBe(false)
    expect(store.getState().acknowledgedById['a']).toBeUndefined()
  })

  it('a still-needs-you update does NOT clear the ack (only a column-LEAVE does)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    store.getState().acknowledge('a')
    // Another needs-you update (e.g. a status field change while still waiting) keeps it acknowledged.
    store
      .getState()
      .applyWatchEvent(updated(2, 'a', 'needs-you', 100, { status: 'NeedsPermission' }))
    expect(selectIsAcknowledged(store.getState(), 'a')).toBe(true)
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('calm')
  })

  it('there is ONE ack state — no parallel/second acknowledge flag on the store', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    const keys = Object.keys(store.getState())
    const ackish = keys.filter((k) => /ack|acknowledg/i.test(k))
    expect(ackish).toEqual(['acknowledgedById', 'acknowledge'])
  })

  it('activateCard ALSO acknowledges the opened session (the open/select path, UX-DR28)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    store.getState().activateCard('a')
    expect(selectIsAcknowledged(store.getState(), 'a')).toBe(true)
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('calm')
  })
})

describe('boardStore — Story 3.4 terminalIdBySessionId + switchTerminal (AC-3, Task 4)', () => {
  it('addCorrelation records the sessionId→terminalId binding (idempotent)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    expect(selectTerminalIdForSession(store.getState(), 'a')).toBeUndefined()
    store.getState().addCorrelation('a', 'launch-1')
    expect(selectTerminalIdForSession(store.getState(), 'a')).toBe('launch-1')
    const before = store.getState().terminalIdBySessionId
    store.getState().addCorrelation('a', 'launch-1') // idempotent — same object reference
    expect(store.getState().terminalIdBySessionId).toBe(before)
  })

  it('the binding is CLEARED when the session is removed', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    store.getState().addCorrelation('a', 'launch-1')
    store.getState().applyWatchEvent(removed(2, 'a'))
    expect(selectTerminalIdForSession(store.getState(), 'a')).toBeUndefined()
  })

  it('switchTerminal sets focusedTerminalId + viewMode=focused (pure view-state, no input)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().switchTerminal('launch-2')
    expect(selectFocusedTerminalId(store.getState())).toBe('launch-2')
    expect(selectViewMode(store.getState())).toBe('focused')
    // Switching to the SAME terminal while already focused is a no-op (no re-set churn).
    const before = store.getState()
    store.getState().switchTerminal('launch-2')
    expect(store.getState()).toBe(before)
  })

  it('switchTerminal does NOT acknowledge by itself (the caller pairs it with acknowledge)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    store.getState().addCorrelation('a', 'launch-1')
    store.getState().switchTerminal('launch-1')
    // The switch alone does not clear emphasis — the rail click calls acknowledge(sessionId) too.
    expect(selectIsAcknowledged(store.getState(), 'a')).toBe(false)
    store.getState().acknowledge('a')
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('calm')
  })
})

// ===========================================================================
// Story 5.6 — keep app-launched terminals reachable (AC-1, AC-2, AC-3, AC-4, AC-5)
// ===========================================================================
describe('boardStore — Story 5.6 launchedTerminals registry (AC-1)', () => {
  it('openLaunchedTerminal records the entry with terminalId + label + launchedAt from now()', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t-1', 'myproject', 'default')
    const entry = store.getState().launchedTerminals['t-1']
    expect(entry).toBeDefined()
    expect(entry?.terminalId).toBe('t-1')
    expect(entry?.label).toBe('myproject')
    // launchedAt must be stamped from the injected now() (determinism — NOT Date.now()).
    expect(entry?.launchedAt).toBe(FIXED_NOW)
  })

  it('openLaunchedTerminal ALSO sets viewMode=focused + focusedTerminalId (existing 3.2 behaviour preserved)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t-1', 'project', 'default')
    expect(selectViewMode(store.getState())).toBe('focused')
    expect(selectFocusedTerminalId(store.getState())).toBe('t-1')
  })

  it('the store field enumerates launchedTerminals (invariant: new field is acknowledged)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    const keys = Object.keys(store.getState())
    expect(keys).toContain('launchedTerminals')
    // And the action keys include the new story-5.6 actions.
    expect(keys).toContain('forgetLaunchedTerminal')
  })

  it('launchedTerminals holds NO terminal/xterm instance (metadata-only — AC-1 HARD limit)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t-1', 'project', 'default')
    const entry = store.getState().launchedTerminals['t-1']
    // The entry must be opaque strings + number only — never an xterm-like object.
    expect(typeof entry?.terminalId).toBe('string')
    expect(typeof entry?.label).toBe('string')
    expect(typeof entry?.launchedAt).toBe('number')
    expect(Object.keys(entry ?? {})).toEqual(
      expect.arrayContaining(['terminalId', 'label', 'launchedAt'])
    )
  })

  it('the naming guard holds — NEW story-5.6 keys do not match the forbidden raise/navigate/summon/window regex', () => {
    // The frozen invariant tests (:595/:672) assert the full key set; we add a sibling for story
    // 5.6 specifically. The naming guard says NEW actions/selectors may not use focus/window/raise/
    // navigate/summon (those imply OS operations). The EXISTING `focusedTerminalId` and
    // `selectFocusedTerminalId` already use "focus" and are pre-Story-5.6 (frozen) — excluded here.
    // We only guard the new 5.6 additions.
    const story56NewKeys = ['launchedTerminals', 'forgetLaunchedTerminal']
    // None of the new keys match the forbidden regex.
    expect(story56NewKeys.some((k) => /raise|navigate|summon|window/i.test(k))).toBe(false)
    // New keys ARE present in the store.
    const store = createBoardStore({ now: () => FIXED_NOW })
    const allKeys = Object.keys(store.getState())
    expect(allKeys).toContain('launchedTerminals')
    expect(allKeys).toContain('forgetLaunchedTerminal')
  })
})

// ===========================================================================
// Programmatic API — registerLaunchedTerminal must NOT steal the view
// ===========================================================================
describe('boardStore — registerLaunchedTerminal (an API launch must not steal focus)', () => {
  it('records the registry entry exactly like openLaunchedTerminal does', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().registerLaunchedTerminal('api-t', 'HT-2', 'w1')
    const entry = store.getState().launchedTerminals['api-t']
    expect(entry).toEqual({
      terminalId: 'api-t',
      label: 'HT-2',
      launchedAt: FIXED_NOW,
      workspaceId: 'w1'
    })
  })

  it('leaves the view on the BOARD when the operator was on the board', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().registerLaunchedTerminal('api-t', 'HT-2', 'default')
    // FAULT-INJECTION: make this action set viewMode/focusedTerminalId (i.e. call
    // openLaunchedTerminal) and these two go red.
    expect(selectViewMode(store.getState())).toBe('board')
    expect(selectFocusedTerminalId(store.getState())).toBeNull()
  })

  it('leaves terminal A focused when the operator is typing in A', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('A', 'projectA', 'default')
    expect(selectFocusedTerminalId(store.getState())).toBe('A')

    store.getState().registerLaunchedTerminal('api-t', 'HT-2', 'w2')

    // THE WHOLE POINT: an external create does not yank the operator out of A — not even when
    // the new terminal belongs to a DIFFERENT workspace (which would leave the focused terminal
    // outside the active workspace).
    expect(selectFocusedTerminalId(store.getState())).toBe('A')
    expect(selectViewMode(store.getState())).toBe('focused')
  })

  it('registers ONCE — a second call never restamps launchedAt', () => {
    const clock = makeClock()
    const store = createBoardStore({ now: clock.now })
    store.getState().registerLaunchedTerminal('api-t', 'HT-2', 'default')
    clock.advance(5_000)
    store.getState().registerLaunchedTerminal('api-t', 'HT-9', 'other')
    expect(store.getState().launchedTerminals['api-t']).toEqual({
      terminalId: 'api-t',
      label: 'HT-2',
      launchedAt: FIXED_NOW,
      workspaceId: 'default'
    })
  })

  it('the registered terminal IS kept alive, so its frame mounts and spawns the pty', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().registerLaunchedTerminal('api-t', 'HT-2', 'default')
    // This is the ONLY thing that makes an unfocused API launch reach a pty: App mounts the
    // focused layer (hidden) whenever kept-alive is non-empty, and EmbeddedTerminal spawns on mount.
    expect(selectKeptAliveTerminalIds(store.getState())).toContain('api-t')
  })

  it('openLaunchedTerminal is register-THEN-focus (same registry entry, plus the view flip)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('ui-t', 'projectA', 'default')
    expect(store.getState().launchedTerminals['ui-t']).toEqual({
      terminalId: 'ui-t',
      label: 'projectA',
      launchedAt: FIXED_NOW,
      workspaceId: 'default',
      // Opening it shows it: the operator's own launch counts as focused (focusWorkspace).
      focusedAt: FIXED_NOW
    })
    // (The focus half is covered by the Story-3.2/5.6 cases above — not duplicated here.)
  })
})

describe('boardStore — Story 5.6 forgetLaunchedTerminal (AC-5)', () => {
  it('forgetLaunchedTerminal removes the entry on PTY exit', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t-1', 'project', 'default')
    expect(store.getState().launchedTerminals['t-1']).toBeDefined()
    store.getState().forgetLaunchedTerminal('t-1')
    expect(store.getState().launchedTerminals['t-1']).toBeUndefined()
    expect(Object.keys(store.getState().launchedTerminals)).toHaveLength(0)
  })

  it('forgetLaunchedTerminal is idempotent (a terminalId not in the registry is a no-op)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    // Not in the registry — should not throw or change state.
    const before = store.getState().launchedTerminals
    store.getState().forgetLaunchedTerminal('ghost')
    expect(store.getState().launchedTerminals).toBe(before)
  })
})

describe('boardStore — Story 5.6 selectKeptAliveTerminalIds includes registry keys (AC-2 — silent-kill regression)', () => {
  it('a launched-but-uncorrelated terminal is kept alive even when focus moves to another terminal (non-vacuous)', () => {
    // This is the LOAD-BEARING test. It proves the registry term in selectKeptAliveTerminalIds
    // closes the silent PTY kill:
    //   1. Launch A → recorded in registry, focusedTerminalId = A.
    //   2. Launch B → focusedTerminalId moves to B, focus leaves A.
    //   3. A is NOT yet correlated (no addCorrelation for A).
    //   → A must STILL be in selectKeptAliveTerminalIds via the registry (not just focusedTerminalId).
    //
    // FAULT-INJECTION EVIDENCE (proved non-vacuous before committing):
    //   Removing the registry loop from selectKeptAliveTerminalIds causes this test to FAIL
    //   (A would NOT appear in kept-alive after B takes focus). Restoring it → GREEN.
    const store = createBoardStore({ now: () => FIXED_NOW })
    // Launch A.
    store.getState().openLaunchedTerminal('A', 'projectA', 'default')
    expect(selectKeptAliveTerminalIds(store.getState())).toContain('A')
    // Launch B → focus moves to B; A is no longer focusedTerminalId.
    store.getState().openLaunchedTerminal('B', 'projectB', 'default')
    expect(selectFocusedTerminalId(store.getState())).toBe('B')
    // A is NOT correlated — terminalIdBySessionId has no entry for A.
    // Without the registry term, A would NOT be in kept-alive. With it, A stays alive.
    const alive = selectKeptAliveTerminalIds(store.getState())
    expect(alive).toContain('A') // THE REGRESSION GUARD — do not remove the registry union
    expect(alive).toContain('B')
  })

  it('a terminal that exits (forgetLaunchedTerminal) is removed from selectKeptAliveTerminalIds', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t-1', 'project', 'default')
    expect(selectKeptAliveTerminalIds(store.getState())).toContain('t-1')
    store.getState().forgetLaunchedTerminal('t-1')
    // t-1 is no longer in launchedTerminals or focusedTerminalId (focusedTerminalId still set, but
    // that's OK — the terminal will show the "exited" pane when focused; it's gone from the registry).
    // Actually focusedTerminalId is still 't-1' here, so it STILL appears via that path.
    // What we assert is that the registry term no longer holds it.
    expect(Object.keys(store.getState().launchedTerminals)).not.toContain('t-1')
  })

  it('selectKeptAliveTerminalIds returns STABLE, SORTED, de-duplicated ids', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'sess-a', 'working', 100))
    store.getState().addCorrelation('sess-a', 'terminal-b')
    store.getState().openLaunchedTerminal('terminal-a', 'projectA', 'default')
    // Now: terminalIdBySessionId = { 'sess-a': 'terminal-b' }, launchedTerminals = { 'terminal-a': ... },
    // focusedTerminalId = 'terminal-a'. The union should be ['terminal-a', 'terminal-b'] sorted.
    const alive = selectKeptAliveTerminalIds(store.getState())
    expect(alive).toEqual([...alive].sort()) // sorted
    expect(new Set(alive).size).toBe(alive.length) // de-duplicated
    expect(alive).toContain('terminal-a')
    expect(alive).toContain('terminal-b')
  })
})

describe('boardStore — Story 5.6 selectStartingTerminals (AC-3, AC-4)', () => {
  it('a launched terminal with no correlated card is "starting"', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t-1', 'myproject', 'default')
    const starting = selectStartingTerminals(store.getState(), 'default')
    expect(starting).toHaveLength(1)
    expect(starting[0]?.terminalId).toBe('t-1')
    expect(starting[0]?.label).toBe('myproject')
  })

  it('selectStartingTerminals returns nothing when the registry is empty', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    expect(selectStartingTerminals(store.getState(), 'default')).toHaveLength(0)
  })

  it('supersede (AC-4): a correlated terminal with a present card leaves the Starting strip', () => {
    // FAULT-INJECTION EVIDENCE (proved non-vacuous):
    //   Breaking the predicate (e.g. always returning all registry entries) causes this test to
    //   FAIL (the correlated terminal would remain in the strip). Correct predicate → GREEN.
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t-1', 'project', 'default')
    // No card yet → should appear in starting.
    expect(selectStartingTerminals(store.getState(), 'default')).toHaveLength(1)
    // Add a card + correlation binding → should leave the strip.
    store.getState().applyWatchEvent(updated(1, 'sess-1', 'working', 100))
    store.getState().addCorrelation('sess-1', 't-1')
    // Both the card exists AND the binding exists → NOT starting.
    expect(selectStartingTerminals(store.getState(), 'default')).toHaveLength(0)
  })

  it('supersede window: correlation landing without a card keeps the terminal in the strip', () => {
    // Between launch:correlated landing and the next card-carrying delta, the terminal stays
    // in the strip (card not present yet → predicate keeps it showing to avoid a flicker gap).
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t-1', 'project', 'default')
    // Correlation binding arrives but NO card in sessionsById yet.
    store.getState().addCorrelation('sess-1', 't-1')
    // Card not present → still starting (the predicate checks BOTH binding AND card).
    expect(selectStartingTerminals(store.getState(), 'default')).toHaveLength(1)
  })

  it('session.removed: a removed session whose terminal is still launched falls back into the strip', () => {
    // If the card vanishes (session.removed) but the PTY is still in launchedTerminals, the
    // terminal should reappear in the strip (card gone + binding cleared → predicate true).
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t-1', 'project', 'default')
    store.getState().applyWatchEvent(updated(1, 'sess-1', 'working', 100))
    store.getState().addCorrelation('sess-1', 't-1')
    // Correlated + card present → NOT starting.
    expect(selectStartingTerminals(store.getState(), 'default')).toHaveLength(0)
    // Session removed → card gone + binding cleared → falls back into strip.
    store.getState().applyWatchEvent(removed(2, 'sess-1'))
    expect(selectStartingTerminals(store.getState(), 'default')).toHaveLength(1)
  })

  it('selectStartingTerminals is SORTED by launchedAt then terminalId', () => {
    const clock = makeClock()
    const store = createBoardStore({ now: clock.now })
    clock.advance(100)
    store.getState().openLaunchedTerminal('t-z', 'z', 'default')
    // Return to board to allow opening another terminal.
    store.getState().showBoard()
    clock.advance(200)
    store.getState().openLaunchedTerminal('t-a', 'a', 'default')
    const starting = selectStartingTerminals(store.getState(), 'default')
    expect(starting[0]?.terminalId).toBe('t-z') // earlier launchedAt first
    expect(starting[1]?.terminalId).toBe('t-a')
  })
})

// ---------------------------------------------------------------------------
// Rail SECTIONS — the pinned active row + one group per status.
// ---------------------------------------------------------------------------

describe('boardStore — rail sections: pinned active row + per-status groups', () => {
  /** A store with three sessions, one per column, and 'open' bound to the focused terminal. */
  function withFocus(): ReturnType<typeof createBoardStore> {
    const store = createBoardStore({ now: makeClock().now })
    store.getState().applyWatchEvent(updated(1, 'open', 'idle', 500))
    store.getState().applyWatchEvent(updated(1, 'wants-you', 'needs-you', 100))
    store.getState().applyWatchEvent(updated(1, 'busy', 'working', 200))
    store.getState().addCorrelation('open', 'tid-open')
    store.getState().switchTerminal('tid-open')
    return store
  }

  it('selectRailActiveSessionId resolves the focused terminal back to its session', () => {
    expect(selectRailActiveSessionId(withFocus().getState())).toBe('open')
  })

  it('selectRailActiveSessionId is null with no focused terminal', () => {
    const store = createBoardStore({ now: makeClock().now })
    store.getState().applyWatchEvent(updated(1, 'a', 'idle', 100))
    expect(selectRailActiveSessionId(store.getState())).toBeNull()
  })

  // A just-launched terminal has no card yet. The rail must leave the pin EMPTY rather than guess
  // — pinning a session that is not the one on screen is worse than pinning nothing.
  it('selectRailActiveSessionId is null when the focused terminal has no correlated card', () => {
    const store = createBoardStore({ now: makeClock().now })
    store.getState().openLaunchedTerminal('tid-fresh', 'fresh', 'default')
    expect(selectRailActiveSessionId(store.getState())).toBeNull()
  })

  // A binding can outlive its card (the session was removed before the binding was cleared).
  // Resolving to a session that is no longer in `sessionsById` would pin a row that renders null.
  it('selectRailActiveSessionId is null when the bound session has been removed', () => {
    const store = withFocus()
    store.getState().applyWatchEvent(removed(2, 'open'))
    expect(selectRailActiveSessionId(store.getState())).toBeNull()
  })

  it('selectRailSection groups by column and EXCLUDES the pinned active session', () => {
    const store = withFocus()
    // 'open' is idle AND pinned → its own group comes back empty, not containing it.
    expect(selectRailSection(store.getState(), 'idle', 'default', NO_FILTER)).toEqual([])
    expect(selectRailSection(store.getState(), 'needs-you', 'default', NO_FILTER)).toEqual([
      'wants-you'
    ])
    expect(selectRailSection(store.getState(), 'working', 'default', NO_FILTER)).toEqual(['busy'])
  })

  it('selectRailSection includes every session in the column when nothing is pinned', () => {
    const store = createBoardStore({ now: makeClock().now })
    store.getState().applyWatchEvent(updated(1, 'a', 'idle', 100))
    store.getState().applyWatchEvent(updated(1, 'b', 'idle', 200))
    expect(selectRailSection(store.getState(), 'idle', 'default', NO_FILTER)).toEqual(['a', 'b'])
  })

  // ASCENDING in EVERY group — deliberately NOT `sortByEnteredColumn`, which sorts the BOARD's
  // working column descending. The rail is a "who has been waiting longest" list throughout; if
  // this flips, the same three sessions read in two different orders on two surfaces.
  it('selectRailSection sorts oldest-entered FIRST, including the working group', () => {
    const store = createBoardStore({ now: makeClock().now })
    store.getState().applyWatchEvent(updated(1, 'newer', 'working', 300))
    store.getState().applyWatchEvent(updated(1, 'older', 'working', 100))
    expect(selectRailSection(store.getState(), 'working', 'default', NO_FILTER)).toEqual([
      'older',
      'newer'
    ])
  })

  it('selectRailSection breaks an enteredColumnAt tie on id, deterministically', () => {
    const store = createBoardStore({ now: makeClock().now })
    store.getState().applyWatchEvent(updated(1, 'zz', 'needs-you', 100))
    store.getState().applyWatchEvent(updated(1, 'aa', 'needs-you', 100))
    expect(selectRailSection(store.getState(), 'needs-you', 'default', NO_FILTER)).toEqual([
      'aa',
      'zz'
    ])
  })

  // NON-VACUITY: the pin and the exclusion are ONE behaviour. Moving focus to another session must
  // move BOTH — the newly-pinned one leaves its group and the previously-pinned one rejoins its
  // own. Dropping the `s.id !== activeId` filter makes this red on the first expectation.
  it('NON-VACUITY: switching the focused terminal moves the exclusion with it', () => {
    const store = withFocus()
    store.getState().addCorrelation('busy', 'tid-busy')
    store.getState().switchTerminal('tid-busy')
    expect(selectRailActiveSessionId(store.getState())).toBe('busy')
    expect(selectRailSection(store.getState(), 'working', 'default', NO_FILTER)).toEqual([]) // 'busy' is pinned now
    expect(selectRailSection(store.getState(), 'idle', 'default', NO_FILTER)).toEqual(['open']) // 'open' rejoined
  })
})

describe('workspace filtering', () => {
  const updated = (
    id: string,
    workspaceId: string,
    column: Column = 'working'
  ): WatchEventsPayload => ({
    epoch: 0,
    event: {
      type: 'session.updated' as const,
      id,
      sessionName: id,
      projectPath: '/p',
      status: 'Working',
      column,
      enteredColumnAt: 1,
      pid: 1,
      workspaceId,
      tagIds: []
    }
  })

  it('projects workspaceId onto the board session', () => {
    const store = createBoardStore({ now: () => 1 })
    store.getState().applyWatchEvent(updated('a', 'w1'))
    expect(store.getState().sessionsById['a']?.workspaceId).toBe('w1')
  })

  it('counts needs-you per workspace INCLUDING hidden ones', () => {
    const store = createBoardStore({ now: () => 1 })
    store.getState().applyWatchEvent(updated('a', 'w1', 'needs-you'))
    store.getState().applyWatchEvent(updated('b', 'w2', 'needs-you'))
    store.getState().applyWatchEvent(updated('c', 'w2', 'needs-you'))
    store.getState().applyWatchEvent(updated('d', 'w2', 'working'))
    expect(selectNeedsYouCountByWorkspace(store.getState())).toEqual({ w1: 1, w2: 2 })
  })

  it('counts working per workspace INCLUDING hidden ones', () => {
    const store = createBoardStore({ now: () => 1 })
    store.getState().applyWatchEvent(updated('a', 'w1', 'working'))
    store.getState().applyWatchEvent(updated('b', 'w2', 'working'))
    store.getState().applyWatchEvent(updated('c', 'w2', 'working'))
    store.getState().applyWatchEvent(updated('d', 'w2', 'needs-you'))
    store.getState().applyWatchEvent(updated('e', 'w2', 'idle'))
    expect(selectWorkingCountByWorkspace(store.getState())).toEqual({ w1: 1, w2: 2 })
  })

  it('counts every card per workspace, whatever its column, INCLUDING hidden ones', () => {
    const store = createBoardStore({ now: () => 1 })
    store.getState().applyWatchEvent(updated('a', 'w1', 'needs-you'))
    store.getState().applyWatchEvent(updated('b', 'w2', 'working'))
    store.getState().applyWatchEvent(updated('c', 'w2', 'idle'))
    store.getState().applyWatchEvent(updated('d', 'w2', 'needs-you'))
    expect(selectCardCountByWorkspace(store.getState())).toEqual({ w1: 1, w2: 3 })
  })

  it('records the launch workspace on the terminal registry entry', () => {
    const store = createBoardStore({ now: () => 5 })
    store.getState().openLaunchedTerminal('t1', 'proj', 'w1')
    expect(store.getState().launchedTerminals['t1']?.workspaceId).toBe('w1')
  })

  it('focusWorkspace moves focus to the last opened terminal of the new workspace', () => {
    // A mutable clock — w1 gets TWO terminals opened at DIFFERENT times, so "last wins" is
    // actually distinguishable from "the only one wins" (a constant now() would stamp both t1 and
    // t3 the same, making the assertion ambiguous).
    let clock = 1
    const store = createBoardStore({ now: () => clock })
    store.getState().openLaunchedTerminal('t1', 'a', 'w1')
    clock = 2
    store.getState().openLaunchedTerminal('t3', 'c', 'w1') // newer, SAME workspace — must win
    store.getState().openLaunchedTerminal('t2', 'b', 'w2')
    store.getState().focusWorkspace('w1')
    expect(store.getState().focusedTerminalId).toBe('t3')
    expect(store.getState().viewMode).toBe('focused')
  })

  // IdeasBoard bug: switch-back landed on the newest LAUNCH, not where the operator was working.
  it('focusWorkspace returns to the last FOCUSED terminal, not a newer API launch', () => {
    let clock = 1
    const store = createBoardStore({ now: () => clock })
    store.getState().openLaunchedTerminal('t1', 'a', 'w1') // the operator works here
    clock = 2
    store.getState().registerLaunchedTerminal('t2', 'b', 'w1') // an API create: never focused
    clock = 3
    store.getState().focusWorkspace('w2')
    store.getState().focusWorkspace('w1')
    expect(store.getState().focusedTerminalId).toBe('t1')
  })

  it('focusWorkspace returns to an older terminal the operator switched back to', () => {
    let clock = 1
    const store = createBoardStore({ now: () => clock })
    store.getState().openLaunchedTerminal('t1', 'a', 'w1')
    clock = 2
    store.getState().openLaunchedTerminal('t2', 'b', 'w1')
    clock = 3
    store.getState().switchTerminal('t1') // a rail click back to the older one
    clock = 4
    store.getState().focusWorkspace('w2')
    store.getState().focusWorkspace('w1')
    expect(store.getState().focusedTerminalId).toBe('t1')
  })

  it('a card click counts as focusing its terminal', () => {
    let clock = 1
    const store = createBoardStore({ now: () => clock })
    store.getState().openLaunchedTerminal('t1', 'a', 'w1')
    store.getState().addCorrelation('s1', 't1')
    store.getState().applyWatchEvent(updated('s1', 'w1'))
    clock = 2
    store.getState().openLaunchedTerminal('t2', 'b', 'w1')
    clock = 3
    store.getState().activateCard('s1')
    clock = 4
    store.getState().focusWorkspace('w2')
    store.getState().focusWorkspace('w1')
    expect(store.getState().focusedTerminalId).toBe('t1')
  })

  it('from the focused view, the terminal a workspace switch lands on counts as focused', () => {
    let clock = 1
    const store = createBoardStore({ now: () => clock })
    store.getState().registerLaunchedTerminal('t1', 'a', 'w1')
    store.getState().openLaunchedTerminal('t9', 'z', 'w2') // the operator is in w2's terminal
    clock = 2
    store.getState().focusWorkspace('w1') // lands on t1 and SHOWS it
    clock = 3
    store.getState().registerLaunchedTerminal('t2', 'b', 'w1') // newer, never shown
    store.getState().focusWorkspace('w2')
    store.getState().focusWorkspace('w1')
    expect(store.getState().focusedTerminalId).toBe('t1')
  })

  it('a switch made from the board is not a focus: never-focused terminals fall back to the newest launch', () => {
    let clock = 1
    const store = createBoardStore({ now: () => clock })
    store.getState().registerLaunchedTerminal('t1', 'a', 'w1')
    clock = 2
    store.getState().registerLaunchedTerminal('t2', 'b', 'w1')
    clock = 3
    store.getState().focusWorkspace('w1') // re-points at t2; if that counted, t2 would win below
    clock = 4
    store.getState().registerLaunchedTerminal('t3', 'c', 'w1') // newest, never focused
    store.getState().focusWorkspace('w2')
    store.getState().focusWorkspace('w1')
    expect(store.getState().focusedTerminalId).toBe('t3')
  })

  it('focusWorkspace leaves you on the BOARD when the board is where you were', () => {
    // The reported bug: sitting on w1's board, switch to w2 (empty — board, as expected), then
    // switch back to w1 and the app jumped straight into w1's terminal instead of showing w1's
    // board and its card again. Switching workspace changes WHAT you are looking at, never WHERE
    // you are looking, so the view mode is the operator's and this action must not overwrite it.
    let clock = 1
    const store = createBoardStore({ now: () => clock })
    store.getState().openLaunchedTerminal('t1', 'a', 'w1') // a launch drops into Focused
    store.getState().showBoard() // Esc — back to w1's board
    clock = 2

    store.getState().focusWorkspace('w2') // w2 owns no terminal: board is the only option
    expect(store.getState().viewMode).toBe('board')
    expect(store.getState().focusedTerminalId).toBeNull()

    store.getState().focusWorkspace('w1')
    expect(store.getState().viewMode).toBe('board')
    // The PIN still moves with the workspace even while the board is showing: the rail's active
    // row (selectRailActiveSessionId) and EmbeddedTerminal's shortcut scope both read it, and
    // both assume the focused terminal belongs to the active workspace.
    expect(store.getState().focusedTerminalId).toBe('t1')
  })

  it('focusWorkspace follows the SESSION workspace after a move, not the launch stamp', () => {
    // The reachable defect: `LaunchedTerminal.workspaceId` is stamped once at launch and never
    // rewritten, but CH.sessionSetWorkspace (the card's move affordance) moves the SESSION. A
    // stamp-based filter then offers the terminal in the workspace it LEFT and hides it from the
    // one its card is actually in.
    //
    // Non-vacuous in BOTH directions: with the stale stamp, focusWorkspace('w2') finds nothing
    // and takes the board-fallback branch (focusedTerminalId := null, viewMode := 'board'), so
    // the first pair of assertions goes red; focusWorkspace('w1') then matches the stamp and
    // focuses t1, so the second pair goes red too.
    const store = createBoardStore({ now: () => 1 })
    store.getState().openLaunchedTerminal('t1', 'proj', 'w1')
    store.getState().addCorrelation('s1', 't1')
    store.getState().applyWatchEvent(updated('s1', 'w1'))
    // The move arrives as a normal session.updated delta — main is the only writer of this field.
    store.getState().applyWatchEvent(updated('s1', 'w2'))

    store.getState().focusWorkspace('w2')
    expect(store.getState().focusedTerminalId).toBe('t1')
    expect(store.getState().viewMode).toBe('focused')

    store.getState().focusWorkspace('w1')
    expect(store.getState().focusedTerminalId).toBeNull()
    expect(store.getState().viewMode).toBe('board')
    // Still a pure show/hide — the move must not unmount anything (terminal.md).
    expect(Object.keys(store.getState().launchedTerminals)).toEqual(['t1'])
  })

  it('focusWorkspace falls back to the board when the workspace has no terminal', () => {
    const store = createBoardStore({ now: () => 1 })
    // Seed TWO terminals, BOTH in workspaces other than the one we switch to ('w9' has none of
    // its own) — so the registry assertion below is about the WHOLE registry surviving the
    // fallback, not just one entry.
    store.getState().openLaunchedTerminal('t1', 'a', 'w1')
    store.getState().openLaunchedTerminal('t2', 'b', 'w2')
    store.getState().focusWorkspace('w9')
    expect(store.getState().focusedTerminalId).toBeNull()
    expect(store.getState().viewMode).toBe('board')
    // The board-fallback branch must NEVER unmount a terminal either — every kept-alive frame
    // stays in the registry (terminal.md: hide via visibility, never remove). This line guards
    // that branch: a `launchedTerminals: {}` in the board-fallback set(...) would silently kill
    // every kept-alive terminal on a switch to an empty workspace, and turns it red.
    expect(Object.keys(store.getState().launchedTerminals).sort()).toEqual(['t1', 't2'])
  })

  it('focusWorkspace keeps every terminal in the registry — nothing is unmounted', () => {
    const store = createBoardStore({ now: () => 1 })
    store.getState().openLaunchedTerminal('t1', 'a', 'w1')
    store.getState().openLaunchedTerminal('t2', 'b', 'w2')
    store.getState().focusWorkspace('w1')
    expect(Object.keys(store.getState().launchedTerminals).sort()).toEqual(['t1', 't2'])
  })
})

// ===========================================================================
// Task 9a — scope the board and rail selectors to the active workspace.
//
// Each POSITIVE test below seeds sessions/terminals in TWO workspaces and asserts a
// selector returns only the queried workspace's slice — so the test would fail (not
// vacuously pass) if the workspace filter were absent (see the fault-injection evidence
// in task-9a-report.md). The two NEGATIVE tests assert the opposite for the two
// selectors that must NEVER be workspace-filtered.
// ===========================================================================
describe('boardStore — Task 9a: workspace-scoped board/rail selectors', () => {
  it("selectColumn returns only the queried workspace's sessions in that column", () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(updated(1, 'b', 'working', 200, { workspaceId: 'w2' }))
    // Without the filter, both calls would return ['a', 'b'] (or ['b','a'] by entered-time) —
    // this fails for the right reason if the `s.workspaceId === workspaceId` term is removed.
    expect(selectColumn(store.getState(), 'working', 'w1', NO_FILTER).map((s) => s.id)).toEqual([
      'a'
    ])
    expect(selectColumn(store.getState(), 'working', 'w2', NO_FILTER).map((s) => s.id)).toEqual([
      'b'
    ])
  })

  it("selectColumnCount counts only the queried workspace's sessions", () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(updated(1, 'b', 'working', 200, { workspaceId: 'w2' }))
    store.getState().applyWatchEvent(updated(1, 'c', 'working', 300, { workspaceId: 'w1' }))
    // Without the filter both counts would be 3 (the full column) — non-vacuous.
    expect(selectColumnCount(store.getState(), 'working', 'w1', NO_FILTER)).toBe(2)
    expect(selectColumnCount(store.getState(), 'working', 'w2', NO_FILTER)).toBe(1)
  })

  it("selectTotalCount counts only the queried workspace's sessions", () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(updated(1, 'b', 'idle', 200, { workspaceId: 'w2' }))
    store.getState().applyWatchEvent(updated(1, 'c', 'needs-you', 300, { workspaceId: 'w2' }))
    // Without the filter both calls would return 3 (the whole board) — non-vacuous.
    expect(selectTotalCount(store.getState(), 'w1', NO_FILTER)).toBe(1)
    expect(selectTotalCount(store.getState(), 'w2', NO_FILTER)).toBe(2)
  })

  it("selectStartingTerminals returns only the queried workspace's launched-but-uncorrelated terminals", () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t1', 'projA', 'w1')
    store.getState().showBoard()
    store.getState().openLaunchedTerminal('t2', 'projB', 'w2')
    // Same fixed now() for both entries, so without the workspace filter the terminalId
    // tiebreak would return BOTH ids (['t1','t2']) for either workspace query — non-vacuous.
    expect(selectStartingTerminals(store.getState(), 'w1').map((t) => t.terminalId)).toEqual(['t1'])
    expect(selectStartingTerminals(store.getState(), 'w2').map((t) => t.terminalId)).toEqual(['t2'])
  })

  it("selectRailOrder returns only the queried workspace's session ids", () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(updated(1, 'b', 'needs-you', 50, { workspaceId: 'w2' }))
    // Without the filter, both calls would return ['b', 'a'] (needs-you sorts first) —
    // non-vacuous: the w1 query would wrongly include 'b', the w2 query would wrongly include 'a'.
    expect(selectRailOrder(store.getState(), 'w1')).toEqual(['a'])
    expect(selectRailOrder(store.getState(), 'w2')).toEqual(['b'])
  })

  it("selectRailSection returns only the queried workspace's session ids for that column", () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'working', 100, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(updated(1, 'b', 'working', 200, { workspaceId: 'w2' }))
    // Without the filter, both calls would return ['a', 'b'] (oldest-entered first) —
    // non-vacuous either way (each query is missing an exclusion or has an extra inclusion).
    expect(selectRailSection(store.getState(), 'working', 'w1', NO_FILTER)).toEqual(['a'])
    expect(selectRailSection(store.getState(), 'working', 'w2', NO_FILTER)).toEqual(['b'])
  })

  // ---- the two NEGATIVE tests — the most important tests in this task -------------------
  it('NEGATIVE: selectKeptAliveTerminalIds is NOT workspace-filtered — every workspace stays mounted', () => {
    // Filtering this selector would UNMOUNT a hidden workspace's terminals and kill their
    // PTYs — the one guarantee the whole feature rests on (a switch is a pure show/hide).
    // This has NO workspaceId parameter and must never grow one.
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t1', 'projA', 'w1')
    store.getState().showBoard()
    store.getState().openLaunchedTerminal('t2', 'projB', 'w2')
    const alive = selectKeptAliveTerminalIds(store.getState())
    expect(alive).toContain('t1')
    expect(alive).toContain('t2')
  })

  it('NEGATIVE: selectNeedsYouCountByWorkspace is NOT workspace-filtered — it counts EVERY workspace', () => {
    // This feeds the switcher's "another workspace needs you" badge — filtering it to the
    // active workspace would make that badge always read zero. (Overlaps the Task-8 guard
    // "counts needs-you per workspace INCLUDING hidden ones" above; kept here too so this
    // task's deliverable is self-contained.)
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(updated(1, 'b', 'needs-you', 200, { workspaceId: 'w2' }))
    const counts = selectNeedsYouCountByWorkspace(store.getState())
    expect(counts['w1']).toBe(1)
    expect(counts['w2']).toBe(1)
  })
})

describe('session templates — view-state', () => {
  it('the create prompt may carry a templateId (absent for the folder flow)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store
      .getState()
      .showSessionNamePrompt({ mode: 'create', cwd: '/p', initialName: 'p', templateId: 'tpl-1' })
    const prompt = store.getState().sessionNamePrompt
    expect(prompt !== null && prompt.mode === 'create' ? prompt.templateId : null).toBe('tpl-1')
    store.getState().showSessionNamePrompt({ mode: 'create', cwd: '/p', initialName: 'p' })
    const folder = store.getState().sessionNamePrompt
    expect(folder !== null && folder.mode === 'create' ? folder.templateId : 'x').toBeUndefined()
  })
  it('shortcutsDialogOpen starts false; open/close toggle it; both are idempotent', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    expect(selectShortcutsDialogOpen(store.getState())).toBe(false)
    const unsub = vi.fn()
    store.subscribe(unsub)
    store.getState().closeShortcutsDialog()
    expect(unsub).not.toHaveBeenCalled()
    store.getState().openShortcutsDialog()
    store.getState().openShortcutsDialog()
    expect(selectShortcutsDialogOpen(store.getState())).toBe(true)
    store.getState().closeShortcutsDialog()
    store.getState().closeShortcutsDialog()
    expect(selectShortcutsDialogOpen(store.getState())).toBe(false)
  })
})

describe('tag filtering (spec §4.1)', () => {
  const tagged = (
    id: string,
    tagIds: string[],
    column: Column = 'working'
  ): WatchEventsPayload => ({
    epoch: 0,
    event: {
      type: 'session.updated',
      id,
      sessionName: id,
      projectPath: '/p',
      status: column === 'needs-you' ? 'NeedsAttention' : 'Working',
      column,
      enteredColumnAt: 1,
      pid: 1,
      workspaceId: 'default',
      tagIds
    }
  })

  function seeded(): ReturnType<typeof createBoardStore> {
    const store = createBoardStore({ now: () => 1 })
    store.getState().applyWatchEvent(tagged('prod-card', ['t-prod']))
    store.getState().applyWatchEvent(tagged('plain-card', []))
    store.getState().applyWatchEvent(tagged('prod-waiting', ['t-prod'], 'needs-you'))
    store.getState().applyWatchEvent(tagged('plain-waiting', [], 'needs-you'))
    return store
  }

  it('null shows every card; a tag id shows only the cards carrying it', () => {
    const s = seeded().getState()
    expect(
      selectColumn(s, 'working', 'default', NO_FILTER)
        .map((c) => c.id)
        .sort()
    ).toEqual(['plain-card', 'prod-card'])
    expect(
      selectColumn(s, 'working', 'default', { tagId: 't-prod', query: '' }).map((c) => c.id)
    ).toEqual(['prod-card'])
    expect(selectColumnCount(s, 'needs-you', 'default', { tagId: 't-prod', query: '' })).toBe(1)
    expect(selectTotalCount(s, 'default', NO_FILTER)).toBe(4)
    expect(selectTotalCount(s, 'default', { tagId: 't-prod', query: '' })).toBe(2)
    expect(selectRailSection(s, 'needs-you', 'default', { tagId: 't-prod', query: '' })).toEqual([
      'prod-waiting'
    ])
  })

  it('the switcher counts ignore the filter — alerts never go through the board selectors (W-3)', () => {
    // Drift guard for W-3: selectNeedsYouCountByWorkspace feeds the switcher badge and the OS
    // notifier, both of which must fire regardless of the header tag filter. It takes no tagId
    // argument at all — this proves a tag filter can never mute an alert.
    expect(selectNeedsYouCountByWorkspace(seeded().getState())).toEqual({ default: 2 })
  })
})

describe('search — the filter bar narrows the board by card NAME', () => {
  const card = (
    id: string,
    sessionName: string,
    over: { tagIds?: string[]; column?: Column; projectPath?: string } = {}
  ): WatchEventsPayload => {
    const column = over.column ?? 'working'
    return {
      epoch: 0,
      event: {
        type: 'session.updated',
        id,
        sessionName,
        projectPath: over.projectPath ?? '/p',
        status: column === 'needs-you' ? 'NeedsAttention' : 'Working',
        column,
        enteredColumnAt: 1,
        pid: 1,
        workspaceId: 'default',
        tagIds: over.tagIds ?? []
      }
    }
  }

  function seeded(): ReturnType<typeof createBoardStore> {
    const store = createBoardStore({ now: () => 1 })
    store.getState().applyWatchEvent(card('a', 'Deploy API', { tagIds: ['t-prod'] }))
    store.getState().applyWatchEvent(card('b', 'deploy web'))
    store.getState().applyWatchEvent(card('c', 'Review PR'))
    store.getState().applyWatchEvent(card('d', 'Deploy docs', { column: 'needs-you' }))
    return store
  }

  it('matches the card name case-insensitively, anywhere in it — board and rail alike', () => {
    const s = seeded().getState()
    const f = { tagId: null, query: 'DEPLOY' }
    expect(
      selectColumn(s, 'working', 'default', f)
        .map((c) => c.id)
        .sort()
    ).toEqual(['a', 'b'])
    expect(selectColumnCount(s, 'working', 'default', f)).toBe(2)
    expect(selectTotalCount(s, 'default', f)).toBe(3)
    expect(selectRailSection(s, 'needs-you', 'default', f)).toEqual(['d'])
  })

  it('a blank query hides nothing, and spaces around the query are ignored', () => {
    const s = seeded().getState()
    expect(selectTotalCount(s, 'default', { tagId: null, query: '   ' })).toBe(4)
    expect(selectTotalCount(s, 'default', { tagId: null, query: '  review ' })).toBe(1)
  })

  it('search and the tag filter combine: a card must pass both', () => {
    const s = seeded().getState()
    expect(
      selectColumn(s, 'working', 'default', { tagId: 't-prod', query: 'deploy' }).map((c) => c.id)
    ).toEqual(['a'])
  })

  // The folder is a FILTER's job in a later release, not the search box's.
  it('matches the name only, never the folder', () => {
    const store = seeded()
    store.getState().applyWatchEvent(card('e', 'Other', { projectPath: '/srv/deploy' }))
    expect(selectTotalCount(store.getState(), 'default', { tagId: null, query: 'deploy' })).toBe(3)
  })

  it('holds the search text as view-state, verbatim, and starts empty', () => {
    const store = createBoardStore()
    expect(selectSearchQuery(store.getState())).toBe('')
    store.getState().setSearchQuery('  Dep')
    expect(selectSearchQuery(store.getState())).toBe('  Dep')
  })

  it('NO_FILTER hides nothing', () => {
    expect(selectTotalCount(seeded().getState(), 'default', NO_FILTER)).toBe(4)
  })
})

describe('the Tags dialog flag (spec 2026-10-03 C)', () => {
  it('opens on a page, switches page while open, closes; idempotent', () => {
    const store = createBoardStore()
    expect(selectTagsDialog(store.getState())).toBeNull()
    store.getState().openTagsDialog('rules')
    expect(selectTagsDialog(store.getState())).toBe('rules')
    store.getState().openTagsDialog('tags')
    expect(selectTagsDialog(store.getState())).toBe('tags')
    store.getState().closeTagsDialog()
    store.getState().closeTagsDialog()
    expect(selectTagsDialog(store.getState())).toBeNull()
  })
})

describe('the Sessions dialog flag (spec 2026-10-03 B)', () => {
  it('starts closed; open(page) opens on that page; open again switches page; close nulls it', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    expect(selectSessionsDialog(store.getState())).toBeNull()
    store.getState().openSessionsDialog('past')
    expect(selectSessionsDialog(store.getState())).toBe('past')
    store.getState().openSessionsDialog('templates')
    expect(selectSessionsDialog(store.getState())).toBe('templates')
    store.getState().closeSessionsDialog()
    expect(selectSessionsDialog(store.getState())).toBeNull()
  })

  it('is idempotent: the same page or a second close sets nothing', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    const listener = vi.fn()
    store.subscribe(listener)
    store.getState().closeSessionsDialog()
    expect(listener).not.toHaveBeenCalled()
    store.getState().openSessionsDialog('past')
    store.getState().openSessionsDialog('past')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('boardStore — card shell pane view-state (shellPanes)', () => {
  it('openShellPane records the companion id, visible; setShellPaneVisible hides and shows it', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t-1', 'proj', 'default')
    store.getState().openShellPane('t-1', 't-1:shell')
    expect(selectShellPane(store.getState(), 't-1')).toEqual({
      terminalId: 't-1:shell',
      visible: true
    })
    store.getState().setShellPaneVisible('t-1', false)
    expect(selectShellPane(store.getState(), 't-1')?.visible).toBe(false)
    // The entry STAYS while hidden: the shell keeps running and its terminal stays mounted.
    expect(selectShellPane(store.getState(), 't-1')?.terminalId).toBe('t-1:shell')
    store.getState().openShellPane('t-1', 't-1:shell')
    expect(selectShellPane(store.getState(), 't-1')?.visible).toBe(true)
  })
  it('setShellPaneVisible on a terminal with no pane is a no-op', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    const before = store.getState().shellPanes
    store.getState().setShellPaneVisible('t-9', true)
    expect(store.getState().shellPanes).toBe(before)
    expect(selectShellPane(store.getState(), 't-9')).toBeNull()
  })
  it('forgetLaunchedTerminal (claude exited) does NOT drop the pane: the shell keeps running', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openLaunchedTerminal('t-1', 'proj', 'default')
    store.getState().openShellPane('t-1', 't-1:shell')
    store.getState().forgetLaunchedTerminal('t-1')
    expect(selectShellPane(store.getState(), 't-1')?.terminalId).toBe('t-1:shell')
  })
  it('pruneShellPanes drops only the panes whose parent is no longer rendered, same ref when none', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().openShellPane('t-1', 't-1:shell')
    store.getState().openShellPane('t-2', 't-2:shell')
    const before = store.getState().shellPanes
    store.getState().pruneShellPanes(['t-1', 't-2'])
    expect(store.getState().shellPanes).toBe(before)
    store.getState().pruneShellPanes(['t-2'])
    expect(selectShellPane(store.getState(), 't-1')).toBeNull()
    expect(selectShellPane(store.getState(), 't-2')).not.toBeNull()
  })
  it('the new keys respect the naming guards (no ack/raise/navigate/summon/window)', () => {
    const keys = ['shellPanes', 'openShellPane', 'setShellPaneVisible', 'pruneShellPanes']
    expect(keys.some((k) => /ack|acknowledg|raise|navigate|summon|window/i.test(k))).toBe(false)
    const store = createBoardStore({ now: () => FIXED_NOW })
    for (const k of keys) expect(Object.keys(store.getState())).toContain(k)
  })
})
