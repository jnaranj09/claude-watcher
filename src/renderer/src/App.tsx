// Story 1.4 — App now renders the live three-column <Board/> (the v1 board view).
//
// The Story-0.1 single-PTY xterm smoke shell is preserved as <SmokeCockpit/> and
// mounted ONLY in smoke mode, so `npm run smoke` (the packaged node-pty exit gate)
// does NOT regress. Smoke mode is owned by main (`process.env.C9_SMOKE`) and surfaced
// to the renderer via the typed `window.pty.smokeConfig()` invoke. We resolve it ONCE
// on mount and pick the view; while it resolves we render the Board (which shows its
// own cold-load skeleton until the first c9watch delta — UX-DR16), so there is no
// spinner-on-empty and the smoke decision never flashes the wrong shell first (the
// PTY is requested only inside SmokeCockpit, never by the Board).
//
// The board is the v1 board view; the xterm cockpit is Epic-3's focused-session
// concern. [Source: story 1.4 Task 6]
import { useCallback, useEffect, useState } from 'react'
import { Board } from './components/board/Board'
import { SmokeCockpit } from './SmokeCockpit'
// Story 2.4 — the minimal Settings surface (header ⚙) + the startup settings load.
import { Settings } from './components/Settings/Settings'
import { loadSettings } from './stores/settingsStore'
// Story 3.1 (FR-10) — the minimal embedded-terminal host. Reachable via the URL hash
// (`#terminals` → 1; `#terminals=N` → N for the NFR-5 many-terminals manual check) so it does
// NOT alter the default board view or the Story-0.1 smoke path.
import { TerminalHost } from './terminal/TerminalHost'
import { parseTerminalHostCount } from './terminal/terminalHostHash'
// Story 3.2 (FR-11) — the minimal Focused-session view + the renderer view-state (viewMode +
// focusedTerminalId) reconciled with the Story-2.2 selection. The launch flow: native picker →
// raw claude launch → drop into the Focused-session showing that terminal (UX-DR19/21/23/24).
import { FocusedSession } from './views/FocusedSession'
import { useShallow } from 'zustand/react/shallow'
import {
  boardStore,
  useBoard,
  selectViewMode,
  selectFocusedTerminalId,
  selectKeptAliveTerminalIds
} from './stores/boardStore'
// Story 3.5 (SM-2) — the paired acknowledge helper (board view-state + telemetry signal,
// FROZEN-5). Used at the activateCard call site to also emit the telemetry signal.
import { acknowledgeSession } from './utils/acknowledgeSession'
import styles from './App.module.css'

function App(): React.JSX.Element {
  // null = smoke-config not resolved yet; true/false once known.
  const [smoke, setSmoke] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    window.pty
      .smokeConfig()
      .then((cfg) => {
        if (!cancelled) setSmoke(cfg.enabled)
      })
      .catch((err) => {
        // smokeConfig should never reject; if it does, fall through to the board
        // (smoke=false) rather than hang. Never the value — just the error message.
        console.error('[c9watch] smokeConfig failed; defaulting to board', err)
        if (!cancelled) setSmoke(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Story 2.4 — load persisted settings ONCE at startup and hydrate the renderer settings
  // store (the live projection the sound module + Settings UI read). loadSettings never throws;
  // on failure it leaves the defaults (sound ON) so the app is usable. Skip in smoke mode.
  useEffect(() => {
    if (smoke === false) void loadSettings()
  }, [smoke])

  // Story 3.2 (FR-11) — the Board ↔ Focused-session VIEW-STATE (renderer view-state, F6).
  const viewMode = useBoard(selectViewMode)
  const focusedTerminalId = useBoard(selectFocusedTerminalId)
  // Story 3.4 (FR-16 / B-1 fix) — the kept-alive terminal set. Used to decide whether to KEEP the
  // FocusedSession (and its EmbeddedTerminals) MOUNTED while on the Board: if any app-launched
  // terminal exists, the focused view stays mounted-but-hidden so a Board↔Focused switch NEVER
  // unmounts/disposes a terminal (which would kill the live PTY). A primitive-length read off a
  // STABLE sorted array under useShallow so an equal set never re-renders here. [terminal.md]
  const keptAliveTerminalIds = useBoard(useShallow(selectKeptAliveTerminalIds))

  // Story 3.4 (FR-16 / Task 4.1) — subscribe to the launch CORRELATION push: main emits
  // { terminalId, sessionId } once a launch's Tgid join lands. Build the renderer's
  // `terminalIdBySessionId` view-state so the attention rail can switch the visible terminal by
  // session id. Mount ONCE (the singleton store survives view switches); skip in smoke mode.
  useEffect(() => {
    if (smoke !== false) return
    const off = window.launch.onCorrelated(({ terminalId, sessionId }) =>
      boardStore.getState().addCorrelation(sessionId, terminalId)
    )
    return off
  }, [smoke])

  // Story 3.2 (FR-11) — the NEW-SESSION launch flow: native KDE directory picker → raw `claude`
  // launch in the picked cwd → drop into the Focused-session showing that terminal (UX-DR19). On
  // CANCEL it is a NO-OP (no PTY spawned, no view change — the picker returns null). The renderer
  // NEVER opens a dialog itself — it triggers the OS dialog via the typed `window.launch` bridge.
  // A launch failure (a rejected invoke) logs a code (never the path value) and leaves the board.
  const handleNewSession = useCallback(async (): Promise<void> => {
    let cwd: string | null
    try {
      cwd = await window.launch.pickDirectory()
    } catch {
      console.warn('[c9watch][launch] code=pick_directory_failed')
      return
    }
    if (cwd === null) return // cancel ⇒ no-op (no launch, no view change)
    try {
      const { terminalId } = await window.launch.launch(cwd)
      // Optimistic drop-into-Focused-session: render the terminal the moment the launch returns
      // its id (the terminal is typeable immediately; the Tgid join reconciles asynchronously).
      boardStore.getState().openLaunchedTerminal(terminalId)
    } catch {
      // never-log-the-value: a code only (the rejected invoke carries the cwd — keep it off logs).
      console.warn('[c9watch][launch] code=launch_failed')
    }
  }, [])

  // Story 3.2 (FR-11 / F6) — focus a card (the Board onActivateCard seam). ONE selection
  // (reconciled with the Story-2.2 selectedId). View-state only — no window raise.
  // Story 3.5 (SM-2): two consequences at this call site (FROZEN-5): the board view-state
  // acknowledge (inside activateCard) + the telemetry signal (acknowledgeSession second arg).
  // acknowledgeSession(id) handles the telemetry signal; activateCard handles the view-state
  // transition (selectedId + focusedTerminalId). Both fire from this one call site.
  const handleActivateCard = useCallback((id: string): void => {
    boardStore.getState().activateCard(id)
    // The telemetry signal fires alongside the view-state transition (FROZEN-5: two separate
    // calls at the same call site; boardStore stays pure view-state, no IPC inside its action).
    acknowledgeSession(id)
  }, [])

  // Story 3.2 (FR-11 / UX-DR21) — Esc-to-Board (the "← Board" affordance equivalent). A STABLE
  // callback (matching handleNewSession/handleActivateCard) so the always-mounted FocusedSession
  // (B-1 kept-alive) is not handed a new prop reference on every App render.
  const handleBack = useCallback((): void => {
    boardStore.getState().showBoard()
  }, [])

  // Story 3.2 (FR-11 / UX-DR21) — global keybindings: Ctrl+N → new session; Esc → Board.
  // Gated on NON-smoke + NON-terminal-host below via the early returns, so this effect only runs
  // for the real app view. Esc returns Focused → Board (closing the topmost layer); a no-op on
  // the board. Ctrl+N opens the picker from anywhere. The handlers above never throw.
  useEffect(() => {
    if (smoke !== false) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        void handleNewSession()
        return
      }
      if (e.key === 'Escape') {
        // Esc returns Focused → Board (UX-DR21). No-op on the board (showBoard guards).
        boardStore.getState().showBoard()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [smoke, handleNewSession])

  // In smoke mode, render the single-PTY cockpit (the packaged smoke harness drives
  // it). Otherwise — including while smoke-config is still resolving — render the
  // board; its cold-load skeleton covers the brief pre-resolution window.
  if (smoke === true) return <SmokeCockpit />

  // Story 3.1 (FR-10) — the minimal embedded-terminal host, gated on the URL hash so it never
  // alters the default board view or the smoke path. `#terminals` mounts 1; `#terminals=N`
  // mounts N (the NFR-5 many-terminals manual check). Only consulted when NOT in smoke mode.
  const terminalCount = smoke === false ? parseTerminalHostCount(window.location.hash) : 0
  if (terminalCount > 0) {
    return (
      <div className={styles.app}>
        <header className={styles.header} data-testid="app-header">
          <span className={styles.brand}>c9watch · terminals (3.1 proof)</span>
          <Settings />
        </header>
        <main className={styles.main}>
          <TerminalHost count={terminalCount} />
        </main>
      </div>
    )
  }

  // Story 3.2 (FR-11) → Story 3.4 (B-1 fix) — the real app view: a header with `+ New session`
  // (UX-DR21) + Settings, and the body switching Board ↔ Focused-session by `viewMode` (renderer
  // view-state, F6/UX-DR24 — single-window, NOT routing, NOT a second window). The Focused-session
  // renders the launched terminal by its opaque terminalId (UX-DR19); Esc / "← Board" returns.
  //
  // B-1 (terminal.md kept-alive / AC-3): a Board↔Focused switch must NEVER unmount the
  // EmbeddedTerminals — unmounting runs their cleanup (`term.dispose()` + `window.terminal.stop()`),
  // which KILLS the live PTY. So we do NOT use a JSX ternary that swaps one view OUT (that unmounts
  // it). Instead BOTH views are rendered STACKED in a `position:relative` container and the inactive
  // one is hidden with `visibility:hidden` (NEVER `display:none` — `display:none` collapses the box
  // to 0×0 and breaks the next `fit()`; `visibility:hidden` preserves a non-zero box). A view switch
  // is pure show/hide; the kept-alive terminals inside FocusedSession stay mounted across it.
  //
  // FocusedSession is only mounted once there is something to keep alive (a focused terminal OR a
  // correlated app-launched terminal) — before the first launch there are no terminals, so it would
  // render an empty rail + terminal region for nothing. Once any terminal exists it stays mounted:
  // today nothing resets `focusedTerminalId`/`terminalIdBySessionId` to empty, so this is a one-way
  // latch (mounts once, never unmounts). WARNING: a FUTURE "close all terminals" action that empties
  // both would flip this back to false and UNMOUNT FocusedSession — re-introducing B-1 (the unmount
  // would dispose+stop the live PTYs). If that action is ever added, it must stop the PTYs itself
  // (an explicit close) rather than rely on an incidental unmount.
  const hasFocusableTerminal = focusedTerminalId !== null || keptAliveTerminalIds.length > 0
  const showFocused = viewMode === 'focused' && focusedTerminalId !== null

  return (
    <div className={styles.app}>
      <header className={styles.header} data-testid="app-header">
        <span className={styles.brand}>c9watch</span>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.newSessionHeaderButton}
            data-testid="header-new-session"
            onClick={() => void handleNewSession()}
          >
            + New session
          </button>
          <Settings />
        </div>
      </header>
      <main className={styles.main}>
        {/* Stacked views — BOTH mounted; the inactive one is visibility:hidden (terminal.md). The
            board is always mounted; FocusedSession mounts once there is a terminal to keep alive and
            then NEVER unmounts on a Board↔Focused switch (B-1). */}
        <div className={styles.viewStack}>
          <div
            className={styles.viewLayer}
            data-testid="board-layer"
            data-active={!showFocused}
            style={showFocused ? { visibility: 'hidden' } : undefined}
            aria-hidden={showFocused}
            inert={showFocused}
          >
            <Board
              onNewSession={() => void handleNewSession()}
              onActivateCard={handleActivateCard}
            />
          </div>
          {hasFocusableTerminal && (
            <div
              className={styles.viewLayer}
              data-testid="focused-layer"
              data-active={showFocused}
              style={showFocused ? undefined : { visibility: 'hidden' }}
              aria-hidden={!showFocused}
              inert={!showFocused}
            >
              <FocusedSession onBack={handleBack} />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
