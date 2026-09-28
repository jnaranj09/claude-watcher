// Which smoke-harness IPC channels exist in this process (SEC-8 / SEC-5 in
// docs/reports/2026-09-23-bug-hunt). The single-PTY cockpit (`SmokeCockpit.tsx`) is the ONLY
// caller of `pty.start` / `pty.input` / `pty.resize` / `smokeReport`, and it runs only under
// `C9_SMOKE=1`. Registered in production, those channels were a raw `$SHELL` spawn + write, and
// a hard `app.exit` that archived nothing, one IPC away from any page that reached the preload.
//
// `smokeConfig` is the exception: `App.tsx` asks it on EVERY start to learn `enabled`, so it is
// registered always. Without the others a stray send is simply dropped (no listener).

import { CH } from '../../shared/ipc/contract'
import type { IpcMain } from 'electron'

// Electron's own listener types, so `ipcMain` itself satisfies the target below.
type SendListener = Parameters<IpcMain['on']>[1]
type InvokeListener = Parameters<IpcMain['handle']>[1]

/** The part of `ipcMain` this uses — narrow so a test can record what was registered. */
export interface SmokeIpcTarget {
  on(channel: string, listener: SendListener): unknown
  handle(channel: string, listener: InvokeListener): unknown
}

export interface SmokeIpcHandlers {
  config: InvokeListener
  ptyStart: SendListener
  ptyInput: SendListener
  ptyResize: SendListener
  report: SendListener
}

export function registerSmokeIpc(
  ipc: SmokeIpcTarget,
  smoke: boolean,
  handlers: SmokeIpcHandlers
): void {
  ipc.handle(CH.smokeConfig, handlers.config)
  if (!smoke) return
  ipc.on(CH.ptyStart, handlers.ptyStart)
  ipc.on(CH.ptyInput, handlers.ptyInput)
  ipc.on(CH.ptyResize, handlers.ptyResize)
  ipc.on(CH.smokeReport, handlers.report)
}
