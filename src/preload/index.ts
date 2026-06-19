import { contextBridge, ipcRenderer } from 'electron'
// Story 0.2 — channels go through the typed contract, never string literals.
import { CH } from '../shared/ipc/contract'
import type { PtyExitEvent, SmokeConfig, SmokeReport } from '../shared/ipc/contract'

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

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('pty', ptyApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // contextIsolation is required for this app; this branch should never run.
  // @ts-ignore (define in dts)
  window.pty = ptyApi
}
