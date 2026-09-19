/// <reference types="vite/client" />

// Story 1.4 — the renderer-side `Window` augment for the preload bridges. The web
// build program ALSO sees the preload's own augment (it includes src/preload/*.d.ts);
// the `tsconfig.test.json` program does NOT, so we declare it here too (this env.d.ts
// is included by both programs). TypeScript MERGES identical interface augments, so the
// two declarations co-exist as long as the member types match. The types are sourced
// from the shared contract (which the renderer may import), not from src/preload
// (which the sandboxed renderer must never reach into).
import type {
  WatchEventsPayload,
  WatchStatus,
  AttentionActivatePayload,
  AttentionReminderPayload,
  Settings,
  SettingsPatch,
  TerminalExitEvent,
  SessionPickDirectoryResult,
  SessionLaunchResult,
  LaunchCorrelatedEvent,
  LaunchRequestedEvent,
  ApiTokenResult,
  PtyExitEvent,
  SmokeConfig,
  SmokeReport,
  QuitGuardPayload,
  Template,
  TemplateSaveRequest,
  TemplatesSaveResult,
  Shortcut,
  ShortcutSaveRequest,
  ShortcutsSaveResult,
  WorkspaceSaveRequest,
  WorkspacesListResult,
  WorkspacesSaveResult,
  Tag,
  TagSaveRequest,
  TagsSaveResult,
  RuleSaveRequest,
  RulesListResult,
  RulesSaveResult,
  PastSession,
  PastSessionOpenResult
} from '../../shared/ipc/contract'

declare global {
  interface Window {
    // Story 0.1 — the single-PTY smoke bridge (SmokeCockpit). The test program does not see the
    // preload's own augment, so it is dual-declared here (sourced from the shared contract, never
    // from src/preload). Story 3.2 pulled App/SmokeCockpit into the test program (App.launch.test
    // imports App), so this declaration is now required for tsconfig.test too.
    pty: {
      start(): void
      input(data: string): void
      resize(cols: number, rows: number): void
      onData(cb: (data: string) => void): () => void
      onExit(cb: (info: PtyExitEvent) => void): () => void
      smokeConfig(): Promise<SmokeConfig>
      smokeReport(report: SmokeReport): void
    }
    // Mirrors src/preload/index.ts `watchApi` — the watch subscription bridges.
    watch: {
      onEvents(cb: (payload: WatchEventsPayload) => void): () => void
      // Story 5.3/6.4 — the watch:status subscription (the engine-started cold-load signal).
      onStatus(cb: (status: WatchStatus) => void): () => void
    }
    // Story 2.2 (FR-9) — mirrors src/preload/index.ts `attentionApi`. The in-app
    // jump-to-card subscription (the operator activated a notification). View-state only.
    attention: {
      onActivate(cb: (payload: AttentionActivatePayload) => void): () => void
      // Attention reminders — mirrors src/preload/index.ts `attentionApi.onReminder`.
      onReminder(cb: (payload: AttentionReminderPayload) => void): () => void
    }
    // Story 2.4 — mirrors src/preload/index.ts `settingsApi`. The renderer reads/writes
    // settings ONLY through this typed bridge (never electron-store directly — F4). MAIN
    // owns the persisted authority; get/set are typed invokes over CH.settingsGet/Set.
    settings: {
      get(): Promise<Settings>
      set(patch: SettingsPatch): Promise<Settings>
    }
    // Story 3.1 (FR-10) — mirrors src/preload/index.ts `terminalApi`. The renderer reaches
    // the PTY ONLY through this typed bridge + the transferred MessagePort — never
    // ipcRenderer/Node directly (F4). Lifecycle/control rides typed IPC; the byte path rides
    // the MessagePort delivered via the main-world-port pattern (story 5.1 fix: no callback arg).
    // Story 5.1: `open` no longer takes a callback. The preload forwards the real port via
    // `window.postMessage(TERMINAL_PORT_TAG, '*', [port])`; the renderer pairs it via a `window`
    // `'message'` listener keyed on TERMINAL_PORT_TAG + terminalId. Story 5.4: `open` takes a
    // per-open `openToken` (echoed by main) so the listener pairs THIS port to THIS open, never the
    // stale port from a prior open of the same terminalId (StrictMode double-mount / Reopen).
    // Story 5.6: `stop` gains an optional `openToken`; when provided, a stale StrictMode cleanup-stop
    // (token mismatch) is a no-op in main — the PTY stays alive, wired to the new mount's port.
    terminal: {
      open(terminalId: string, openToken: string): () => void
      resize(terminalId: string, cols: number, rows: number): Promise<void>
      stop(terminalId: string, openToken?: string): Promise<void>
      onExit(cb: (info: TerminalExitEvent) => void): () => void
    }
    // Story 3.2 (FR-11) — mirrors src/preload/index.ts `launchApi`. The renderer triggers the
    // native picker + the raw `claude` launch ONLY through this typed bridge (never a dialog or
    // ipcRenderer directly — F2/F8). Both are typed invokes over CH.sessionPickDirectory/Launch.
    launch: {
      pickDirectory(): Promise<SessionPickDirectoryResult>
      // Session-naming: `name` is the operator-typed label from the create-time prompt.
      launch(cwd: string, name: string): Promise<SessionLaunchResult>
      // Session-naming A2 — retitle an EXISTING session by its stable session id. Rejects on an
      // illegal name (same SessionNameSchema as create); the retitled card arrives as a
      // `session.updated` delta, not as the resolve value.
      rename(id: string, name: string): Promise<void>
      // Workspaces (Task 12) — move an existing card to another workspace by its stable session
      // id. Resolves void; the moved card arrives as a normal `session.updated` delta, not as
      // the resolve value (mirrors `rename` above — never optimistic).
      setWorkspace(sessionId: string, workspaceId: string): Promise<void>
      // Tags — replace a card's tags by its stable session id. Resolves void; the tagged card
      // arrives as a `session.updated` delta (mirrors `setWorkspace`).
      setTags(sessionId: string, tagIds: string[]): Promise<void>
      // Deterministic-attention (Task 6) — report "the operator is viewing this session" (active
      // rail tab, focused window). Main demotes ONLY a YourTurn session to idle; questions/
      // permissions are untouched. Rejects on a blank id (parse-and-throw at the main boundary).
      markSeen(id: string): Promise<void>
      // Story 3.4 (FR-16) — the launch CORRELATION push subscription ({ terminalId, sessionId },
      // fired once when a launch's Tgid join lands). Builds the renderer's terminalIdBySessionId.
      onCorrelated(cb: (event: LaunchCorrelatedEvent) => void): () => void
      // Session templates — launch `claude` from a saved template by its stable id. Main
      // resolves the template's flags from its own validated store; the renderer sends only
      // the templateId + operator-typed name.
      launchFromTemplate(templateId: string, name: string): Promise<SessionLaunchResult>
      // Programmatic API — the `launch:requested` push subscription ({ terminalId, label,
      // workspaceId }). Main registered the recipe; the renderer opens the terminal for the
      // API-created card exactly as a UI launch does. Returns an unsubscribe fn.
      onLaunchRequested(cb: (event: LaunchRequestedEvent) => void): () => void
      // Past sessions (D-3) — archive this terminal's session (stop + record + remove the card;
      // no confirmation). Resolves void; the card leaves as a normal `session.removed` delta.
      archiveSession(terminalId: string): Promise<void>
      // Past sessions (D-3/D-4) — delete: stop the pty, remove any record, remove the card, after
      // the Delete confirm. `sessionId` is only a hint: null before the renderer correlated the pane
      // and once its card is gone — main finds an exited pane's record itself (its last bound id).
      deleteSession(terminalId: string, sessionId: string | null): Promise<void>
    }
    // Session templates — mirrors src/preload/index.ts `templatesApi`.
    templates: {
      list(): Promise<Template[]>
      save(req: TemplateSaveRequest): Promise<TemplatesSaveResult>
      remove(id: string): Promise<Template[]>
    }
    // Past sessions — mirrors src/preload/index.ts `pastSessionsApi`.
    pastSessions: {
      list(): Promise<PastSession[]>
      forget(id: string): Promise<PastSession[]>
      open(id: string): Promise<PastSessionOpenResult>
    }
    // Phrase shortcuts — mirrors src/preload/index.ts `shortcutsApi`. The renderer reaches the
    // shortcuts store ONLY through this typed bridge (never electron-store, never ipcRenderer).
    shortcuts: {
      list(): Promise<Shortcut[]>
      save(req: ShortcutSaveRequest): Promise<ShortcutsSaveResult>
      remove(id: string): Promise<Shortcut[]>
    }
    // Workspaces — mirrors src/preload/index.ts `workspacesApi`. `remove`, not `delete`
    // (reserved word), so the store and the bridge share one verb — same as templatesApi.
    workspaces: {
      list(): Promise<WorkspacesListResult>
      save(req: WorkspaceSaveRequest): Promise<WorkspacesSaveResult>
      remove(id: string): Promise<WorkspacesListResult>
      setActive(id: string): Promise<WorkspacesListResult>
    }
    // Tags — mirrors src/preload/index.ts `tagsApi`.
    tags: {
      list(): Promise<Tag[]>
      save(req: TagSaveRequest): Promise<TagsSaveResult>
      remove(id: string): Promise<Tag[]>
    }
    // Rules — mirrors src/preload/index.ts `rulesApi`.
    rules: {
      list(): Promise<RulesListResult>
      save(req: RuleSaveRequest): Promise<RulesSaveResult>
      remove(id: string): Promise<RulesListResult>
      move(id: string, toIndex: number): Promise<RulesListResult>
    }
    // Story 3.5 (SM-2) — mirrors src/preload/index.ts `telemetryApi`. The renderer signals the
    // acknowledge moment ONLY through this typed bridge (never ipcRenderer directly — F4).
    // MAIN computes the wait duration from the tracker's enteredColumnAt; the renderer sends only
    // { sessionId, acknowledgedAt }. UNTRUSTED cross-process input → parse-and-throw in MAIN.
    telemetry: {
      acknowledge(sessionId: string, acknowledgedAt: number): Promise<void>
    }
    // Story 4.2 (FR-14) — mirrors src/preload/index.ts `quitApi`. The renderer initiates quit,
    // confirms, or cancels the quit guard ONLY through this typed bridge (never app.quit() or
    // ipcRenderer directly — sandboxed renderer). Session truth stays MAIN-owned.
    quit: {
      requestQuit(): Promise<void>
      confirm(): Promise<void>
      cancel(): Promise<void>
      onGuardShow(cb: (payload: QuitGuardPayload) => void): () => void
    }
    // Terminal clipboard feature — mirrors src/preload/index.ts `clipboardApi`. The renderer
    // reads/writes the OS clipboard ONLY through this typed bridge — never navigator.clipboard
    // or any direct OS access (sandbox: true; power stays in MAIN via Electron clipboard module).
    // IMAGE paste does NOT ride this bridge: the renderer forwards `\x16` and `claude` reads
    // the OS image itself. This bridge is TEXT-only. [spec-terminal-clipboard.md]
    clipboard: {
      readText(): Promise<string>
      writeText(text: string): Promise<void>
    }
    // Programmatic API — mirrors src/preload/index.ts `apiApi`. MAIN owns the bearer-token file;
    // the Settings panel reads it and regenerates it ONLY through this typed bridge.
    api: {
      getToken(): Promise<ApiTokenResult>
      regenerateToken(): Promise<ApiTokenResult>
    }
  }
}
