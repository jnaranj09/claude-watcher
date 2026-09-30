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
// Session templates — the header `+ New session` popover (folder / templates / Manage) and the
// Manage-templates modal. See NewSessionButton.tsx / TemplatesDialog.tsx for their own docs.
import { NewSessionButton } from './components/NewSessionMenu/NewSessionButton'
import { TemplatesDialog } from './components/TemplatesDialog/TemplatesDialog'
import { loadTemplates } from './stores/templatesStore'
// Phrase shortcuts — the Manage-shortcuts modal (☰ menu → Shortcuts…) + the startup shortcuts load.
import { ShortcutsDialog } from './components/ShortcutsDialog/ShortcutsDialog'
import { loadShortcuts } from './stores/shortcutsStore'
// Workspaces (Task 9b) — the header switcher + the startup workspaces load. Task 10 wires
// `onManage` to the Manage-workspaces modal below.
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher/WorkspaceSwitcher'
import { WorkspacesDialog } from './components/WorkspacesDialog/WorkspacesDialog'
import { loadWorkspaces } from './stores/workspacesStore'
// The header ☰ menu — Settings…, Shortcuts…, and the Tags submenu (Manage tags… / Manage rules…).
import { AppMenu } from './components/AppMenu/AppMenu'
// Tags — the Manage-tags modal.
import { TagsDialog } from './components/TagsDialog/TagsDialog'
import { loadTags, setSessionTags } from './stores/tagsStore'
// Rules — the Manage-rules modal (+ the startup rules load).
import { RulesDialog } from './components/RulesDialog/RulesDialog'
import { loadRules } from './stores/rulesStore'
// Past sessions (D-6) — the history modal (☰ menu → Past sessions…, always the last row). It loads
// the history itself on open; nothing loads at startup.
import { PastSessionsDialog } from './components/PastSessionsDialog/PastSessionsDialog'
import type { Template } from '../../shared/ipc/contract'
// Story 2.4 — the minimal Settings surface (☰ menu → Settings…; the `#terminals` proof view keeps
// its own ⚙ gear) + the startup settings load.
import { Settings, SettingsPanel } from './components/Settings/Settings'
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
  selectKeptAliveTerminalIds,
  selectQuitGuard,
  selectStopConfirm,
  selectSessionNamePrompt,
  selectSessionNamePromptBusy,
  selectSessionNamePromptError,
  selectTemplatesDialogOpen,
  selectShortcutsDialogOpen,
  selectWorkspacesDialogOpen,
  selectTagsDialogOpen,
  selectRulesDialogOpen,
  selectSettingsDialogOpen,
  selectPastSessionsDialogOpen
} from './stores/boardStore'
// Story 4.2 (FR-14) — the Quit-guard modal (renderer view-state; shown when boardStore.quitGuard
// is non-null). Imported here and rendered over the board/focused view when the guard is active.
import { QuitGuard } from './components/QuitGuard/QuitGuard'
// Story 4.3 (FR-15) — the Stop-confirm modal (renderer view-state; shown when boardStore.stopConfirm
// is non-null). Rendered as a stacked overlay (same z-60 family as the QuitGuard; they never co-exist
// — single-modal rule UX-DR14). The Stop-confirm never co-exists with the Quit-guard.
import { StopConfirm } from './components/StopConfirm/StopConfirm'
// Past sessions (D-3/D-5) — the ONE place the card, the focused bar, Ctrl+W and the Delete
// confirm call through, so the explicit main-side stop-and-record/drop FIRST, then the
// renderer's own view-state ordering (F1) cannot drift between callers.
import { archiveTerminal } from './lib/sessionExit'
import { isInsideTerminal } from './lib/terminalFocus'
// Session-naming — the create-time name prompt (renderer view-state; shown when
// boardStore.sessionNamePrompt is non-null, i.e. after the directory picker and BEFORE the
// launch). Same z-60 overlay family; it never co-exists with the other two modals.
import { SessionNameDialog } from './components/SessionNameDialog/SessionNameDialog'
// Session-naming — the ONE definition of a legal name length; the prefill is clamped to it so an
// over-long directory basename never opens the dialog in an un-submittable state.
import { SESSION_NAME_MAX_LENGTH } from '../../shared/schemas/launch'
// Story 3.5 (SM-2) — the paired acknowledge helper (board view-state + telemetry signal,
// FROZEN-5). Used at the activateCard call site to also emit the telemetry signal.
import { acknowledgeSession } from './utils/acknowledgeSession'
// Deterministic-attention (Task 6) — the seen effect: while the operator is looking at the
// focused view's active YourTurn session with the window focused, marks it seen via main
// (window.launch.markSeen). Mounted once here — see useSessionSeen.ts for the full rule.
import { useSessionSeen } from './hooks/useSessionSeen'
// UX-13 — report the focused-view terminal so main can skip the alert for the session in view.
import { useReportFocusedTerminal } from './hooks/useReportFocusedTerminal'
// Custom themes — writes the applied bundle into <head> and the root color-scheme (T13).
import { useApplyTheme } from './hooks/useApplyTheme'
import { useServerHealth } from './hooks/useServerHealth'
import { ServerHealthBanner } from './components/ServerHealthBanner/ServerHealthBanner'
import { useStorageHealth } from './hooks/useStorageHealth'
import { StorageNotice } from './components/StorageNotice/StorageNotice'
import { themeStore } from './stores/themeStore'
import styles from './App.module.css'
// UX-DR14 single-modal rule — shared with the notification click (lib/openFromNotification.ts).
import { isDialogOpen, isModalOpen } from './lib/modals'
// Action feedback (spec 2026-09-29 §1.2) — the ONE toast renderer, outside the inert subtree.
import { Toaster } from './components/Toaster/Toaster'
// Action feedback (spec 2026-09-29 §2.2) — the name prompt's Create / Rename: stays open while main
// answers, maps refusals, and never lets a late result take the view.
import { submitLaunch, submitRename } from './lib/namePromptFlow'

function App(): React.JSX.Element {
  // Deterministic-attention (Task 6) — mount ONCE at the top of the component body.
  useSessionSeen()
  useReportFocusedTerminal()

  // Custom themes — write the applied bundle into <head> and the root color-scheme.
  useApplyTheme()

  // null = smoke-config not resolved yet; true/false once known.
  const [smoke, setSmoke] = useState<boolean | null>(null)
  const serverHealth = useServerHealth()
  const storageHealth = useStorageHealth()

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
  // Session templates — load the templates list ONCE at startup, alongside settings. Never
  // throws (loadTemplates logs a code and leaves the store empty on failure).
  useEffect(() => {
    if (smoke === false) {
      void loadSettings()
      void loadTemplates()
      // Phrase shortcuts — never throws (logs a code and leaves the projection empty on failure).
      void loadShortcuts()
      // Workspaces (Task 9b) — never throws (logs a code and leaves the projection empty on
      // failure, same as the three above).
      void loadWorkspaces()
      // Tags — never throws (logs a code and leaves the projection empty on failure).
      void loadTags()
      // Rules — never throws (logs a code and leaves the projection empty on failure).
      void loadRules()
    }
  }, [smoke])

  // Story 3.2 (FR-11) — the Board ↔ Focused-session VIEW-STATE (renderer view-state, F6).
  const viewMode = useBoard(selectViewMode)
  const focusedTerminalId = useBoard(selectFocusedTerminalId)
  // Story 4.2 (FR-14) — the Quit-guard payload (non-null while the guard modal is open).
  const quitGuard = useBoard(selectQuitGuard)
  // Story 4.3 (FR-15) — the Stop-confirm payload (non-null while the confirm is open).
  const stopConfirm = useBoard(selectStopConfirm)
  // Session-naming — the create-time name prompt payload (null = no prompt shown).
  const sessionNamePrompt = useBoard(selectSessionNamePrompt)
  // Action feedback — the prompt's in-flight flag and its mapped refusal copy.
  const sessionNamePromptBusy = useBoard(selectSessionNamePromptBusy)
  const sessionNamePromptError = useBoard(selectSessionNamePromptError)
  // Session templates — whether the Manage-templates dialog is open.
  const templatesDialogOpen = useBoard(selectTemplatesDialogOpen)
  // Phrase shortcuts — whether the Manage-shortcuts dialog is open.
  const shortcutsDialogOpen = useBoard(selectShortcutsDialogOpen)
  // Workspaces — whether the Manage-workspaces dialog is open.
  const workspacesDialogOpen = useBoard(selectWorkspacesDialogOpen)
  // Tags — whether the Manage-tags dialog is open.
  const tagsDialogOpen = useBoard(selectTagsDialogOpen)
  // Rules — whether the Manage-rules dialog is open.
  const rulesDialogOpen = useBoard(selectRulesDialogOpen)
  // Settings — whether the Settings dialog is open.
  const settingsDialogOpen = useBoard(selectSettingsDialogOpen)
  // Past sessions — whether the Past-sessions dialog is open.
  const pastSessionsDialogOpen = useBoard(selectPastSessionsDialogOpen)
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

  // Programmatic API — main asks for a terminal when an API call created a card. REGISTER-ONLY
  // (`registerLaunchedTerminal`), never the name prompt's `openLaunchedTerminal`: an API create is
  // not the operator's own click, so it must NOT move the view out of the terminal they are typing
  // in (nor leave the focused terminal in a workspace that is not the active one, which it would
  // whenever the template belongs elsewhere). The terminal still mounts hidden and spawns its pty —
  // the registry key is what keeps it alive. The renderer invents nothing: the label and the
  // workspace are main's.
  // Guarded like `window.quit`: older App tests stub only the bridges they touch (AR-12).
  useEffect(() => {
    if (smoke !== false) return
    if (typeof window.launch.onLaunchRequested !== 'function') return
    const off = window.launch.onLaunchRequested(({ terminalId, label, workspaceId }) =>
      boardStore.getState().registerLaunchedTerminal(terminalId, label, workspaceId)
    )
    return off
  }, [smoke])

  // Custom themes — subscribe to the applied-bundle push, then ask main for the current theme
  // once: main's did-finish-load push may land before this effect subscribed (the same race the
  // API lifecycle comment in createWindow describes), and a reload is a cheap re-read.
  // Guarded like `window.launch.onLaunchRequested`: older App tests stub only what they touch.
  useEffect(() => {
    if (smoke !== false) return
    if (typeof window.themes !== 'object') return
    const off = window.themes.onApplied((bundle) => themeStore.getState().setBundle(bundle))
    window.themes.reload().catch(() => console.warn('[claude-watcher][themes] code=reload_failed'))
    return off
  }, [smoke])

  // Story 5.6 (AC-5) — subscribe to the terminal-exit push ONCE (non-smoke only).
  // Main emits `CH.terminalExit` when a PTY exits naturally; we remove its registry entry so
  // it leaves both `selectStartingTerminals` and `selectKeptAliveTerminalIds`. Mirrors the
  // `window.launch.onCorrelated` effect above (subscribe-returns-unsubscribe, StrictMode-safe).
  // `window.terminal.onExit` exists in preload (preload/index.ts:182-186) + typed in index.d.ts.
  // `App.launch.test.tsx` stubs `window.terminal.onExit: vi.fn(() => () => {})` (:91) so the new
  // subscription mounts cleanly there WITHOUT touching the frozen file.
  useEffect(() => {
    if (smoke !== false) return
    const off = window.terminal.onExit(({ terminalId }) =>
      boardStore.getState().forgetLaunchedTerminal(terminalId)
    )
    return off
  }, [smoke])

  // Story 4.2 (FR-14) — subscribe to the quit-guard-show push ONCE (non-smoke only).
  // Main emits `CH.quitGuardShow` when ≥1 live app-launched session is found at quit time.
  // The renderer opens the guard modal by setting boardStore.quitGuard (RENDERER VIEW-STATE).
  // Mirrors the `window.launch.onCorrelated` effect above (subscribe-returns-unsubscribe).
  // Guard: `window.quit` is present in real Electron but absent in tests that pre-date Story 4.2
  // (App.launch.test.tsx stubs only the bridges it touches; it must not be modified — AR-12).
  useEffect(() => {
    if (smoke !== false) return
    if (!window.quit) return
    const off = window.quit.onGuardShow((payload) => {
      // Session-naming: main pushes the guard unconditionally on before-quit, so it can arrive
      // while the name prompt is open. Drop the pending launch first (nothing has spawned, so it
      // costs nothing) — otherwise two modals stack, and submitting the name would spawn a NEW
      // session AFTER main already snapshotted the live set for the guard's list.
      // Session templates: the Manage-templates dialog is a modal too — drop it for the same
      // reason (UX-DR14 single-modal rule; a stray dialog must never be left stacked under the
      // quit guard). Workspaces: the Manage-workspaces dialog is a modal too, same reasoning.
      boardStore.getState().clearSessionNamePrompt()
      boardStore.getState().closeTemplatesDialog()
      boardStore.getState().closeShortcutsDialog()
      boardStore.getState().closeWorkspacesDialog()
      boardStore.getState().closeTagsDialog()
      boardStore.getState().closeRulesDialog()
      boardStore.getState().closeSettingsDialog()
      boardStore.getState().closePastSessionsDialog()
      // R9 — the Delete confirm too: a Delete confirmed under the guard would act on a session
      // main already counted in the guard's list.
      boardStore.getState().clearStopConfirm()
      boardStore.getState().showQuitGuard(payload)
    })
    return off
  }, [smoke])

  // Story 3.2 (FR-11) — the NEW-SESSION launch flow: native KDE directory picker → raw `claude`
  // launch in the picked cwd → drop into the Focused-session showing that terminal (UX-DR19). On
  // CANCEL it is a NO-OP (no PTY spawned, no view change — the picker returns null). The renderer
  // NEVER opens a dialog itself — it triggers the OS dialog via the typed `window.launch` bridge.
  // A launch failure (a rejected invoke) logs a code (never the path value) and leaves the board.
  // Session-naming: the picker no longer launches directly. It now opens the NAME PROMPT and
  // stops — the launch fires from `submitLaunch` (lib/namePromptFlow.ts) once the operator has a name. So a
  // cancel at EITHER step (picker or prompt) spawns nothing at all.
  const handleNewSession = useCallback(async (): Promise<void> => {
    // Re-entry guard: if a prompt is already open, the operator is mid-naming. Opening the picker
    // again would overwrite the stored cwd underneath a dialog whose input still holds the OLD
    // typed name — submitting would then launch the NEW directory under the OLD name. Ignore.
    if (isModalOpen()) return
    let cwd: string | null
    try {
      cwd = await window.launch.pickDirectory()
    } catch {
      console.warn('[c9watch][launch] code=pick_directory_failed')
      return
    }
    if (cwd === null) return // cancel ⇒ no-op (no launch, no view change)
    // Prefill with the cwd basename — the pre-naming behavior, now a suggestion the operator
    // can replace (the dialog selects the text on mount so typing overwrites it).
    //
    // CLAMPED to the schema's cap: an over-long prefill would open the dialog in an invalid
    // state that the operator did not create. (The dialog ALSO refuses to submit over-length —
    // belt and braces — but clamping here means the common case just works.)
    const basename = (cwd.split('/').filter(Boolean).pop() ?? cwd).slice(0, SESSION_NAME_MAX_LENGTH)
    boardStore.getState().showSessionNamePrompt({ mode: 'create', cwd, initialName: basename })
  }, [])

  // Session templates — a template row was picked from the header popover. Skips the directory
  // picker entirely: the template already carries its cwd, so this opens the SAME name prompt
  // directly, prefilled with the template's name (clamped to the schema's cap, matching
  // handleNewSession's basename clamp) and carrying `templateId` so `submitLaunch` knows to
  // launch FROM the template rather than the plain folder flow.
  const handleTemplateSession = useCallback((template: Template): void => {
    if (isModalOpen()) return
    boardStore.getState().showSessionNamePrompt({
      mode: 'create',
      cwd: template.cwd,
      initialName: template.name.slice(0, SESSION_NAME_MAX_LENGTH),
      templateId: template.id
    })
  }, [])

  // Session templates — "Manage templates…" from the header popover. Opens the Manage-templates
  // modal (TemplatesDialog); guarded by the same single-modal rule as every other entry point.
  const handleManageTemplates = useCallback((): void => {
    if (isModalOpen()) return
    boardStore.getState().openTemplatesDialog()
  }, [])

  // Workspaces — "Manage workspaces…" from the header switcher. Opens the Manage-workspaces
  // modal (WorkspacesDialog); guarded by the same single-modal rule as every other entry point.
  const handleManageWorkspaces = useCallback((): void => {
    if (isModalOpen()) return
    boardStore.getState().openWorkspacesDialog()
  }, [])

  // Tags — "Manage tags…" from the ☰ menu's Tags submenu (and a card's or rail row's Create tags).
  // Same single-modal guard as every opener.
  const handleManageTags = useCallback((): void => {
    if (isModalOpen()) return
    boardStore.getState().openTagsDialog()
  }, [])

  // Rules — "Manage rules…" from the ☰ menu's Tags submenu. Same single-modal guard as every opener.
  const handleManageRules = useCallback((): void => {
    if (isModalOpen()) return
    boardStore.getState().openRulesDialog()
  }, [])

  // Settings — "Settings…" from the ☰ menu. Same single-modal guard as every opener.
  const handleOpenSettings = useCallback((): void => {
    if (isModalOpen()) return
    boardStore.getState().openSettingsDialog()
  }, [])

  // Phrase shortcuts — "Shortcuts…" from the ☰ menu. Same single-modal guard as every opener.
  const handleOpenShortcuts = useCallback((): void => {
    if (isModalOpen()) return
    boardStore.getState().openShortcutsDialog()
  }, [])

  // Past sessions (D-6) — "Past sessions…" from the ☰ menu. Same single-modal guard as every opener.
  const handleOpenPastSessions = useCallback((): void => {
    if (isModalOpen()) return
    boardStore.getState().openPastSessionsDialog()
  }, [])

  // Tags — a card's Tags… menu or a rail peek changed a session's tags. Never optimistic: the
  // tagged card comes back as a session.updated delta.
  const handleSetSessionTags = useCallback((sessionId: string, tagIds: string[]): void => {
    void setSessionTags(sessionId, tagIds)
  }, [])

  // Session-naming A2 — open the RENAME prompt for an EXISTING session. Reuses the same prompt
  // state and the same dialog as create; only the mode differs. Nothing is renamed here — the IPC
  // fires from `submitRename` (lib/namePromptFlow.ts) on submit, so cancelling is a complete no-op.
  //
  // Prefilled with the session's CURRENT name, read from the store at click time (session truth
  // projected from main). The re-entry guard mirrors `handleNewSession`: never replace the payload
  // under a dialog whose input already holds a typed value.
  const handleRenameSession = useCallback((sessionId: string): void => {
    const state = boardStore.getState()
    if (isModalOpen()) return
    const current = state.sessionsById[sessionId]
    if (current === undefined) return // gone (stopped/exited) ⇒ nothing to rename
    state.showSessionNamePrompt({
      mode: 'rename',
      sessionId,
      initialName: current.sessionName.slice(0, SESSION_NAME_MAX_LENGTH)
    })
  }, [])

  // Action feedback — an edit clears the prompt's error line (R26).
  const clearNamePromptError = useCallback((): void => {
    boardStore.getState().setSessionNamePromptError(null)
  }, [])

  // Task 12 — move an existing card to another workspace (the Board onMoveCardToWorkspace seam).
  // NOT optimistic: no local state write here. The moved card arrives as a normal
  // `session.updated` delta over the watch channel — the renderer never invents or mutates
  // session truth (state.md). An unknown session id is a logged no-op in main (a move racing a
  // stop that already removed the card).
  const handleMoveCardToWorkspace = useCallback((sessionId: string, workspaceId: string): void => {
    void window.launch.setWorkspace(sessionId, workspaceId)
  }, [])

  // Past sessions (D-3) — Archive a card (the Board onArchiveCard seam). Resolves the session's
  // terminalId (Column only wires the control once the binding is known, but re-check here too —
  // a race between the click and a removal is a no-op, not a crash) and fires the SAME
  // sessionExit.archiveTerminal the focused bar uses.
  const handleArchiveCard = useCallback((id: string): void => {
    const terminalId = boardStore.getState().terminalIdBySessionId[id]
    if (terminalId !== undefined) archiveTerminal(terminalId)
  }, [])

  // Past sessions (D-5) — Delete a card (the Board onDeleteCard seam): open the SAME confirm the
  // focused bar's Delete button opens. Single-modal / no-double-open guard mirrors every other
  // showStopConfirm call site (isModalOpen()).
  const handleDeleteCard = useCallback((id: string): void => {
    const state = boardStore.getState()
    const terminalId = state.terminalIdBySessionId[id]
    if (terminalId === undefined || isModalOpen() || state.stopConfirm !== null) return
    state.showStopConfirm({
      terminalId,
      sessionId: id,
      sessionName: state.sessionsById[id]?.sessionName ?? terminalId
    })
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

  // Story 6.1 — a STABLE void-returning wrapper of handleNewSession for the always-mounted
  // FocusedSession (same stability rule as handleBack). Threaded down to each EmbeddedTerminal.
  // Session-templates parity (2026-09-05): the dead pane's button now opens the SAME popover as
  // the header, and this is the flow behind its `Pick a folder…` row (picker → launch → focused
  // view). Its two sibling rows reach handleTemplateSession / handleManageTemplates — the very
  // same handlers the header button uses. Ctrl+N still calls this directly (the fast path).
  const handleNewSessionSync = useCallback((): void => {
    void handleNewSession()
  }, [handleNewSession])

  // Story 3.2 (FR-11 / UX-DR21) — global keybindings: Ctrl+N → new session; Esc → Board.
  // Story 4.2 (FR-14) — adds Ctrl+Q → requestQuit (the one chokepoint); Esc-guard-open → cancel.
  //
  // Focused-view keys (R1, R27, R10 — decision b, 2026-09-28): claude KEEPS EVERY KEY while its
  // terminal has focus. Ctrl+W is delete-word, Ctrl+N a readline key, Esc claude's interrupt — none
  // is the app's to take. So a key that comes from inside a terminal (`isInsideTerminal`) is left
  // alone here — no action, no preventDefault — whatever xterm itself does with it. The chords
  // below act only with focus OUTSIDE the terminal (the bar, the rail, the page body). Do not rely
  // on xterm's own stopPropagation for this: it does not stop every key it forwards.
  //
  // Esc disambiguation (RESOLVED — UX-DR14): topmost layer wins; the order is:
  //   1. Stop-confirm open → Esc = Cancel (clearStopConfirm); return.
  //   2. Quit-guard open → Esc = Cancel (clearQuitGuard + window.quit.cancel()); return.
  //   3. Else → showBoard (Focused → Board; no-op on the board).
  // The Stop-confirm and Quit-guard are mutually exclusive (single-modal rule), so the order
  // is defensive but safe. (Both take focus on open, so their Esc never comes from a terminal.)
  //
  // Gated on NON-smoke + NON-terminal-host below via the early returns, so this effect only runs
  // for the real app view. The handlers above never throw.
  //
  // All the Ctrl bindings carry `!e.altKey`: Ctrl+Alt+<letter> is the phrase-shortcut namespace.
  useEffect(() => {
    if (smoke !== false) return
    const onKey = (e: KeyboardEvent): void => {
      // R1 (decision b): the terminal owns every key typed into it.
      if (isInsideTerminal(e.target)) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        void handleNewSession()
        return
      }
      // Story 4.2 (FR-14 / UX-DR21) — Ctrl+Q → requestQuit (the ONE quit chokepoint).
      // The renderer NEVER calls app.quit() directly (sandboxed); it routes through
      // app:request-quit → main app.quit() → the one before-quit guard decision (FROZEN #3).
      // Guard: window.quit may be absent in pre-4.2 test environments (App.launch.test.tsx).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault()
        if (window.quit) void window.quit.requestQuit()
        return
      }
      // R27 — Ctrl+W ARCHIVES NOTHING. It used to archive the focused session with no confirm from
      // anywhere in the focused view, so a delete-word typed while focus had slipped off the
      // terminal (a rail click) archived the session. An arm-in-place second press would not help:
      // the reflex is to press it twice to delete two words. The bar's Archive button is the only
      // path. preventDefault stays so Ctrl+W can never close the window (UX-DR21).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        // Session-naming — Esc disambiguation, TOPMOST layer. The prompt names a NOT-YET-LAUNCHED
        // session, but it can be open while OTHER sessions run, so it is not exclusive by
        // construction — the Ctrl+N/Ctrl+W guards and the quit-guard handler are what keep it the
        // only modal on screen. Esc = cancel the pending launch entirely; no PTY was ever spawned,
        // so there is nothing to tear down.
        // All modals under isModalOpen() close here: the name prompt and the Templates/
        // Shortcuts/Workspaces dialogs never co-exist (every open call site guards on
        // isModalOpen()), so calling every closer is safe and covers the case where focus sits
        // on the page BODY — the dialog's own onKeyDown never sees that keydown.
        if (isDialogOpen()) {
          boardStore.getState().clearSessionNamePrompt()
          boardStore.getState().closeTemplatesDialog()
          boardStore.getState().closeShortcutsDialog()
          boardStore.getState().closeWorkspacesDialog()
          boardStore.getState().closeTagsDialog()
          boardStore.getState().closeRulesDialog()
          boardStore.getState().closeSettingsDialog()
          boardStore.getState().closePastSessionsDialog()
          return
        }
        // Story 4.3 — Esc disambiguation: if the Stop-confirm is open, Esc = Cancel it.
        // (UX-DR14: close the topmost layer.) Return without falling through.
        if (boardStore.getState().stopConfirm !== null) {
          boardStore.getState().clearStopConfirm()
          return
        }
        // Story 4.2 — Esc disambiguation: if the Quit-guard is open, Esc = Cancel the guard
        // (UX-DR14: close the topmost layer). Return without falling through to showBoard.
        if (boardStore.getState().quitGuard !== null) {
          boardStore.getState().clearQuitGuard()
          if (window.quit) void window.quit.cancel()
          return
        }
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
          <span className={styles.brand}>Claude Watcher · terminals (3.1 proof)</span>
          <Settings />
        </header>
        <main className={styles.main}>
          <TerminalHost count={terminalCount} />
        </main>
      </div>
    )
  }

  // Story 3.2 (FR-11) → Story 3.4 (B-1 fix) — the real app view: a header with `+ New session`
  // (UX-DR21) + the ☰ menu, and the body switching Board ↔ Focused-session by `viewMode` (renderer
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
  // Session-naming / session templates / workspaces: while the name prompt OR the Manage-
  // templates/Manage-shortcuts/Manage-workspaces dialog is open, everything behind it is INERT
  // (UX-DR14 — "a modal is open", not just the name prompt). Without this, Tab walks out of the
  // dialog into the header "+ New session" button and on into the live xterm textarea — so
  // keystrokes reach a running claude session while a modal is on screen. None of these dialogs
  // render a focus trap of their own; this is the trap. The name stays — it now means "a modal
  // is open," not just "the name prompt is open."
  const namePromptOpen =
    sessionNamePrompt !== null ||
    templatesDialogOpen ||
    shortcutsDialogOpen ||
    workspacesDialogOpen ||
    tagsDialogOpen ||
    rulesDialogOpen ||
    settingsDialogOpen ||
    pastSessionsDialogOpen ||
    // R9 — the Delete confirm and the Quit guard are modals too: Shift+Tab out of the confirm
    // reached the live terminal behind it.
    stopConfirm !== null ||
    quitGuard !== null

  return (
    <div className={styles.app}>
      <header className={styles.header} data-testid="app-header" inert={namePromptOpen}>
        {/* The switcher sits beside the brand, apart from the actions: it says WHERE you are. */}
        <div className={styles.headerLead}>
          <span className={styles.brand}>Claude Watcher</span>
          <span className={styles.headerDivider} aria-hidden="true" />
          <WorkspaceSwitcher onManage={handleManageWorkspaces} />
        </div>
        <div className={styles.headerActions}>
          <NewSessionButton
            onPickFolder={() => void handleNewSession()}
            onPickTemplate={handleTemplateSession}
            onManage={handleManageTemplates}
          />
          {/* The ONE header control besides + New session: Settings…, Shortcuts…, the Tags
              submenu and Past sessions… (last). It filters nothing: the tag filter is the board's
              FilterBar. */}
          <AppMenu
            onOpenSettings={handleOpenSettings}
            onOpenShortcuts={handleOpenShortcuts}
            onManageTags={handleManageTags}
            onManageRules={handleManageRules}
            onOpenPastSessions={handleOpenPastSessions}
          />
        </div>
      </header>
      {/* UX-05 — the hook ingest is down: say so on every view until it is back. */}
      <ServerHealthBanner health={serverHealth} />
      {/* UX-06 / UX-07 — a store file that could not be read or written: say so until dismissed. */}
      <StorageNotice health={storageHealth} />
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
            inert={showFocused || namePromptOpen}
          >
            <Board
              onNewSession={() => void handleNewSession()}
              onPickTemplate={handleTemplateSession}
              onManageTemplates={handleManageTemplates}
              onActivateCard={handleActivateCard}
              onRenameCard={handleRenameSession}
              onMoveCardToWorkspace={handleMoveCardToWorkspace}
              onSetCardTags={handleSetSessionTags}
              onManageTags={handleManageTags}
              onArchiveCard={handleArchiveCard}
              onDeleteCard={handleDeleteCard}
            />
          </div>
          {hasFocusableTerminal && (
            <div
              className={styles.viewLayer}
              data-testid="focused-layer"
              data-active={showFocused}
              style={showFocused ? undefined : { visibility: 'hidden' }}
              aria-hidden={!showFocused}
              inert={!showFocused || namePromptOpen}
            >
              <FocusedSession
                onBack={handleBack}
                onNewSession={handleNewSessionSync}
                onPickTemplate={handleTemplateSession}
                onManageTemplates={handleManageTemplates}
                onRenameSession={handleRenameSession}
                onSetSessionTags={handleSetSessionTags}
                onManageTags={handleManageTags}
              />
            </div>
          )}
        </div>
      </main>
      {/* Story 4.2 (FR-14) — the Quit-guard modal (renderer view-state; non-null when main
          detected ≥1 live app-launched session at quit time). Rendered as a stacked overlay
          (z-60, above Settings z-50) — UX-DR14 single-modal rule: the guard takes precedence.
          The Quit-guard modal does NOT teardown on close (FROZEN #1 — no teardown-via-unmount).
          Cancel → clearQuitGuard() + window.quit.cancel(). Esc = Cancel (guarded in keydown). */}
      {quitGuard !== null && <QuitGuard payload={quitGuard} />}
      {/* Past sessions (D-5) — the Delete-confirm modal (was Story 4.3's Stop-confirm; renderer
          view-state, non-null when the operator triggered Delete from a card, the focused bar's
          Delete button, or App's onDeleteCard seam — never from Archive, which has no
          confirm). Rendered as a stacked overlay (z-60, same layer as QuitGuard — they never
          co-exist per the single-modal rule UX-DR14). Does NOT teardown on open (FROZEN F1 — the
          explicit delete runs INSIDE the modal's confirm handler, not on mount/unmount).
          Cancel → clearStopConfirm(). Delete → sessionExit.deleteTerminal (window.launch.deleteSession
          THEN clearStopConfirm + showBoard). Esc = Cancel (guarded in keydown above). */}
      {stopConfirm !== null && <StopConfirm payload={stopConfirm} />}
      {/* Session templates — the Manage-templates modal (renderer view-state; UX-DR14 single-modal
          rule enforced by isModalOpen() at every open call site + the quit-guard listener above). */}
      {templatesDialogOpen && (
        <TemplatesDialog onClose={() => boardStore.getState().closeTemplatesDialog()} />
      )}
      {/* Phrase shortcuts — the Manage-shortcuts modal (renderer view-state; same z-60 layer and
          the same UX-DR14 single-modal rule as the Templates dialog). */}
      {shortcutsDialogOpen && (
        <ShortcutsDialog onClose={() => boardStore.getState().closeShortcutsDialog()} />
      )}
      {/* Workspaces — the Manage-workspaces modal (renderer view-state; same z-60 layer and the
          same UX-DR14 single-modal rule as the Templates/Shortcuts dialogs). */}
      {workspacesDialogOpen && (
        <WorkspacesDialog onClose={() => boardStore.getState().closeWorkspacesDialog()} />
      )}
      {/* Tags — the Manage-tags modal (same z-60 layer and single-modal rule as the three above). */}
      {tagsDialogOpen && <TagsDialog onClose={() => boardStore.getState().closeTagsDialog()} />}
      {/* Rules — the Manage-rules modal (same z-60 layer and single-modal rule). */}
      {rulesDialogOpen && <RulesDialog onClose={() => boardStore.getState().closeRulesDialog()} />}
      {/* Settings — the Settings dialog (☰ menu → Settings…; same single-modal rule). */}
      {settingsDialogOpen && (
        <SettingsPanel onClose={() => boardStore.getState().closeSettingsDialog()} />
      )}
      {/* Past sessions (D-6) — the history dialog (☰ menu → Past sessions…; same z-60 layer and
          single-modal rule). Its Open takes the view itself (pastSessionsStore.openPastSession). */}
      {pastSessionsDialogOpen && (
        <PastSessionsDialog onClose={() => boardStore.getState().closePastSessionsDialog()} />
      )}
      {/* Session-naming — the create-time NAME PROMPT (renderer view-state; non-null between the
          directory picker returning a path and main answering the submit). Before submit NOTHING is
          spawned, so Cancel/Esc is a complete no-op. Submit fires the launch (submitLaunch) and the
          prompt stays open, busy, until main answers; a Cancel then leaves the result to the flow's
          late-result path (registry only, never the view). Same z-60 overlay layer as the other
          two modals — it cannot co-exist with them (it only lives before a session exists). */}
      {sessionNamePrompt !== null &&
        (sessionNamePrompt.mode === 'create' ? (
          <SessionNameDialog
            // The dialog seeds its input from `initialName` on MOUNT only. Keying on the
            // templateId (falling back to the cwd for the plain folder flow) forces a REMOUNT if
            // the payload is ever replaced under it, so the input can never show one directory's
            // name while `onSubmit` closes over another's path/template. `handleNewSession` /
            // `handleTemplateSession` already refuse to re-enter while a prompt is open — this is
            // the second line.
            key={`create:${sessionNamePrompt.templateId ?? sessionNamePrompt.cwd}`}
            initialName={sessionNamePrompt.initialName}
            hint={sessionNamePrompt.cwd}
            busy={sessionNamePromptBusy}
            busyLabel="Starting…"
            error={sessionNamePromptError}
            onEdit={clearNamePromptError}
            onSubmit={(name) => void submitLaunch(sessionNamePrompt, name)}
            onCancel={() => boardStore.getState().clearSessionNamePrompt()}
          />
        ) : (
          // A2 — the SAME dialog, reused unchanged (that is why it was built generic). Only the
          // copy and the submit target differ: rename an existing session instead of launching a
          // new one. Keyed by session id for the same remount reason as create.
          <SessionNameDialog
            key={`rename:${sessionNamePrompt.sessionId}`}
            initialName={sessionNamePrompt.initialName}
            title="Rename session"
            confirmLabel="Rename"
            helper="Applies in Claude on your next prompt."
            busy={sessionNamePromptBusy}
            busyLabel="Renaming…"
            error={sessionNamePromptError}
            onEdit={clearNamePromptError}
            onSubmit={(name) => void submitRename(sessionNamePrompt, name)}
            onCancel={() => boardStore.getState().clearSessionNamePrompt()}
          />
        ))}
      {/* Action feedback — toasts. A sibling of the modals, never inside the header or a view
          layer, so it is not `inert` under a dialog: its ✕ works over one. */}
      <Toaster />
    </div>
  )
}

export default App
