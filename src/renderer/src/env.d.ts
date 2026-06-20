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
  Settings,
  SettingsPatch,
  TerminalExitEvent,
  SessionPickDirectoryResult,
  SessionLaunchResult,
  LaunchCorrelatedEvent,
  PtyExitEvent,
  SmokeConfig,
  SmokeReport,
  QuitGuardPayload
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
      // Story 1.4 fix — the watch CONNECTION-state subscription (reconnect banner driver).
      onStatus(cb: (status: WatchStatus) => void): () => void
    }
    // Story 2.2 (FR-9) — mirrors src/preload/index.ts `attentionApi`. The in-app
    // jump-to-card subscription (the operator activated a notification). View-state only.
    attention: {
      onActivate(cb: (payload: AttentionActivatePayload) => void): () => void
    }
    // Story 2.4 — mirrors src/preload/index.ts `settingsApi`. The renderer reads/writes
    // settings ONLY through this typed bridge (never electron-store directly — F4). MAIN
    // owns the persisted authority; get/set are typed invokes over CH.settingsGet/Set.
    settings: {
      get(): Promise<Settings>
      set(patch: SettingsPatch): Promise<Settings>
    }
    // Story 3.1 (FR-10) — mirrors src/preload/index.ts `terminalApi`. The renderer reaches
    // the PTY ONLY through this typed bridge + the transferred MessagePort (the `open`
    // callback's `port` arg) — never ipcRenderer/Node directly (F4). Lifecycle/control rides
    // typed IPC; the byte path rides the MessagePort imperatively (never the store).
    terminal: {
      open(terminalId: string, cb: (port: MessagePort) => void): () => void
      resize(terminalId: string, cols: number, rows: number): Promise<void>
      stop(terminalId: string): Promise<void>
      onExit(cb: (info: TerminalExitEvent) => void): () => void
    }
    // Story 3.2 (FR-11) — mirrors src/preload/index.ts `launchApi`. The renderer triggers the
    // native picker + the raw `claude` launch ONLY through this typed bridge (never a dialog or
    // ipcRenderer directly — F2/F8). Both are typed invokes over CH.sessionPickDirectory/Launch.
    launch: {
      pickDirectory(): Promise<SessionPickDirectoryResult>
      launch(cwd: string): Promise<SessionLaunchResult>
      // Story 3.4 (FR-16) — the launch CORRELATION push subscription ({ terminalId, sessionId },
      // fired once when a launch's Tgid join lands). Builds the renderer's terminalIdBySessionId.
      onCorrelated(cb: (event: LaunchCorrelatedEvent) => void): () => void
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
  }
}
