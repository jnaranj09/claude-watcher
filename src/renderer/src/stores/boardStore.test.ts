// Story 1.4 — board store tests (AC-7, AC-8). jsdom `unit` project.
//
// Drives the store via VALIDATED `WatchEventsPayload` deltas (the shape the wire now
// carries) and an INJECTED now() for determinism. Asserts: projection map upsert;
// idempotent epoch (stale-epoch delta discarded); session.removed VANISHES; coldLoaded
// flips on first delta; selectors return the correctly SORTED list per column
// (working desc, needs-you/idle asc); attention.raised is ignored by the board; the
// store does NOT re-parse with any Zod schema; no terminal/xterm reference.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createBoardStore,
  cascadeHero,
  selectColumn,
  selectColumnCount,
  selectTotalCount,
  selectColdLoaded,
  selectReconnecting,
  selectHeroColumn,
  selectSelectedId,
  selectViewMode,
  selectFocusedTerminalId,
  selectIsAcknowledged,
  selectRailEmphasis,
  selectTerminalIdForSession,
  RECONNECT_THRESHOLD_MS,
  HERO_SWAP_DEBOUNCE_MS,
  type BoardState
} from './boardStore'
import type { Column, WatchEventsPayload } from '../../../shared/ipc/contract'

const FIXED_NOW = 1_750_000_000_000

/** A controllable clock for deterministic time-based assertions. */
function makeClock(start = FIXED_NOW): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return { now: () => t, advance: (ms) => (t += ms) }
}

/** Build a validated `session.updated` delta (the enriched wire shape). */
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
      pendingToolName: 'Bash'
    })
    expect(selectTotalCount(store.getState())).toBe(1)
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
    expect(selectTotalCount(store.getState())).toBe(1)
    store.getState().applyWatchEvent(removed(2, 'a'))
    expect(store.getState().sessionsById['a']).toBeUndefined()
    expect(selectTotalCount(store.getState())).toBe(0)
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
    expect(selectTotalCount(store.getState())).toBe(1)
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
    expect(selectColumn(state, 'working').map((s) => s.id)).toEqual(['w2', 'w3', 'w1'])
    expect(selectColumnCount(state, 'working')).toBe(3)
  })

  it('needs-you column is sorted ASC (longest-waiting on top)', () => {
    const state = seed().getState()
    expect(selectColumn(state, 'needs-you').map((s) => s.id)).toEqual(['n2', 'n1'])
    expect(selectColumnCount(state, 'needs-you')).toBe(2)
  })

  it('idle column is sorted ASC (longest-waiting on top)', () => {
    const state = seed().getState()
    expect(selectColumn(state, 'idle').map((s) => s.id)).toEqual(['i2', 'i1'])
    expect(selectColumnCount(state, 'idle')).toBe(2)
  })

  it('grouping is exact — every session is in exactly one column, none missing/duplicated (AC-1)', () => {
    const state = seed().getState()
    const ids = (['working', 'needs-you', 'idle'] as const).flatMap((c) =>
      selectColumn(state, c).map((s) => s.id)
    )
    expect(ids.sort()).toEqual(['i1', 'i2', 'n1', 'n2', 'w1', 'w2', 'w3'])
    expect(new Set(ids).size).toBe(ids.length) // no duplicates
  })
})

describe('boardStore — reconnect banner is driven by main’s REAL signal, not line silence (AC-6 fix)', () => {
  it('REGRESSION: a QUIET fleet (no deltas past the threshold) does NOT show the banner', () => {
    // The verified contract: `c9watch watch --changes-only` emits 0 lines on a quiet
    // machine — silence is the NORMAL steady state. The OLD silence-based driver flagged
    // this idle, healthy board as reconnecting after the threshold. The fix: with NO
    // `reconnecting:true` signal from main, ticking far past the threshold keeps the
    // banner hidden. (This test FAILS against the old `now() - lastDeltaAt` code.)
    const clock = makeClock()
    const store = createBoardStore({ now: clock.now })
    const st = (): BoardState => store.getState()

    st().applyWatchEvent(updated(1, 'a', 'working', 100))
    expect(selectReconnecting(st())).toBe(false)

    // Quiet for well past the threshold — NO new deltas (normal idle fleet).
    clock.advance(RECONNECT_THRESHOLD_MS * 5)
    st().tickReconnect()
    expect(selectReconnecting(st())).toBe(false) // healthy + quiet ≠ reconnecting
  })

  it('a watch-child-exit (reconnecting:true) shows the banner past the debounce, and recovery clears it', () => {
    const clock = makeClock()
    const store = createBoardStore({ now: clock.now })
    const st = (): BoardState => store.getState()

    st().applyWatchEvent(updated(1, 'a', 'working', 100))

    // main pushes reconnecting:true (the watch child died). The banner is DEBOUNCED —
    // it does not appear immediately (a brief blip must not flap it).
    st().setReconnecting(true)
    st().tickReconnect()
    expect(selectReconnecting(st())).toBe(false)

    // Within the debounce window — still hidden.
    clock.advance(RECONNECT_THRESHOLD_MS - 1)
    st().tickReconnect()
    expect(selectReconnecting(st())).toBe(false)

    // Past the debounce — the banner appears (the gap persisted).
    clock.advance(2)
    st().tickReconnect()
    expect(selectReconnecting(st())).toBe(true)

    // Recovery: main pushes reconnecting:false (watch restarted + list reconcile applied)
    // → the banner clears IMMEDIATELY (no debounce on recovery).
    st().setReconnecting(false)
    expect(selectReconnecting(st())).toBe(false)
  })

  it('a SHORT reconnect that recovers within the debounce window never flaps the banner', () => {
    const clock = makeClock()
    const store = createBoardStore({ now: clock.now })
    const st = (): BoardState => store.getState()

    st().applyWatchEvent(updated(1, 'a', 'working', 100))
    st().setReconnecting(true)
    clock.advance(RECONNECT_THRESHOLD_MS - 1)
    st().tickReconnect()
    expect(selectReconnecting(st())).toBe(false) // not yet shown
    st().setReconnecting(false) // recovered fast
    clock.advance(RECONNECT_THRESHOLD_MS * 5)
    st().tickReconnect()
    expect(selectReconnecting(st())).toBe(false) // anchor cleared → never appears
  })

  it('NO transition is dropped across the reconnect (idempotent epoch apply still holds)', () => {
    // The banner is purely a connection-state overlay; the session projection is driven
    // by the epoch-framed deltas independently. A reconnect signal does not perturb the
    // map, and the post-reconnect `list` reconcile (higher epoch) applies idempotently.
    const clock = makeClock()
    const store = createBoardStore({ now: clock.now })
    const st = (): BoardState => store.getState()

    // Live: session 'a' working at epoch 1.
    st().applyWatchEvent(updated(1, 'a', 'working', 100, { status: 'Working' }))
    // Watch child dies — reconnecting signal in flight (banner state only).
    st().setReconnecting(true)
    clock.advance(RECONNECT_THRESHOLD_MS + 1)
    st().tickReconnect()
    expect(selectReconnecting(st())).toBe(true)
    // The reconnect `list` reconcile arrives at a higher epoch and moves 'a' to needs-you
    // (a transition that occurred during the gap) — applied, not dropped.
    st().applyWatchEvent(updated(2, 'a', 'needs-you', 500, { status: 'NeedsAttention' }))
    expect(st().sessionsById['a']?.column).toBe('needs-you')
    expect(st().epoch).toBe(2)
    // A STALE replay of the old epoch is still discarded (idempotent).
    st().applyWatchEvent(updated(1, 'a', 'working', 100, { status: 'Working' }))
    expect(st().sessionsById['a']?.column).toBe('needs-you')
    // Recovery clears the banner; the projection is intact.
    st().setReconnecting(false)
    expect(selectReconnecting(st())).toBe(false)
    expect(st().sessionsById['a']?.column).toBe('needs-you')
  })
})

describe('boardStore — setReconnecting flips coldLoaded (Story 5.3 — cold-load-complete on status push)', () => {
  it('setReconnecting(false) on a FRESH store with ZERO sessions flips coldLoaded to true (the empty-board defect path)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    // Non-vacuous: confirm coldLoaded starts false (no delta has arrived).
    expect(selectColdLoaded(store.getState())).toBe(false)
    // Startup status arrives (feed.ts emits false after initial list seed).
    store.getState().setReconnecting(false)
    expect(selectColdLoaded(store.getState())).toBe(true)
    // The reconnect-banner state is untouched — no reconnect was signalled.
    expect(selectReconnecting(store.getState())).toBe(false)
    expect(store.getState().reconnectingSince).toBeNull()
  })

  it('setReconnecting(true) ALSO flips coldLoaded true (any watch:status push = heard from feed), and still anchors the debounce', () => {
    const clock = makeClock()
    const store = createBoardStore({ now: clock.now })
    const st = (): BoardState => store.getState()
    // Non-vacuous: confirm coldLoaded starts false.
    expect(selectColdLoaded(st())).toBe(false)
    // main signals reconnecting (watch child died).
    st().setReconnecting(true)
    expect(selectColdLoaded(st())).toBe(true)
    // Banner debounce is still anchored correctly — NOT shown until threshold.
    st().tickReconnect()
    expect(selectReconnecting(st())).toBe(false)
    clock.advance(RECONNECT_THRESHOLD_MS + 1)
    st().tickReconnect()
    expect(selectReconnecting(st())).toBe(true)
    // Recovery clears banner; coldLoaded stays true.
    st().setReconnecting(false)
    expect(selectReconnecting(st())).toBe(false)
    expect(selectColdLoaded(st())).toBe(true)
  })
})

describe('boardStore — cascadeHero (the pure cascade Needs-you → Working → Idle; AC-1, AC-2)', () => {
  it('needs-you present (>0) → the hero is needs-you', () => {
    expect(cascadeHero(1)).toBe('needs-you')
    expect(cascadeHero(3)).toBe('needs-you')
  })

  it('needs-you absent (0) → the hero is working (the calm fall-through)', () => {
    expect(cascadeHero(0)).toBe('working')
  })

  it('working is the hero even when working is ALSO empty (degenerate empty board is its own 1.4 state)', () => {
    // The degenerate empty board: needs-you = 0 → working takes the (empty) center; idle
    // (even if it has sessions) never competes.
    expect(cascadeHero(0)).toBe('working')
  })

  it('idle is NEVER returned — even when idle would be the only non-empty column (AC-2)', () => {
    // cascadeHero is keyed on the needs-you membership ONLY (idle is not even an input).
    // Whatever the needs-you count, the result is one of {needs-you, working} — idle can
    // never occupy the hero center.
    for (const ny of [0, 1, 2]) {
      expect(['needs-you', 'working']).toContain(cascadeHero(ny))
    }
  })
})

describe('boardStore — HERO-SWAP debounce on the 0↔1 Needs-you boundary (AC-5, AC-8)', () => {
  it('the committed hero defaults to working; selectHeroColumn returns the committed hero', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    expect(selectHeroColumn(store.getState())).toBe('working')
  })

  it('a 0→1 needs-you transition does NOT commit the hero until now() advances past the window (+ tickHero)', () => {
    const clock = makeClock()
    const store = createBoardStore({ now: clock.now })
    const st = (): BoardState => store.getState()

    // Seed a working session → hero stays working.
    st().applyWatchEvent(updated(1, 'w', 'working', 100))
    expect(selectHeroColumn(st())).toBe('working')

    // The first needs-you session appears (0→1). The RAW cascade is now needs-you, but the
    // hero must NOT swap immediately — the swap is anchored, pending the debounce.
    st().applyWatchEvent(updated(1, 'n', 'needs-you', 200, { status: 'NeedsAttention' }))
    expect(st().heroPendingTarget).toBe('needs-you')
    st().tickHero()
    expect(selectHeroColumn(st())).toBe('working') // not yet committed

    // Within the window — still working.
    clock.advance(HERO_SWAP_DEBOUNCE_MS - 1)
    st().tickHero()
    expect(selectHeroColumn(st())).toBe('working')

    // Past the window — the hero commits to needs-you.
    clock.advance(2)
    st().tickHero()
    expect(selectHeroColumn(st())).toBe('needs-you')
    expect(st().heroPendingSince).toBeNull()
  })

  it('a 0→1→0 FLAP within the window NEVER swaps the hero (proven non-vacuous)', () => {
    const clock = makeClock()
    const store = createBoardStore({ now: clock.now })
    const st = (): BoardState => store.getState()

    st().applyWatchEvent(updated(1, 'w', 'working', 100))
    // Needs-you blinks IN (0→1) …
    st().applyWatchEvent(updated(1, 'n', 'needs-you', 200, { status: 'NeedsAttention' }))
    expect(st().heroPendingTarget).toBe('needs-you')
    clock.advance(HERO_SWAP_DEBOUNCE_MS - 1) // still inside the window
    // … then OUT (1→0) before the window elapses (the card vanished).
    st().applyWatchEvent(removed(2, 'n'))
    // The raw cascade is back to working (the committed hero) → the anchor is cleared, so
    // a subsequent tick past the original window must NOT swap the hero.
    expect(st().heroPendingSince).toBeNull()
    clock.advance(HERO_SWAP_DEBOUNCE_MS * 5)
    st().tickHero()
    expect(selectHeroColumn(st())).toBe('working') // the flap was swallowed
  })

  it('NON-VACUOUS control: with the debounce zeroed, the SAME flap DOES commit (then reverts)', () => {
    // Prove the suppression above is real: temporarily set heroSwapDebounceMs = 0 so the
    // FIRST tick after the 0→1 commits needs-you BEFORE the 1→0 arrives. This is the
    // counter-example — it demonstrates the window is what swallows the flap.
    const clock = makeClock()
    const store = createBoardStore({ now: clock.now, heroSwapDebounceMs: 0 })
    const st = (): BoardState => store.getState()

    st().applyWatchEvent(updated(1, 'w', 'working', 100))
    st().applyWatchEvent(updated(1, 'n', 'needs-you', 200, { status: 'NeedsAttention' }))
    clock.advance(1) // any advance > 0 crosses a zero window
    st().tickHero()
    expect(selectHeroColumn(st())).toBe('needs-you') // committed (vacuity check fails here
    // with a real window) — so the suppression test above is non-vacuous.
  })

  it('RECOVERY: ≥1→0 yields the hero back to Working, but only after the window', () => {
    const clock = makeClock()
    const store = createBoardStore({ now: clock.now })
    const st = (): BoardState => store.getState()

    // Get the hero committed to needs-you first.
    st().applyWatchEvent(updated(1, 'w', 'working', 100))
    st().applyWatchEvent(updated(1, 'n', 'needs-you', 200, { status: 'NeedsAttention' }))
    clock.advance(HERO_SWAP_DEBOUNCE_MS + 1)
    st().tickHero()
    expect(selectHeroColumn(st())).toBe('needs-you')

    // The last needs-you session leaves (≥1→0). The raw cascade is working again, but the
    // hero must stay needs-you until the window elapses (recovery is also debounced).
    st().applyWatchEvent(removed(2, 'n'))
    expect(st().heroPendingTarget).toBe('working')
    st().tickHero()
    expect(selectHeroColumn(st())).toBe('needs-you') // not yet
    clock.advance(HERO_SWAP_DEBOUNCE_MS - 1)
    st().tickHero()
    expect(selectHeroColumn(st())).toBe('needs-you')
    clock.advance(2)
    st().tickHero()
    expect(selectHeroColumn(st())).toBe('working') // committed back to working
  })

  it('the store keeps NO denormalized hero card list — only the debounce bookkeeping (AC-8)', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    const keys = Object.keys(store.getState())
    // The only NEW hero state is the debounce trio; no "heroSessions"/"heroCards" copy.
    expect(keys).toContain('heroColumn')
    expect(keys).toContain('heroPendingSince')
    expect(keys).toContain('heroPendingTarget')
    expect(keys.filter((k) => /hero/i.test(k)).sort()).toEqual(
      ['heroColumn', 'heroPendingSince', 'heroPendingTarget', 'tickHero'].sort()
    )
    // No selector or state denormalizes a hero card array.
    expect(keys.some((k) => /heroSessions|heroCards|heroList/i.test(k))).toBe(false)
  })

  it('NO-PIN (AC-7): there is no store action to set the hero directly', () => {
    const store = createBoardStore({ now: () => FIXED_NOW })
    const state = store.getState()
    // The hero is cascade-derived truth: no setHero/pinHero/selectHero mutator exists.
    const actionNames = Object.keys(state).filter(
      (k) => typeof (state as unknown as Record<string, unknown>)[k] === 'function'
    )
    expect(
      actionNames.some((k) => /setHero|pinHero|selectHeroColumnState|moveColumn/i.test(k))
    ).toBe(false)
    // Only feed-driven inputs (applyWatchEvent) + the tick can move the hero.
    expect(actionNames).toContain('applyWatchEvent')
    expect(actionNames).toContain('tickHero')
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
    expect(actionNames.some((k) => /raise|focus|navigate|summon|window/i.test(k))).toBe(false)
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
    store.getState().openLaunchedTerminal('launch-term-1')
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
    // A terminal is already focused (e.g. a prior launch) → activating a card enters Focused.
    store.getState().openLaunchedTerminal('launch-term-1')
    store.getState().showBoard() // back to board, but focusedTerminalId persists
    store.getState().activateCard('a')
    expect(selectViewMode(store.getState())).toBe('focused')
    expect(selectSelectedId(store.getState())).toBe('a')
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
    store.getState().openLaunchedTerminal('launch-term-1')
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
