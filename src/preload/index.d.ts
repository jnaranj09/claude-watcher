import type {
  PtyApi,
  WatchApi,
  AttentionApi,
  SettingsApi,
  TerminalApi,
  LaunchApi,
  TelemetryApi,
  QuitApi,
  ClipboardApi
} from './index'

declare global {
  interface Window {
    pty: PtyApi
    // Story 1.4 — the watch-events subscription bridge (main→renderer push).
    watch: WatchApi
    // Story 2.2 (FR-9) — the in-app jump-to-card subscription bridge (main→renderer push).
    attention: AttentionApi
    // Story 2.4 — the settings read/write bridge (typed invoke over CH.settingsGet/Set).
    settings: SettingsApi
    // Story 3.1 (FR-10) — the embedded-terminal bridge (lifecycle IPC + MessagePort byte path).
    terminal: TerminalApi
    // Story 3.2 (FR-11) — the in-app launch bridge (native picker + raw claude launch invokes).
    launch: LaunchApi
    // Story 3.5 (SM-2) — the telemetry bridge: acknowledge → main signal (wait duration computed in MAIN).
    telemetry: TelemetryApi
    // Story 4.2 (FR-14) — the quit-guard bridge (requestQuit / confirm / cancel / onGuardShow).
    quit: QuitApi
    // Terminal clipboard feature — OS clipboard text bridge (read-text / write-text via MAIN).
    // Power stays in MAIN (Electron clipboard module; renderer never touches OS clipboard directly).
    clipboard: ClipboardApi
  }
}
