import { contextBridge, ipcRenderer } from 'electron'
// Story 0.2 — channels go through the typed contract, never string literals.
import { CH, TERMINAL_PORT_TAG } from '../shared/ipc/contract'
import type {
  PtyExitEvent,
  SmokeConfig,
  SmokeReport,
  WatchEventsPayload,
  WatchStatus,
  AttentionActivatePayload,
  Settings,
  SettingsPatch,
  TerminalExitEvent,
  SessionPickDirectoryResult,
  SessionLaunchRequest,
  SessionLaunchResult,
  SessionRenameRequest,
  SessionSeenRequest,
  LaunchCorrelatedEvent,
  TelemetryAcknowledgeRequest,
  QuitGuardPayload,
  Template,
  TemplateSaveRequest,
  TemplateDeleteRequest,
  TemplatesSaveResult,
  SessionLaunchFromTemplateRequest
} from '../shared/ipc/contract'

// Story 0.1 minimal typed bridge for the single-PTY smoke.
// contextIsolation stays ON — the renderer gets ONLY these functions, never
// Node or ipcRenderer directly. This is the typed preload seam the architecture
// mandates (never nodeIntegration).
const ptyApi = {
  /** Ask main to spawn the PTY (call once the terminal element is sized). */
  start(): void {
    ipcRenderer.send(CH.ptyStart)
  },
  /** Send keystrokes to the PTY. */
  input(data: string): void {
    ipcRenderer.send(CH.ptyInput, data)
  },
  /** Tell main the new PTY dimensions (renderer computes cols/rows first). */
  resize(cols: number, rows: number): void {
    ipcRenderer.send(CH.ptyResize, { cols, rows })
  },
  /** Subscribe to PTY output bytes. Returns an unsubscribe fn. */
  onData(cb: (data: string) => void): () => void {
    const listener = (_evt: unknown, data: string): void => cb(data)
    ipcRenderer.on(CH.ptyData, listener)
    return () => ipcRenderer.removeListener(CH.ptyData, listener)
  },
  /** Subscribe to PTY exit. Returns an unsubscribe fn. */
  onExit(cb: (info: PtyExitEvent) => void): () => void {
    const listener = (_evt: unknown, info: PtyExitEvent): void => cb(info)
    ipcRenderer.on(CH.ptyExit, listener)
    return () => ipcRenderer.removeListener(CH.ptyExit, listener)
  },
  // --- Story 0.1 smoke harness (AC-3) ---
  /** Get smoke config (enabled flag + main-process ABI versions). */
  smokeConfig(): Promise<SmokeConfig> {
    return ipcRenderer.invoke(CH.smokeConfig)
  },
  /** Post the smoke verdict; main persists it and exits. */
  smokeReport(report: SmokeReport): void {
    ipcRenderer.send(CH.smokeReport, report)
  }
}

export type PtyApi = typeof ptyApi

// Story 1.4 — the watch bridge: a push-only main→renderer subscription for the
// epoch-framed c9watch deltas (`session.updated`/`session.removed`/`attention.raised`).
// The renderer subscribes via `window.watch.onEvents(...)` and NEVER touches
// ipcRenderer directly (contextIsolation stays ON). Mirrors `ptyApi.onData`'s
// subscribe-returns-unsubscribe pattern. `CH.watchEvents` is a const, never a literal.
const watchApi = {
  /** Subscribe to epoch-framed c9watch deltas. Returns an unsubscribe fn. */
  onEvents(cb: (payload: WatchEventsPayload) => void): () => void {
    const listener = (_evt: unknown, payload: WatchEventsPayload): void => cb(payload)
    ipcRenderer.on(CH.watchEvents, listener)
    return () => ipcRenderer.removeListener(CH.watchEvents, listener)
  },
  /** Story 1.4 fix — subscribe to the watch CONNECTION state (reconnecting on/off).
   *  This drives the reconnect banner off main's REAL signal, not line silence.
   *  Returns an unsubscribe fn. `CH.watchStatus` is a const, never a literal. */
  onStatus(cb: (status: WatchStatus) => void): () => void {
    const listener = (_evt: unknown, status: WatchStatus): void => cb(status)
    ipcRenderer.on(CH.watchStatus, listener)
    return () => ipcRenderer.removeListener(CH.watchStatus, listener)
  }
}

export type WatchApi = typeof watchApi

// Story 2.2 (FR-9) — the attention bridge: a push-only main→renderer subscription for the
// in-app jump-to-card signal. The renderer subscribes via `window.attention.onActivate(...)`
// and NEVER touches ipcRenderer directly (contextIsolation stays ON). Mirrors `watchApi`'s
// subscribe-returns-unsubscribe pattern. `CH.attentionActivate` is a const, never a literal.
// INFORMATIONAL ONLY: this carries the session `id` so the renderer can SELECT the card; it
// does NOT raise/focus the window (AR-8 self-raise cut).
const attentionApi = {
  /** Subscribe to the in-app jump-to-card signal (the operator activated a notification).
   *  Returns an unsubscribe fn. `CH.attentionActivate` is a const, never a literal. */
  onActivate(cb: (payload: AttentionActivatePayload) => void): () => void {
    const listener = (_evt: unknown, payload: AttentionActivatePayload): void => cb(payload)
    ipcRenderer.on(CH.attentionActivate, listener)
    return () => ipcRenderer.removeListener(CH.attentionActivate, listener)
  }
}

export type AttentionApi = typeof attentionApi

// Story 2.4 — the settings bridge: typed invoke wrappers over CH.settingsGet/CH.settingsSet.
// The renderer reads/writes settings via `window.settings.*` and NEVER touches ipcRenderer or
// electron-store directly (contextIsolation stays ON; MAIN owns the persisted authority — F4).
// Mirrors `ptyApi.smokeConfig`'s invoke pattern. `CH.*` consts, never string literals.
const settingsApi = {
  /** Read the current persisted settings (main is the authority). */
  get(): Promise<Settings> {
    return ipcRenderer.invoke(CH.settingsGet)
  },
  /** Apply a partial settings patch; main validates (parse-and-throw on bad input), persists,
   *  and returns the new validated settings. Rejects the promise on invalid input. */
  set(patch: SettingsPatch): Promise<Settings> {
    return ipcRenderer.invoke(CH.settingsSet, patch)
  }
}

export type SettingsApi = typeof settingsApi

// Story 3.1 (FR-10) — the embedded-terminal bridge. The renderer reaches the PTY ONLY
// through this typed bridge + the transferred MessagePort — NEVER ipcRenderer/Node directly
// (F4; contextIsolation stays ON). The LIFECYCLE/control rides typed IPC (CH.* consts):
// open/resize/stop + the dead-terminal onExit push. The BYTE path rides the MessagePort that
// `terminal:open` transfers — delivered to the renderer via the main-world-port pattern.
//
// Story 5.1 fix: `contextBridge` CANNOT marshal a live `MessagePort` as a function-call
// argument across the isolated→main world boundary — it arrives stripped of its methods
// (`port.start`/`port.postMessage`/`onmessage` undefined). The ONLY supported way to get
// a live port into the sandboxed main world is the documented Electron "MessagePort in the
// main world" pattern: preload forwards the real port via `window.postMessage(tag, '*', [port])`
// (from the isolated world — which shares the SAME window event loop as the main world),
// and the renderer reads `e.ports[0]` from a `window` `'message'` listener.
// `CH.terminalOpen` stays the lifecycle/port-transfer channel; NO new IPC channel.
// `TERMINAL_PORT_TAG` is the shared payload tag (NOT a CH.* channel; ipc.md no-literal-channels
// targets ipcMain/ipcRenderer call sites, NOT window.postMessage tags).
const terminalApi = {
  /** Open a terminal for `terminalId` with a per-open `openToken` (Story 5.4 — fresh per
   *  create-effect run; disambiguates a re-open of the same id). Main spawns a pty + transfers the
   *  MessagePort the bytes ride, echoing the token. The preload forwards the real port to the main
   *  world via `window.postMessage({ tag: TERMINAL_PORT_TAG, terminalId, openToken }, '*', [port])`
   *  so the renderer can pair THIS port to THIS open via a `window` `'message'` listener (the
   *  documented Electron main-world-port pattern). Returns an unsubscribe fn (call on cleanup). */
  open(terminalId: string, openToken: string): () => void {
    const listener = (
      event: Electron.IpcRendererEvent,
      payload: { terminalId: string; openToken: string }
    ): void => {
      // Fire only for THIS terminalId AND THIS open's token (Story 5.4). The CH.terminalOpen reply
      // channel is shared across terminals AND across re-opens of the same terminalId (a StrictMode
      // dev double-mount, or Reopen) — matching terminalId alone could forward the STALE port from a
      // prior open of the same id. Preserve on-before-send ordering (listener registered BEFORE
      // send, so the reply from main cannot be missed — src/preload/index.ts ordering invariant).
      const port = event.ports[0]
      if (payload.terminalId === terminalId && payload.openToken === openToken && port) {
        // Forward the REAL port into the main world via window.postMessage. The isolated world
        // shares the same window event loop; the transfer list delivers a live port the renderer
        // reads as `e.ports[0]` from a `window` `'message'` listener. Echo the token so the
        // renderer pairs THIS port to THIS open.
        window.postMessage({ tag: TERMINAL_PORT_TAG, terminalId, openToken }, '*', [port])
      }
    }
    // Register listener BEFORE send (on-before-send ordering — cannot miss the reply).
    ipcRenderer.on(CH.terminalOpen, listener)
    ipcRenderer.send(CH.terminalOpen, { terminalId, openToken })
    return () => ipcRenderer.removeListener(CH.terminalOpen, listener)
  },
  /** Resize the terminal's pty (renderer computed cols/rows via fit() FIRST; main resizes the
   *  pty FIRST, then the terminal reflows — terminal.md). Rejects on a malformed dim. */
  resize(terminalId: string, cols: number, rows: number): Promise<void> {
    return ipcRenderer.invoke(CH.terminalResize, { terminalId, cols, rows })
  },
  /** Stop + destroy the terminal (port.close() THEN pty.kill() in main).
   *  Story 5.6 — the optional `openToken` lets the manager identify and no-op a stale
   *  StrictMode cleanup-stop (where the token no longer matches the current open). Omitting it
   *  (user-initiated stop from StopConfirm / dead-pane Stop) is an unconditional kill. */
  stop(terminalId: string, openToken?: string): Promise<void> {
    return ipcRenderer.invoke(CH.terminalStop, {
      terminalId,
      ...(openToken !== undefined ? { openToken } : {})
    })
  },
  /** Subscribe to the dead-terminal push (the pty exited/died). Returns an unsubscribe fn.
   *  Drives the per-terminal "Terminal exited." pane (UX-DR18). `CH.terminalExit` is a const. */
  onExit(cb: (info: TerminalExitEvent) => void): () => void {
    const listener = (_evt: unknown, info: TerminalExitEvent): void => cb(info)
    ipcRenderer.on(CH.terminalExit, listener)
    return () => ipcRenderer.removeListener(CH.terminalExit, listener)
  }
}

export type TerminalApi = typeof terminalApi

// Story 3.2 (FR-11) — the in-app LAUNCH bridge. The renderer triggers the native KDE directory
// picker + the raw `claude` launch ONLY through this typed bridge — NEVER ipcRenderer/Node or a
// dialog directly (F2/F8; contextIsolation stays ON). Both are typed invokes (CH.* consts):
//   - `pickDirectory()` opens the OS dialog in MAIN and returns the chosen path or null on cancel.
//   - `launch(cwd)` asks main to spawn raw `claude` in `cwd`; main parse-and-throws the untrusted
//     cwd at the boundary and returns the opaque terminalId the EmbeddedTerminal opens against.
// Mirrors `settingsApi`'s invoke pattern. `CH.*` consts, never string literals.
const launchApi = {
  /** Open the native KDE directory chooser (MAIN). Resolves to the chosen path, or null on
   *  cancel (cancel ⇒ no-op — UX-DR23). The renderer NEVER opens a dialog itself. */
  pickDirectory(): Promise<SessionPickDirectoryResult> {
    return ipcRenderer.invoke(CH.sessionPickDirectory)
  },
  /** Launch raw `claude` in `cwd` under the operator-typed `name` (from the create-time prompt;
   *  prefilled with the cwd basename). Main validates BOTH (parse-and-throw on bad input),
   *  spawns the PTY, and returns `{ terminalId }`. Rejects the promise on an invalid cwd or a
   *  blank / over-long name — in which case nothing spawns. The caller logs a `code=` only,
   *  never the name or the path. */
  launch(cwd: string, name: string): Promise<SessionLaunchResult> {
    const req: SessionLaunchRequest = { cwd, name }
    return ipcRenderer.invoke(CH.sessionLaunch, req)
  },
  /** Session-naming A2 — retitle an EXISTING session by its stable session id (the launch-minted
   *  uuid, NEVER a pid or terminalId). Main validates with the SAME `SessionNameSchema` the
   *  create-time launch uses and parse-and-throws on bad input, so this REJECTS on a blank /
   *  whitespace-only / over-long / control-char name and nothing is renamed. Resolves to void —
   *  the retitled card arrives separately as a `session.updated` delta over CH.watchEvents. An
   *  unknown id resolves quietly (main treats it as a no-op). The caller logs a `code=` only,
   *  never the name. */
  rename(id: string, name: string): Promise<void> {
    const req: SessionRenameRequest = { id, name }
    return ipcRenderer.invoke(CH.sessionRename, req)
  },
  /** Session templates — launch `claude` from a saved template by its stable id. Main
   *  resolves the template's flags (cwd/model/permissionMode) from its own validated store
   *  and returns `{ terminalId }` exactly like `launch(cwd, name)`. The renderer never carries
   *  the template's flags itself — only the `templateId` + operator-typed `name`. */
  launchFromTemplate(templateId: string, name: string): Promise<SessionLaunchResult> {
    const req: SessionLaunchFromTemplateRequest = { templateId, name }
    return ipcRenderer.invoke(CH.sessionLaunchFromTemplate, req)
  },
  /** Deterministic-attention — report "the operator is viewing this session" (active rail tab,
   *  focused window). Main demotes ONLY a YourTurn session to idle; questions/permissions are
   *  untouched (they clear on reply). Resolves void; the calmed card arrives as a normal
   *  `session.updated` delta. Rejects on a blank id (parse-and-throw at the main boundary). */
  markSeen(id: string): Promise<void> {
    const req: SessionSeenRequest = { id }
    return ipcRenderer.invoke(CH.sessionSeen, req)
  },
  /** Story 3.4 (FR-16) — subscribe to the launch CORRELATION push (the `{ terminalId, sessionId }`
   *  binding, fired once when a launch's Tgid join lands in main). The renderer builds a
   *  `terminalIdBySessionId` view-state from it so the attention rail can switch the visible
   *  terminal by session id. Returns an unsubscribe fn. Mirrors `attentionApi.onActivate` exactly
   *  (subscribe-returns-unsubscribe). `CH.launchCorrelated` is a const, never a literal. */
  onCorrelated(cb: (event: LaunchCorrelatedEvent) => void): () => void {
    const listener = (_evt: unknown, event: LaunchCorrelatedEvent): void => cb(event)
    ipcRenderer.on(CH.launchCorrelated, listener)
    return () => ipcRenderer.removeListener(CH.launchCorrelated, listener)
  }
}

export type LaunchApi = typeof launchApi

// Session templates — typed invoke wrappers over CH.templates*. `remove`, not `delete`
// (reserved word), so the store and the bridge share one verb.
const templatesApi = {
  list(): Promise<Template[]> {
    return ipcRenderer.invoke(CH.templatesList)
  },
  save(req: TemplateSaveRequest): Promise<TemplatesSaveResult> {
    return ipcRenderer.invoke(CH.templatesSave, req)
  },
  remove(id: string): Promise<Template[]> {
    const req: TemplateDeleteRequest = { id }
    return ipcRenderer.invoke(CH.templatesDelete, req)
  }
}
export type TemplatesApi = typeof templatesApi

// Story 3.5 (SM-2) — the telemetry bridge: a renderer→main invoke for the acknowledge signal.
// The renderer signals the acknowledge moment via `window.telemetry.acknowledge(...)` and NEVER
// touches ipcRenderer directly (contextIsolation stays ON). MAIN computes the wait duration.
// `CH.telemetryAcknowledge` is a const, never a string literal (no-literal-channels). The arg is
// UNTRUSTED cross-process input → parse-and-throw at the main boundary (zod-boundaries.md).
// Mirrors `settingsApi.set`'s invoke pattern. Returns void (duration computed + stored in MAIN).
// [Source: story 3.5 Task 3.4; FROZEN-3; .claude/rules/ipc.md]
const telemetryApi = {
  /** Signal the acknowledge moment to MAIN (session looked at / opened). MAIN reads the tracker
   *  for `enteredColumnAt`, computes `waitMs`, and appends the telemetry event. `sessionId` is
   *  the stable session UUID (never pid); `acknowledgedAt` is `Date.now()` from the renderer.
   *  Rejects the promise on an invalid arg (parse-and-throw at the main boundary). */
  acknowledge(sessionId: string, acknowledgedAt: number): Promise<void> {
    const req: TelemetryAcknowledgeRequest = { sessionId, acknowledgedAt }
    return ipcRenderer.invoke(CH.telemetryAcknowledge, req)
  }
}

export type TelemetryApi = typeof telemetryApi

// Story 4.2 (FR-14) — the quit-guard bridge. The renderer triggers the quit flow and
// renders the Quit-guard modal ONLY through this typed bridge — NEVER ipcRenderer/Node
// directly (contextIsolation stays ON; FROZEN #5). Three typed invokes (CH.* consts):
//   - `requestQuit()` → app:request-quit → main app.quit() (the Ctrl+Q one chokepoint).
//   - `confirm()` → quit:confirm → main proceeds: isQuitting, teardown, quit.
//   - `cancel()` → quit:cancel → main clears pending-quit state; no teardown.
// One subscription:
//   - `onGuardShow(cb)` → subscribe to quit:guard-show (main pushes when ≥1 live session).
//     Returns an unsubscribe fn (subscribe-returns-unsubscribe — mirrors attentionApi.onActivate).
// Mirrors `settingsApi.*` invoke pattern + `attentionApi.onActivate` subscription pattern.
// CH.* consts, never string literals (no-literal-channels).
// [Source: story 4.2 Task 3.4; .claude/rules/ipc.md; FROZEN #3/#5; src/preload/index.ts (patterns)]
const quitApi = {
  /** Ask main to begin a true quit (→ app.quit() → the ONE before-quit decision). Ctrl+Q
   *  chokepoint — the renderer NEVER calls app.quit() directly (sandboxed). Returns void. */
  requestQuit(): Promise<void> {
    return ipcRenderer.invoke(CH.appRequestQuit)
  },
  /** Confirm "Quit anyway" — main proceeds: teardown + quit. Returns void. */
  confirm(): Promise<void> {
    return ipcRenderer.invoke(CH.quitConfirm)
  },
  /** Cancel — main clears the pending-quit state; no teardown; every PTY stays live. Returns void. */
  cancel(): Promise<void> {
    return ipcRenderer.invoke(CH.quitCancel)
  },
  /** Subscribe to the guard-show push (main → renderer). Returns an unsubscribe fn.
   *  Mirrors attentionApi.onActivate (subscribe-returns-unsubscribe). CH.quitGuardShow const. */
  onGuardShow(cb: (payload: QuitGuardPayload) => void): () => void {
    const listener = (_evt: unknown, payload: QuitGuardPayload): void => cb(payload)
    ipcRenderer.on(CH.quitGuardShow, listener)
    return () => ipcRenderer.removeListener(CH.quitGuardShow, listener)
  }
}

export type QuitApi = typeof quitApi

// Terminal clipboard feature — the OS clipboard text bridge. Power stays in MAIN (Electron
// `clipboard` module; the sandboxed renderer NEVER touches the OS clipboard directly —
// security posture). Both are typed invokes (CH.* consts; never a string literal):
//   - `readText()` → reads the current clipboard text; returns '' for image-only clipboards.
//   - `writeText(text)` → writes text to the OS clipboard; main parse-and-throws the untrusted
//     text arg at the boundary (zod-boundaries.md IPC-arg row). Rejects on a non-string arg.
// The IMAGE path does NOT ride this bridge — the renderer forwards `\x16` via the existing
// port input frame and `claude` reads the OS image itself. No image bytes cross the seam.
// [Source: spec-terminal-clipboard.md; .claude/rules/ipc.md; .claude/rules/zod-boundaries.md]
const clipboardApi = {
  /** Read the current OS clipboard text. Returns '' if the clipboard has no text (e.g.
   *  image-only clipboard), which the renderer uses to disable the Paste menu entry. */
  readText(): Promise<string> {
    return ipcRenderer.invoke(CH.clipboardReadText)
  },
  /** Write text to the OS clipboard. Main validates the arg (parse-and-throw on non-string);
   *  rejects the promise on an invalid arg. NEVER log the text value (user content). */
  writeText(text: string): Promise<void> {
    return ipcRenderer.invoke(CH.clipboardWriteText, { text })
  }
}

export type ClipboardApi = typeof clipboardApi

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('pty', ptyApi)
    contextBridge.exposeInMainWorld('watch', watchApi)
    contextBridge.exposeInMainWorld('attention', attentionApi)
    contextBridge.exposeInMainWorld('settings', settingsApi)
    contextBridge.exposeInMainWorld('terminal', terminalApi)
    contextBridge.exposeInMainWorld('launch', launchApi)
    // Session templates — the templates CRUD bridge (templates:list/save/delete).
    contextBridge.exposeInMainWorld('templates', templatesApi)
    contextBridge.exposeInMainWorld('telemetry', telemetryApi)
    // Story 4.2 (FR-14) — the quit-guard bridge (app:request-quit / quit:confirm / quit:cancel /
    // quit:guard-show subscription). The renderer reaches main ONLY via this typed bridge.
    contextBridge.exposeInMainWorld('quit', quitApi)
    // Terminal clipboard feature — the OS clipboard text bridge (clipboard:read-text /
    // clipboard:write-text). The renderer reaches Electron clipboard ONLY via this bridge.
    contextBridge.exposeInMainWorld('clipboard', clipboardApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // DEAD PATH: contextIsolation is required for this app (Guardrail #5 — never
  // weakened), so this branch never runs in production. Kept only so the file is
  // valid without contextBridge. The assignments are typed against the `Window`
  // augment in index.d.ts, but in this branch `window` is the bare DOM lib type.
  // @ts-ignore — dead branch (contextIsolation=false is forbidden); Window.pty is in index.d.ts
  window.pty = ptyApi
  // @ts-ignore — dead branch (contextIsolation=false is forbidden); Window.watch is in index.d.ts
  window.watch = watchApi
  // @ts-ignore — dead branch (contextIsolation=false is forbidden); Window.attention is in index.d.ts
  window.attention = attentionApi
  // @ts-ignore — dead branch (contextIsolation=false is forbidden); Window.settings is in index.d.ts
  window.settings = settingsApi
  // @ts-ignore — dead branch (contextIsolation=false is forbidden); Window.terminal is in index.d.ts
  window.terminal = terminalApi
  // @ts-ignore — dead branch (contextIsolation=false is forbidden); Window.launch is in index.d.ts
  window.launch = launchApi
  // @ts-ignore — dead branch (contextIsolation=false is forbidden); Window.telemetry is in index.d.ts
  window.telemetry = telemetryApi
  // @ts-ignore — dead branch (contextIsolation=false is forbidden); Window.quit is in index.d.ts
  window.quit = quitApi
  // @ts-ignore — dead branch (contextIsolation=false is forbidden); Window.clipboard is in index.d.ts
  window.clipboard = clipboardApi
  // @ts-ignore — dead branch (contextIsolation=false is forbidden); Window.templates is in index.d.ts
  window.templates = templatesApi
}
