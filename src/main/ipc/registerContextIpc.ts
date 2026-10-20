// Context (spec 2026-10-18 §4) — binds the handler bodies (mods/contextHandlers.ts, unit-tested)
// to CH.* channels, and the validated `session-setup:changed` push. A refusal leaves main as its
// code (the registerLaunchIpc precedent); the renderer maps it to copy (contextCopy.ts).
import { BrowserWindow } from 'electron'
import { CH } from '../../shared/ipc/contract'
import { SessionSetupChangedSchema } from '../../shared/schemas/contextIpc'
import type { ContextHandlers, ContextResult } from '../mods/contextHandlers'
import type { TrustedIpc } from './trustedIpc'

function valueOrRefuse<T>(r: ContextResult<T>): T {
  if (!r.ok) throw new Error(r.code)
  return r.value
}

export function registerContextIpc(ipc: TrustedIpc, handlers: ContextHandlers): void {
  ipc.handle(CH.sessionSetupGet, (_evt, raw: unknown) => handlers.get(raw))
  ipc.handle(CH.fileHistoryList, (_evt, raw: unknown) => valueOrRefuse(handlers.list(raw)))
  ipc.handle(CH.fileHistoryDiff, async (_evt, raw: unknown) =>
    valueOrRefuse(await handlers.diff(raw))
  )
  ipc.handle(CH.fileOpen, async (_evt, raw: unknown) => {
    valueOrRefuse(await handlers.open(raw))
  })
  ipc.handle(CH.fileHistoryRestore, async (_evt, raw: unknown) =>
    valueOrRefuse(await handlers.restore(raw))
  )
}

/** Tell every window a session's setup changed; validated at source (zod-boundaries.md). */
export function pushSessionSetupChanged(sessionId: string): void {
  const r = SessionSetupChangedSchema.safeParse({ sessionId })
  if (!r.success) {
    const issue = r.error.issues[0]
    console.error(
      `[claude-watcher][mods] dropped session-setup:changed path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
    )
    return
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(CH.sessionSetupChanged, r.data)
  }
}
