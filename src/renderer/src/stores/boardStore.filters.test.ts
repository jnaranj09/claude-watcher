// boardStore tests, part 3: rail sections, workspace scoping, and the filters and dialog flags
// (templates, tags, search, Tags and Sessions dialogs, card shell panes). jsdom `unit` project.
// Deltas come from `watchUpdated`; time is an INJECTED now().
import { describe, it, expect, vi } from 'vitest'
import {
  createBoardStore,
  selectColumn,
  selectColumnCount,
  selectTotalCount,
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
  NO_FILTER
} from './boardStore'
import type { Column, WatchEventsPayload } from '../../../shared/ipc/contract'
import { watchRemoved, watchUpdated } from '../../../__fixtures__/watchEvents'
import { FIXED_NOW, makeClock } from '../test/boardStoreFixtures'

// ---------------------------------------------------------------------------
// Rail SECTIONS — the pinned active row + one group per status.
// ---------------------------------------------------------------------------

describe('boardStore — rail sections: pinned active row + per-status groups', () => {
  /** A store with three sessions, one per column, and 'open' bound to the focused terminal. */
  function withFocus(): ReturnType<typeof createBoardStore> {
    const store = createBoardStore({ now: makeClock().now })
    store.getState().applyWatchEvent(watchUpdated(1, 'open', 'idle', 500))
    store.getState().applyWatchEvent(watchUpdated(1, 'wants-you', 'needs-you', 100))
    store.getState().applyWatchEvent(watchUpdated(1, 'busy', 'working', 200))
    store.getState().addCorrelation('open', 'tid-open')
    store.getState().switchTerminal('tid-open')
    return store
  }

  it('selectRailActiveSessionId resolves the focused terminal back to its session', () => {
    expect(selectRailActiveSessionId(withFocus().getState())).toBe('open')
  })

  it('selectRailActiveSessionId is null with no focused terminal', () => {
    const store = createBoardStore({ now: makeClock().now })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'idle', 100))
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
    store.getState().applyWatchEvent(watchRemoved(2, 'open'))
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
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'idle', 100))
    store.getState().applyWatchEvent(watchUpdated(1, 'b', 'idle', 200))
    expect(selectRailSection(store.getState(), 'idle', 'default', NO_FILTER)).toEqual(['a', 'b'])
  })

  // ASCENDING in EVERY group — deliberately NOT `sortByEnteredColumn`, which sorts the BOARD's
  // working column descending. The rail is a "who has been waiting longest" list throughout; if
  // this flips, the same three sessions read in two different orders on two surfaces.
  it('selectRailSection sorts oldest-entered FIRST, including the working group', () => {
    const store = createBoardStore({ now: makeClock().now })
    store.getState().applyWatchEvent(watchUpdated(1, 'newer', 'working', 300))
    store.getState().applyWatchEvent(watchUpdated(1, 'older', 'working', 100))
    expect(selectRailSection(store.getState(), 'working', 'default', NO_FILTER)).toEqual([
      'older',
      'newer'
    ])
  })

  it('selectRailSection breaks an enteredColumnAt tie on id, deterministically', () => {
    const store = createBoardStore({ now: makeClock().now })
    store.getState().applyWatchEvent(watchUpdated(1, 'zz', 'needs-you', 100))
    store.getState().applyWatchEvent(watchUpdated(1, 'aa', 'needs-you', 100))
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
  it('projects workspaceId onto the board session', () => {
    const store = createBoardStore({ now: () => 1 })
    store.getState().applyWatchEvent(watchUpdated(0, 'a', 'working', 1, { workspaceId: 'w1' }))
    expect(store.getState().sessionsById['a']?.workspaceId).toBe('w1')
  })

  it('counts needs-you per workspace INCLUDING hidden ones', () => {
    const store = createBoardStore({ now: () => 1 })
    store.getState().applyWatchEvent(watchUpdated(0, 'a', 'needs-you', 1, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(watchUpdated(0, 'b', 'needs-you', 1, { workspaceId: 'w2' }))
    store.getState().applyWatchEvent(watchUpdated(0, 'c', 'needs-you', 1, { workspaceId: 'w2' }))
    store.getState().applyWatchEvent(watchUpdated(0, 'd', 'working', 1, { workspaceId: 'w2' }))
    expect(selectNeedsYouCountByWorkspace(store.getState())).toEqual({ w1: 1, w2: 2 })
  })

  it('counts working per workspace INCLUDING hidden ones', () => {
    const store = createBoardStore({ now: () => 1 })
    store.getState().applyWatchEvent(watchUpdated(0, 'a', 'working', 1, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(watchUpdated(0, 'b', 'working', 1, { workspaceId: 'w2' }))
    store.getState().applyWatchEvent(watchUpdated(0, 'c', 'working', 1, { workspaceId: 'w2' }))
    store.getState().applyWatchEvent(watchUpdated(0, 'd', 'needs-you', 1, { workspaceId: 'w2' }))
    store.getState().applyWatchEvent(watchUpdated(0, 'e', 'idle', 1, { workspaceId: 'w2' }))
    expect(selectWorkingCountByWorkspace(store.getState())).toEqual({ w1: 1, w2: 2 })
  })

  it('counts every card per workspace, whatever its column, INCLUDING hidden ones', () => {
    const store = createBoardStore({ now: () => 1 })
    store.getState().applyWatchEvent(watchUpdated(0, 'a', 'needs-you', 1, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(watchUpdated(0, 'b', 'working', 1, { workspaceId: 'w2' }))
    store.getState().applyWatchEvent(watchUpdated(0, 'c', 'idle', 1, { workspaceId: 'w2' }))
    store.getState().applyWatchEvent(watchUpdated(0, 'd', 'needs-you', 1, { workspaceId: 'w2' }))
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
    store.getState().applyWatchEvent(watchUpdated(0, 's1', 'working', 1, { workspaceId: 'w1' }))
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
    store.getState().applyWatchEvent(watchUpdated(0, 's1', 'working', 1, { workspaceId: 'w1' }))
    // The move arrives as a normal session.updated delta — main is the only writer of this field.
    store.getState().applyWatchEvent(watchUpdated(0, 's1', 'working', 1, { workspaceId: 'w2' }))

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
// vacuously pass) if the workspace filter were absent. The two NEGATIVE tests assert the
// opposite for the two selectors that must NEVER be workspace-filtered.
// ===========================================================================
describe('boardStore — Task 9a: workspace-scoped board/rail selectors', () => {
  it("selectColumn returns only the queried workspace's sessions in that column", () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(watchUpdated(1, 'b', 'working', 200, { workspaceId: 'w2' }))
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
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(watchUpdated(1, 'b', 'working', 200, { workspaceId: 'w2' }))
    store.getState().applyWatchEvent(watchUpdated(1, 'c', 'working', 300, { workspaceId: 'w1' }))
    // Without the filter both counts would be 3 (the full column) — non-vacuous.
    expect(selectColumnCount(store.getState(), 'working', 'w1', NO_FILTER)).toBe(2)
    expect(selectColumnCount(store.getState(), 'working', 'w2', NO_FILTER)).toBe(1)
  })

  it("selectTotalCount counts only the queried workspace's sessions", () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(watchUpdated(1, 'b', 'idle', 200, { workspaceId: 'w2' }))
    store.getState().applyWatchEvent(watchUpdated(1, 'c', 'needs-you', 300, { workspaceId: 'w2' }))
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
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(watchUpdated(1, 'b', 'needs-you', 50, { workspaceId: 'w2' }))
    // Without the filter, both calls would return ['b', 'a'] (needs-you sorts first) —
    // non-vacuous: the w1 query would wrongly include 'b', the w2 query would wrongly include 'a'.
    expect(selectRailOrder(store.getState(), 'w1')).toEqual(['a'])
    expect(selectRailOrder(store.getState(), 'w2')).toEqual(['b'])
  })

  it("selectRailSection returns only the queried workspace's session ids for that column", () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'working', 100, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(watchUpdated(1, 'b', 'working', 200, { workspaceId: 'w2' }))
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
    store.getState().applyWatchEvent(watchUpdated(1, 'a', 'needs-you', 100, { workspaceId: 'w1' }))
    store.getState().applyWatchEvent(watchUpdated(1, 'b', 'needs-you', 200, { workspaceId: 'w2' }))
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
  function seeded(): ReturnType<typeof createBoardStore> {
    const store = createBoardStore({ now: () => 1 })
    store
      .getState()
      .applyWatchEvent(watchUpdated(0, 'prod-card', 'working', 1, { tagIds: ['t-prod'] }))
    store.getState().applyWatchEvent(watchUpdated(0, 'plain-card', 'working', 1, { tagIds: [] }))
    store
      .getState()
      .applyWatchEvent(watchUpdated(0, 'prod-waiting', 'needs-you', 1, { tagIds: ['t-prod'] }))
    store
      .getState()
      .applyWatchEvent(watchUpdated(0, 'plain-waiting', 'needs-you', 1, { tagIds: [] }))
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
  ): WatchEventsPayload =>
    watchUpdated(0, id, over.column ?? 'working', 1, {
      sessionName,
      projectPath: over.projectPath ?? '/p',
      tagIds: over.tagIds ?? []
    })

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
