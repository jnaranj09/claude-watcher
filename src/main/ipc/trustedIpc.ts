// Every main-process IPC listener is registered through here, so main answers ONLY its own
// renderer: the TOP frame of a page loaded from this app's renderer source (the dev server's
// origin, or the packaged `index.html`). Electron security checklist "validate the sender of all
// IPC messages" (technical-taste §5b-22). Navigation and `window.open` are already denied
// (`installLinkGuards`); this is the second wall, so a page that somehow got in still cannot reach
// a handler.
//
// FAIL CLOSED (zod-boundaries.md precedence): an untrusted invoke throws `ipc_sender_rejected`, an
// untrusted send is dropped. The log names the code and the channel (a `CH` constant) only — never
// the URL, never the args. Only `index.ts` may import `ipcMain` (any alias):
// `tests/main/ipcMainImport.guard.test.ts`. One listener is not ours: electron-store registers
// `electron-store-get-data` on `ipcMain` itself; it is unreachable because the preload exposes no
// `sendSync`.
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import type { Channel } from '../../shared/ipc/contract'

type InvokeListener = Parameters<IpcMain['handle']>[1]
type SendListener = Parameters<IpcMain['on']>[1]

/** Where THIS app's renderer is loaded from. `createWindow` loads exactly this, so the check and
 *  the load cannot drift apart. */
export type RendererSource = { kind: 'dev'; url: string } | { kind: 'file'; path: string }

/** The dev server only when a dev URL is set (electron-vite dev); the built `index.html`
 *  otherwise (packaged, e2e, smoke, drive). */
export function rendererSource(devUrl: string | undefined, indexHtmlPath: string): RendererSource {
  return devUrl !== undefined && devUrl !== ''
    ? { kind: 'dev', url: devUrl }
    : { kind: 'file', path: indexHtmlPath }
}

/** The part of Electron's `WebFrameMain` the check reads. */
export interface SenderFrame {
  readonly url: string
  readonly parent: unknown
}

/** True only for a top frame (`parent === null`) whose URL is the renderer source: same origin
 *  as the dev server, or a `file:` URL of the same `index.html` (hash and query ignored — the app
 *  routes with `#terminals`). A gone frame (`null`) or an unparsable URL is untrusted. */
export function isTrustedSender(frame: SenderFrame | null, source: RendererSource): boolean {
  if (frame === null || frame.parent !== null) return false
  let url: URL
  try {
    url = new URL(frame.url)
  } catch {
    return false
  }
  if (source.kind === 'dev') return url.origin === new URL(source.url).origin
  return url.protocol === 'file:' && url.pathname === pathToFileURL(source.path).pathname
}

/** Registration methods with `ipcMain`'s shape; a test passes a recorder. */
export interface IpcRegistrar {
  handle(channel: string, listener: InvokeListener): unknown
  on(channel: string, listener: SendListener): unknown
}

export interface TrustedIpc {
  handle(channel: Channel, listener: InvokeListener): void
  on(channel: Channel, listener: SendListener): void
}

function createTrustedIpc(deps: {
  ipcMain: IpcRegistrar
  isTrusted: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean
  log: (line: string) => void
}): TrustedIpc {
  const reject = (channel: Channel): void =>
    deps.log(`[claude-watcher][ipc] code=ipc_sender_rejected channel=${channel}`)
  return {
    handle(channel, listener) {
      deps.ipcMain.handle(channel, (event, ...args) => {
        if (!deps.isTrusted(event)) {
          reject(channel)
          throw new Error('ipc_sender_rejected')
        }
        return listener(event, ...args)
      })
    },
    on(channel, listener) {
      deps.ipcMain.on(channel, (event, ...args) => {
        if (!deps.isTrusted(event)) {
          reject(channel)
          return
        }
        listener(event, ...args)
      })
    }
  }
}

/** The one way main registers IPC: every listener answers only a top frame loaded from `source`
 *  (the same value `createWindow` loads). The check reads `event.senderFrame` HERE, not at the call
 *  site, so wiring it in index.ts cannot turn it off. */
export function createRendererIpc(deps: {
  ipcMain: IpcRegistrar
  source: RendererSource
  log: (line: string) => void
}): TrustedIpc {
  return createTrustedIpc({
    ipcMain: deps.ipcMain,
    isTrusted: (event) => isTrustedSender(event.senderFrame, deps.source),
    log: deps.log
  })
}
