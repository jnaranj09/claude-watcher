import { contextBridge, ipcRenderer } from 'electron'
// Story 0.2 — channels go through the typed contract, never string literals.
import { CH } from '../shared/ipc/contract'
import type {
  PtyExitEvent,
  SmokeConfig,
  SmokeReport,
  WatchEventsPayload,
  WatchStatus
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

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('pty', ptyApi)
    contextBridge.exposeInMainWorld('watch', watchApi)
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
}
