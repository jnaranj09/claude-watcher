import { app, clipboard } from 'electron'
import { CH } from '../../shared/ipc/contract'
// Terminal clipboard feature — the Zod arg schema for CH.clipboardWriteText (renderer→main).
// Parse-and-throw at the boundary; NEVER log the text value (user content — Guardrail #6).
import { ClipboardWriteTextSchema } from '../../shared/schemas/clipboard'
import { LinkOpenExternalSchema } from '../../shared/schemas/link'
import type { ExternalLinks } from '../links/externalLinks'
import type { ServerHealthState } from '../serverHealth'
import type { StorageHealthState } from '../storageHealth'
import { teardownAllSessions } from '../lifecycle/teardownAllSessions'
import {
  computeLiveLaunchedSessions,
  type ReducerLike
} from '../lifecycle/computeLiveLaunchedSessions'
import { handleQuitConfirm, handleQuitCancel, type QuitGuardState } from '../lifecycle/quitGuard'
import type { TerminalManager } from '../pty/terminalManager'
import type { LaunchedSet } from '../pty/launchedSet'
import type { TrustedIpc } from './trustedIpc'

/** What the app-level registrars (health, links, clipboard, quit) read from the app. The quit
 *  state, the maps and the link gate are owned by index.ts; the terminal manager is a GETTER. */
export interface AppIpcDeps {
  ipc: TrustedIpc
  serverHealth: ServerHealthState
  storageHealth: StorageHealthState
  externalLinks: ExternalLinks
  quitGuardState: QuitGuardState
  archiveLiveSessions: () => void
  getTerminalManager: () => TerminalManager | null
  terminalOwners: Map<string, Electron.WebContents>
  reducers: Map<Electron.WebContents, ReducerLike>
  launchedSet: LaunchedSet
}

/** One registrar per surface; index.ts calls each ONCE in the ready block. */
export interface AppIpc {
  registerServerHealthIpc(): void
  registerLinksIpc(): void
  registerClipboardIpc(): void
  registerQuitIpc(): void
}

export function createAppIpc(deps: AppIpcDeps): AppIpc {
  const {
    ipc,
    serverHealth,
    storageHealth,
    externalLinks,
    quitGuardState,
    archiveLiveSessions,
    getTerminalManager,
    terminalOwners,
    reducers,
    launchedSet
  } = deps

  // Server and storage health — the renderer asks once on mount; every later change is a push.
  function registerServerHealthIpc(): void {
    ipc.handle(CH.serverHealthGet, () => serverHealth.get())
    ipc.handle(CH.storageHealthGet, () => storageHealth.get())
  }

  // External links — the terminal's Ctrl/Cmd+click lands here. Parse-and-throw on a bad arg; the
  // scheme check and every log line (code only, never the URL) live in externalLinks.
  function registerLinksIpc(): void {
    ipc.handle(CH.linkOpenExternal, (_evt, raw: unknown) => {
      const { url } = LinkOpenExternalSchema.parse(raw)
      externalLinks.open(url)
    })
  }

  // Terminal clipboard feature — register the clipboard text bridge ONCE (mirrors
  // registerSettingsIpc / registerTerminalIpc single-registration; Review-F1). Power stays in
  // MAIN (Electron `clipboard` module; sandboxed renderer NEVER touches the OS clipboard
  // directly — security posture). Channels are CH.* consts — never a string literal.
  // The write arg is UNTRUSTED cross-process input → parse-and-throw-typed
  // (zod-boundaries.md IPC-arg row). NEVER log the clipboard text value (user content;
  // Guardrail #6 — the throw IS the signal). The read handler has no arg.
  function registerClipboardIpc(): void {
    // clipboard:read-text — read the OS clipboard text and return it directly. No arg to
    // parse; the read is safe (no cross-process input). Returns '' if the clipboard has no
    // text (e.g. image-only clipboard), which the renderer interprets as "Paste disabled".
    ipc.handle(CH.clipboardReadText, () => clipboard.readText()) // a Promise since Electron 44

    // clipboard:write-text — UNTRUSTED cross-process input. Parse-and-throw-typed at THIS
    // boundary (a malformed write arg rejects the invoke). NEVER log the text value —
    // the throw IS the signal; user clipboard content must not enter the log stream
    // (Guardrail #6; .claude/rules/zod-boundaries.md IPC-arg row).
    // Electron 44 made the main clipboard async (W3C-shaped): await the write so a refused write
    // rejects the invoke instead of floating.
    ipc.handle(CH.clipboardWriteText, async (_evt, raw: unknown) => {
      const { text } = ClipboardWriteTextSchema.parse(raw)
      await clipboard.writeText(text)
    })
  }

  // Story 4.2 (FR-14) — register the quit-guard IPC ONCE (mirrors registerSettingsIpc /
  // registerTerminalIpc single-registration at app-ready — Review-F1). Channels are CH.* consts
  // only — never a string literal (no-literal-channels). The three renderer→main invokes are
  // payload-less typed wrappers; they carry no cross-process args to parse. The main→renderer
  // guard-show push is validated AT SOURCE in handleBeforeQuit (not here). isQuitting / pendingGuard
  // live in the app-global quitGuardState; the before-quit handler reads/sets them atomically.
  function registerQuitIpc(): void {
    // app:request-quit — renderer asks main to begin a true quit. Routes through app.quit() so
    // it flows through the ONE before-quit guard decision (the one chokepoint, FROZEN #3).
    // The renderer NEVER calls app.quit() directly (it can't — sandboxed). Returns void.
    ipc.handle(CH.appRequestQuit, () => {
      app.quit()
    })

    // quit:confirm — "Quit anyway" was clicked. Main proceeds: sets isQuitting, teardown, quit.
    // The re-entrant before-quit (triggered by the quit) sees isQuitting=true and short-circuits.
    ipc.handle(CH.quitConfirm, () => {
      handleQuitConfirm(quitGuardState, {
        teardownAllSessions,
        teardownDeps: {
          // Past sessions (D-3) — "Quit anyway" archives every live session before the kill.
          archiveLiveSessions: () => archiveLiveSessions(),
          terminalManager: getTerminalManager(),
          clearTerminalOwners: () => terminalOwners.clear()
        },
        computeLiveLaunchedSessions,
        computeDeps: {
          reducers: reducers.values(),
          isLaunched: (id) => launchedSet.has(id)
        },
        pushGuard: () => {
          /* no-op: pushGuard is unused in the quitConfirm path */
        },
        raiseWindow: () => {
          /* no-op: the window is already up — the operator just clicked the modal's button */
        },
        proceedQuit: () => app.quit()
      })
    })

    // quit:cancel — the operator cancelled. No teardown; every PTY stays live (FROZEN #1).
    // The before-quit's e.preventDefault() already aborted this quit attempt.
    ipc.handle(CH.quitCancel, () => {
      handleQuitCancel(quitGuardState)
    })
  }

  return { registerServerHealthIpc, registerLinksIpc, registerClipboardIpc, registerQuitIpc }
}
