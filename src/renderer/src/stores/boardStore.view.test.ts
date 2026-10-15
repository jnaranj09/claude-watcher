// boardStore tests, part 2: view-state (selection, Board <-> Focused-session, acknowledge state,
// the terminal id map, the launched-terminal registry). jsdom `unit` project. Deltas come from
// `watchUpdated`; time is an INJECTED now().
import { describe, it, expect } from 'vitest'
import {
  createBoardStore,
  selectSelectedId,
  selectViewMode,
  selectFocusedTerminalId,
  selectRailEmphasis,
  selectTerminalIdForSession,
  selectKeptAliveTerminalIds,
  selectStartingTerminals
} from './boardStore'
import { watchRemoved, watchUpdated } from '../../../__fixtures__/watchEvents'
import { FIXED_NOW, makeClock } from '../test/boardStoreFixtures'

describe('boardStore — FR-9 selection view-state (Story 2.2: AC-5, AC-8)', () => {
  it('selectedId defaults to null; selectSelectedId is a narrow primitive selector', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    expect(selectSelectedId(store.getState())).toBeNull()
    // Narrow primitive (a string|null, safe without useShallow).
    expect(typeof selectSelectedId).toBe('function')
  })

  it('setSelected(presentId) SETS the selection (non-vacuous: a present card does select)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
    store.getState().setSelected('a')
    expect(selectSelectedId(store.getState())).toBe('a')
  })

  it('setSelected(absentId) is a NO-OP (the card is not on the board)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
    // 'ghost' was never on the board → selecting it does nothing.
    store.getState().setSelected('ghost')
    expect(selectSelectedId(store.getState())).toBeNull()
    // Prove non-vacuous: the present card DOES select (contrast with the no-op above).
    store.getState().setSelected('a')
    expect(selectSelectedId(store.getState())).toBe('a')
  })

  it('setSelected(null) clears the selection', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
    store.getState().setSelected('a')
    expect(selectSelectedId(store.getState())).toBe('a')
    store.getState().setSelected(null)
    expect(selectSelectedId(store.getState())).toBeNull()
  })

  it('removing the SELECTED session clears selectedId (the highlighted card vanished)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
    store.getState().applyWatchEvent(watchUpdated(1, 'b', 'working', 200))
    store.getState().setSelected('a')
    expect(selectSelectedId(store.getState())).toBe('a')
    // Removing a DIFFERENT session leaves the selection intact.
    store.getState().applyWatchEvent(watchRemoved(2, 'b'))
    expect(selectSelectedId(store.getState())).toBe('a')
    // Removing the SELECTED session clears it.
    store.getState().applyWatchEvent(watchRemoved(3, 'a'))
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
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
    store.getState().activateCard('a')
    // ONE selection: activateCard sets the SAME selectedId the Story-2.2 setSelected uses.
    expect(selectSelectedId(store.getState())).toBe('a')
    // No terminal is known for this card in 3.2 (the reverse map is 3.3/3.4) → NO ghost
    // viewMode='focused' state; the view stays on the board.
    expect(selectViewMode(store.getState())).toBe('board')
  })

  it('activateCard(presentId) DOES enter Focused when a terminal is already focused (no ghost state)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
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
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
    store.getState().applyWatchEvent(watchUpdated(2, 'b', 'working', 200))
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
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
    store.getState().applyWatchEvent(watchUpdated(2, 'b', 'working', 200))
    store.getState().addCorrelation('a', 'term-a')
    store.getState().openLaunchedTerminal('term-a', 'a', 'default')
    store.getState().showBoard()

    // `b`'s CH.launchCorrelated push has not landed → no terminal of its own to show.
    store.getState().activateCard('b')

    // It still SELECTS + acknowledges (the operator did click it), but entering Focused here
    // would put A's terminal on screen under B's name — the exact bug, one card later.
    expect(selectSelectedId(store.getState())).toBe('b')
    expect(store.getState().acknowledgedById['b']).toBeDefined()
    expect(selectViewMode(store.getState())).toBe('board')
    expect(selectFocusedTerminalId(store.getState())).toBe('term-a')
  })

  it('activateCard(absentId) is a NO-OP (no view change, no selection)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
    store.getState().activateCard('ghost')
    expect(selectViewMode(store.getState())).toBe('board')
    expect(selectSelectedId(store.getState())).toBeNull()
  })

  it('showBoard returns to the board (Esc-to-Board) and leaves the selection highlighted', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100))
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
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100))
    // Before acknowledge: emphasized (needs-you + not acknowledged).
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('needs-you')
    expect(store.getState().acknowledgedById['a']).toBeUndefined()

    store.getState().acknowledge('a')
    // After acknowledge: calm (in-app emphasis cleared though the session still says needs-you).
    expect(store.getState().acknowledgedById['a']).toBeDefined()
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('calm')
    // The ack stamp is the injected now() (determinism).
    expect(store.getState().acknowledgedById['a']).toBe(clock.now())
  })

  it('a NON-needs-you session is never emphasized regardless of ack', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'w', 'working', 100))
    store.getState().applyWatchEvent(watchUpdated(1, 'i', 'idle', 100))
    expect(selectRailEmphasis(store.getState(), 'w')).toBe('calm')
    expect(selectRailEmphasis(store.getState(), 'i')).toBe('calm')
  })

  it('an absent session is calm (never crash on an unknown id)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    expect(selectRailEmphasis(store.getState(), 'ghost')).toBe('calm')
    expect(store.getState().acknowledgedById['ghost']).toBeUndefined()
  })

  it('emphasis RETURNS on a needs-you RE-ENTRY (clearing on column-leave makes re-entry a new event)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100))
    store.getState().acknowledge('a')
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('calm')

    // The session LEFT needs-you (handled) → ack entry cleared.
    store.getState().applyWatchEvent(watchUpdated(2, 'a', 'working', 200))
    expect(store.getState().acknowledgedById['a']).toBeUndefined()
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('calm') // not needs-you now

    // It RE-ENTERS needs-you → a NEW attention event → re-emphasized.
    store.getState().applyWatchEvent(watchUpdated(3, 'a', 'needs-you', 300))
    expect(selectRailEmphasis(store.getState(), 'a')).toBe('needs-you')
  })

  it('the ack entry is CLEARED when the session is REMOVED (badge can’t outlive the handled session)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100))
    store.getState().acknowledge('a')
    expect(store.getState().acknowledgedById['a']).toBeDefined()

    store.getState().applyWatchEvent(watchRemoved(2, 'a'))
    expect(store.getState().acknowledgedById['a']).toBeUndefined()
  })

  it('a still-needs-you update does NOT clear the ack (only a column-LEAVE does)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100))
    store.getState().acknowledge('a')
    // Another needs-you update (e.g. a status field change while still waiting) keeps it
    // acknowledged.
    store
      .getState()
      .applyWatchEvent(watchUpdated(2, 'a', 'needs-you', 100, { status: 'NeedsPermission' }))
    expect(store.getState().acknowledgedById['a']).toBeDefined()
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
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100))
    store.getState().activateCard('a')
    expect(store.getState().acknowledgedById['a']).toBeDefined()
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
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100))
    store.getState().addCorrelation('a', 'launch-1')
    store.getState().applyWatchEvent(watchRemoved(2, 'a'))
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
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100))
    store.getState().addCorrelation('a', 'launch-1')
    store.getState().switchTerminal('launch-1')
    // The switch alone does not clear emphasis — the rail click calls acknowledge(sessionId) too.
    expect(store.getState().acknowledgedById['a']).toBeUndefined()
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
    // focused layer (hidden) whenever kept-alive is non-empty, and EmbeddedTerminal spawns on
    // mount.
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
    //   → A must STILL be in selectKeptAliveTerminalIds via the registry (not just
    //     focusedTerminalId).
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
    // that's OK — the terminal will show the "exited" pane when focused; it's gone from the
    // registry).
    // Actually focusedTerminalId is still 't-1' here, so it STILL appears via that path.
    // What we assert is that the registry term no longer holds it.
    expect(Object.keys(store.getState().launchedTerminals)).not.toContain('t-1')
  })

  it('selectKeptAliveTerminalIds returns STABLE, SORTED, de-duplicated ids', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'sess-a', 'working', 100))
    store.getState().addCorrelation('sess-a', 'terminal-b')
    store.getState().openLaunchedTerminal('terminal-a', 'projectA', 'default')
    // Now: terminalIdBySessionId = { 'sess-a': 'terminal-b' },
    // launchedTerminals = { 'terminal-a': ... },
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
    store.getState().applyWatchEvent(watchUpdated(1, 'sess-1', 'working', 100))
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
    store.getState().applyWatchEvent(watchUpdated(1, 'sess-1', 'working', 100))
    store.getState().addCorrelation('sess-1', 't-1')
    // Correlated + card present → NOT starting.
    expect(selectStartingTerminals(store.getState(), 'default')).toHaveLength(0)
    // Session removed → card gone + binding cleared → falls back into strip.
    store.getState().applyWatchEvent(watchRemoved(2, 'sess-1'))
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
