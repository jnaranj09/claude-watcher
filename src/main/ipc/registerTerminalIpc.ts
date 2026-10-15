import { MessageChannelMain } from 'electron'
import type { MessagePortMain } from 'electron'
import * as os from 'os'
import { CH } from '../../shared/ipc/contract'
import type {
  TerminalPortMainMessage,
  TerminalPortRendererMessage
} from '../../shared/ipc/contract'
// Story 3.1 (FR-10) — the embedded-terminal transport: the MAIN-side terminal manager (one
// node-pty per terminal behind the ptyFactory DI seam + the validated, flow-controlled
// MessagePort byte path) + its cross-process IPC-arg schemas (parse-and-throw at the boundary).
import { createTerminalManager, type PortLike, type TerminalManager } from '../pty/terminalManager'
import {
  TerminalOpenSchema,
  TerminalResizeSchema,
  TerminalStopSchema,
  TerminalExitSchema
} from '../../shared/schemas/terminal'
// Story 1.4 fix — validate-at-source for the watch:status connection-state push.
// Story 2.2 — validate-at-source for the FR-9 attention:activate push.
import { ViewFocusedTerminalSchema } from '../../shared/schemas/watchDelta'
import type { WorkspacesStore } from '../persistence/workspaces'
import { launchTags } from '../rules/launchTags'
import type { RulesSnapshot } from '../rules/evaluateRules'
import type { LaunchService } from '../pty/launchSession'
import { removeBoundSession, stopTerminalAndRemoveBound } from '../pty/launchRemoval'
// Story 6.2 — the extracted "should this open MINT?" decision (unit-tested in
// launchMint.test.ts, mirroring the launchRemoval extraction): mint ONLY when an ACTUAL
// pty spawn is about to happen — a re-attach to a LIVE terminal must never mint a second
// uuid / ghost card / binding overwrite.
import {
  spawnForOpen,
  isOrphanCompanionId,
  stopCompanionAfterParentStop,
  type ShellCompanionRegistry
} from '../pty/shellCompanion'
// Session-naming — the extracted, unit-tested launch-card synthesis (see launchSynthesis.ts).
import { buildLaunchedSession } from '../pty/launchSynthesis'
import { buildPtyEnv } from '../pty/ptyEnv'
import { interruptKeyName, isInterruptKey } from '../pty/interruptKey'
import type { OrphanRegistry } from '../hooks/sessionRebind'
import type { ReducerLike } from '../lifecycle/computeLiveLaunchedSessions'
import type { LaunchBoardSeam } from '../window/watchFeed'
import type { TrustedIpc } from './trustedIpc'
import { sendLaunchCorrelated } from './sendLaunchCorrelated'

/** What the terminal-lifecycle IPC reads from the app. Maps are owned by index.ts; values it
 *  assigns after app-ready are GETTERS, read at call time. */
export interface TerminalIpcDeps {
  ipc: TrustedIpc
  /** The default spawn shell (`$SHELL`). */
  shell: string
  terminalOwners: Map<string, Electron.WebContents>
  launchBoardSeams: Map<Electron.WebContents, LaunchBoardSeam>
  reducers: Map<Electron.WebContents, ReducerLike>
  focusedTerminals: Map<Electron.WebContents, string | null>
  orphanRegistry: OrphanRegistry
  getTerminalManager: () => TerminalManager | null
  getLaunchService: () => LaunchService | null
  getShellCompanions: () => ShellCompanionRegistry | null
  requireWorkspacesStore: () => WorkspacesStore
  rulesSnapshot: () => RulesSnapshot
}

// Story 3.1 (FR-10) — adapt an Electron `MessagePortMain` (the MAIN end, port1) to the
// manager's tiny `PortLike` seam. The manager is transport-agnostic + unit-testable against a
// fake port (no `MessagePortMain` in jsdom — ipc.md); this is the ONE place the real port is
// adapted. The byte path (this port) is exercised by the packaged smoke. Messages are typed
// both ways: main posts `TerminalPortMainMessage` (output/exit); the renderer posts
// `TerminalPortRendererMessage` (input/ack). Electron delivers the renderer's message in
// `event.data` — we trust the SHAPE here (it is our own renderer over a private port, not the
// generic renderer→main IPC arg surface) but keep the typed projection explicit.
function adaptMessagePort(port: MessagePortMain): PortLike {
  return {
    postMessage: (message: TerminalPortMainMessage): void => port.postMessage(message),
    onMessage: (cb: (message: TerminalPortRendererMessage) => void): void => {
      port.on('message', (event) => cb(event.data as TerminalPortRendererMessage))
    },
    start: (): void => port.start(),
    close: (): void => port.close()
  }
}

// Story 3.1 (FR-10) — register the terminal-lifecycle IPC ONCE (mirrors registerPtyIpc /
// registerSettingsIpc; Review-F1 single-registration so app.activate re-creating a window can
// neither throw on duplicate ipcMain.handle nor stack ipcMain.on listeners). Channels are
// CH.* consts only — never a string literal (no-literal-channels). Cross-process args are
// UNTRUSTED → parse-and-throw-typed at the boundary (zod-boundaries.md IPC-arg row); the throw
// rejects the invoke. The BYTE path rides the transferred MessagePort, NOT these channels.
export function registerTerminalIpc(deps: TerminalIpcDeps): TerminalManager {
  const {
    ipc,
    shell: SHELL,
    terminalOwners,
    launchBoardSeams,
    reducers,
    focusedTerminals,
    orphanRegistry,
    getTerminalManager,
    getLaunchService,
    getShellCompanions,
    requireWorkspacesStore,
    rulesSnapshot
  } = deps
  // Build the ONE app-global terminal manager. The pty factory + log are the DI seams (the
  // real node-pty-backed createPty is the default). onExit is the dead-terminal push: validate
  // AT SOURCE (main→renderer delta; zod-boundaries.md) then send CH.terminalExit to the OWNING
  // window. A failure here never throws out (never-crash). The spawned shell + sanitized env
  // mirror the Story-0.1 spike (buildPtyEnv strips the smoke vars).
  const manager = createTerminalManager({
    spawnDefaults: { file: SHELL, cwd: os.homedir(), env: buildPtyEnv() },
    // ESCAPE (and CTRL+C on a Working card, ST-4) = INTERRUPT. Probe-verified on claude 2.1.250
    // (Ctrl+C on 2.1.289): interrupting a turn fires NO hook of any kind, and when interrupted
    // early it leaves no transcript trace either —
    // claude just cancels and restores the prompt. So the keystroke the app is already
    // forwarding is the ONLY evidence the session went idle, and without it the card keeps
    // saying `Working` until the operator next uses the session.
    //
    // After an interrupt claude sits at its prompt waiting, and the operator is the one who
    // pressed the key — so this is idle-by-truth: the calm column, no notification. Guarded
    // on an ACTUAL status change (`interruptDemotes`) so a stray Escape (closing a menu) or a
    // Ctrl+C at an idle prompt cannot emit a pointless delta. Never logs `data` — that is what the operator is typing.
    onInput: (terminalId, data) => {
      // Only single-key chunks matter (Escape, Ctrl+C, or an answer to a permission prompt); a paste
      // or typed text is never looked up.
      if (data.length !== 1) return
      // Only an app-LAUNCHED terminal has a bound session; a plain shell has none, and an
      // Escape there is just an Escape.
      const sessionId = getLaunchService()?.sessionIdFor(terminalId) ?? null
      if (sessionId === null) return
      const wc = terminalOwners.get(terminalId)
      if (wc === undefined) return
      if (!isInterruptKey(data)) {
        launchBoardSeams.get(wc)?.keyLaunched(sessionId, data)
        return
      }
      // The key was SEEN on the pty. What the board then does about it is logged by
      // demoteOnInterrupt (`interrupt_key` when it demotes) — two facts, two lines.
      console.log(
        `[c9watch][pty] code=interrupt_key_seen session=${sessionId} key=${interruptKeyName(data)}`
      )
      launchBoardSeams.get(wc)?.interruptLaunched(sessionId, data)
    },
    onExit: (terminalId, exitCode, signal) => {
      const launchService = getLaunchService()
      const wc = terminalOwners.get(terminalId)
      terminalOwners.delete(terminalId)
      // Session-rebind — a dead pty can never be adopted, so drop any orphan record for it.
      // `claim` already gates on liveness, so this is hygiene (bounded memory), not correctness.
      orphanRegistry.clear(terminalId)
      // Dead-pane push FIRST (validate at source), THEN the Story-6.3 card removal below —
      // the renderer receives CH.terminalExit (the pane flips dead) before `session.removed`
      // (the card vanishes). A malformed exit never crosses the seam.
      if (wc && !wc.isDestroyed()) {
        // UX-10 — the signal (when one ended it) so the dead pane can name it. State only.
        const r = TerminalExitSchema.safeParse(
          signal === undefined ? { terminalId, exitCode } : { terminalId, exitCode, signal }
        )
        if (!r.success) {
          const issue = r.error.issues[0]
          console.error(
            `[c9watch][term] dropped terminal:exit path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
          )
        } else {
          wc.send(CH.terminalExit, r.data)
        }
      }
      // Story 6.3 — FAST REMOVAL (the double-ctrl+c case): a launched claude that exits for
      // real removes its board card IMMEDIATELY — no SessionEnd hook / feed event needed.
      // Resolve the exact spawn-time binding, clear it (a later Reopen mints a fresh id +
      // binding anyway), and route the removal through the owning window's board seam →
      // reducer.applyHookStatus(removed) → the SAME handleDelta chokepoint. Runs even when
      // the owning window is gone (the unbind keeps the binding lifecycle coherent; the seam
      // lookup is then a graceful no-op). Idempotent: no binding (plain shell / spawn-fail
      // dust / already removed) → no-op; a late SessionEnd for the removed id emits [].
      if (launchService !== null) {
        // Ctrl+C twice / `/exit` / a crash — all ARCHIVE (D-3): the pty is really gone, and the
        // card's history is worth keeping unless the operator explicitly deletes it.
        removeBoundSession(terminalId, launchService, (sessionId) => {
          if (wc !== undefined) launchBoardSeams.get(wc)?.removeLaunched(sessionId, 'archive')
        })
      }
    },
    // never-log-the-value: a code= ONLY, never a pty/session value (Guardrail #6).
    log: (message) => console.warn(message)
  })

  // view:focused-terminal (UX-13) — the renderer reports which terminal its focused view shows
  // (null on the board). View-state only; read by `isViewingSession` to skip the alert for the
  // session the operator is typing in. A malformed push is dropped, logged by PATH + CODE.
  ipc.on(CH.viewFocusedTerminal, (event, raw: unknown) => {
    const parsed = ViewFocusedTerminalSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      console.error(
        `[claude-watcher][view] dropped view:focused-terminal path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
      )
      return
    }
    // Only a window with a live feed; a late push after teardown must not re-add its entry.
    if (reducers.has(event.sender)) focusedTerminals.set(event.sender, parsed.data.terminalId)
  })

  // terminal:open — create a MessageChannel, wire its MAIN end (port1) to a fresh pty via the
  // manager, and TRANSFER the renderer end (port2) back on this invoke's reply. The renderer
  // receives the port and rides bytes over it. The arg is parse-and-throw-typed (a malformed
  // open rejects). Returns nothing structural — the port IS the return, transferred via
  // `event.ports` on the reply. We use `ipcMain.on` + `event.senderFrame`/`port` transfer
  // semantics: Electron transfers ports posted back to the sender via webContents.postMessage.
  ipc.on(CH.terminalOpen, (event, raw: unknown) => {
    // We use `ipcMain.on` (not `handle`) because the open must TRANSFER a MessagePort back, which
    // rides `wc.postMessage(channel, msg, [port])` — an `invoke` handler cannot RETURN a port.
    // So failures cannot reject the invoke; instead a failure that has a VALID terminalId pushes a
    // dead-terminal signal (CH.terminalExit) so the renderer flips to the dead pane rather than
    // HANGING on a port that never arrives (code-review M-2). Parse FIRST so we hold the id even
    // when the manager isn't ready yet.
    const terminalManager = getTerminalManager()
    const launchService = getLaunchService()
    const shellCompanions = getShellCompanions()
    const wc = event.sender
    const parsed = TerminalOpenSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      // never-log-the-value: PATH + CODE only. A malformed open carries no usable id, so we can
      // only drop+log it (this is a programmer error — the renderer always sends `{terminalId}`).
      console.error(
        `[c9watch][term] dropped terminal:open path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
      )
      return
    }
    const { terminalId, openToken } = parsed.data
    if (terminalManager === null) {
      // The manager isn't ready (a race against app-ready construction). Surface it as a dead
      // terminal so the renderer's open() callback path resolves to the dead pane, not a hang.
      const r = TerminalExitSchema.safeParse({ terminalId, exitCode: 1 })
      if (r.success && !wc.isDestroyed()) wc.send(CH.terminalExit, r.data)
      return
    }
    // Card shell pane — a shell whose parent was archived / deleted while shell:open was in flight
    // has no registry entry: spawn NOTHING (never a stray `$SHELL` in the home folder); the pane
    // goes dead, hidden with its archived frame. Decision + tests: shellCompanion.ts.
    if (isOrphanCompanionId(terminalId, shellCompanions)) {
      console.warn('[claude-watcher][shell] code=companion_not_registered')
      const r = TerminalExitSchema.safeParse({ terminalId, exitCode: 1 })
      if (r.success && !wc.isDestroyed()) wc.send(CH.terminalExit, r.data)
      return
    }
    const { port1, port2 } = new MessageChannelMain()
    // Record the owning window so a dead-terminal push (onExit) routes back here.
    terminalOwners.set(terminalId, wc)
    // Story 3.2 (FR-11) / Story 6.2 — if this terminalId is an app LAUNCH (the renderer opened
    // the EmbeddedTerminal against a launch-minted id) AND an ACTUAL pty spawn is about to
    // happen, MINT the session identity at consume time via the extracted `mintForOpen`
    // decision (launchMint.ts — unit-tested; fault-injection-proof): `mintSpawn` mints a
    // fresh `--session-id` uuid, composes the claude spawn for the picked cwd, records the
    // exact terminalId → sessionId binding, and adds the id to the launched-set. A re-open
    // of a LIVE terminal re-attaches (Story 5.6 — no spawn) and must NOT mint/rebind; a
    // Reopen of a DEAD terminal is a real spawn and gets a FRESH id (a consumed --session-id
    // is never re-used). A non-launch terminalId (the Story-3.1 host path) mints null → the
    // unchanged shell spawn.
    //
    // Card shell pane — a COMPANION id spawns `$SHELL` (spawnDefaults) in the parent's folder and
    // mints NOTHING (no session id, no card, no --settings); every other id is the unchanged
    // Story-6.2 decision (mintForOpen inside spawnForOpen). Unit-tested in shellCompanion.test.ts.
    const { minted, spawnOverride } = spawnForOpen(
      terminalId,
      terminalManager,
      launchService,
      shellCompanions
    )
    // Open the terminal (manager wires port1 ↔ pty + flow control). Initial dims are the
    // renderer's first fit() over CH.terminalResize; spawn at a sane default until then. A spawn
    // failure degrades to the manager's onExit → CH.terminalExit (dead pane), never a hang.
    // Story 5.6 — pass openToken so the manager can (a) update the stored token on re-attach, and
    // (b) let a stale cleanup-stop (carrying the old token) self-identify as a no-op.
    terminalManager.open(terminalId, adaptMessagePort(port1), 80, 24, spawnOverride, openToken)
    // Transfer port2 to the renderer, ECHOING the renderer's per-open `openToken` (Story 5.4)
    // alongside the terminalId so the renderer can pair THIS port to THIS open. The token
    // disambiguates a re-open of the SAME terminalId (a StrictMode dev double-mount, or Reopen):
    // without it the renderer's one-shot listener could pair the STALE (already-closed) port from
    // the prior open and ignore the live one → a blank terminal. The renderer listens on
    // CH.terminalOpen for the `{ terminalId, openToken }` payload + `ports[0]`.
    if (!wc.isDestroyed()) wc.postMessage(CH.terminalOpen, { terminalId, openToken }, [port2])
    // Story 6.2 — the INSTANT CARD + EXACT BINDING, synchronously at spawn (same tick):
    if (minted !== null) {
      // pidOf is null iff the spawn FAILED (the manager already degraded to the dead-terminal
      // push and the terminal never entered its map) — synthesize no card for a spawn that
      // never lived (the launched-set/binding dust from the mint is harmless: no delta ever
      // carries that id, and a removal of a never-present id emits nothing).
      const ptyPid = terminalManager.pidOf(terminalId)
      if (ptyPid !== null) {
        // (b) Synthesize the launched Session into THIS window's reducer via upsertLaunched →
        // the SAME handleDelta chokepoint as every c9watch/hook delta. The Session is
        // CONSTRUCTED from main-owned values (the minted uuid, the picked cwd, the pty pid) —
        // internal data, NOT external input, so it is NOT re-run through SessionSchema
        // (parse-once boundary). `Connecting` classifies into the `working` column; hooks own
        // every later transition (UserPromptSubmit → Working, Stop → WaitingForInput, …).
        // Session-naming: the synthesis itself lives in the extracted, unit-tested
        // `buildLaunchedSession` (launchSynthesis.ts) — index.ts is not importable by any test,
        // so inlining it left the operator's name reaching the board through an uncovered
        // expression. Keep this a one-line call; put any synthesis logic in that module.
        // Workspaces — stamp main's OWN active-workspace pointer at synthesis time (never
        // derived in the extracted module, which must stay importable without Electron).
        // Programmatic API — a launch that names its workspace (a template's own scope) lands
        // there; every other launch keeps landing in main's active workspace.
        const workspaceId = minted.workspaceId ?? requireWorkspacesStore().activeId()
        launchBoardSeams.get(wc)?.upsertLaunched(
          buildLaunchedSession(
            minted,
            ptyPid,
            workspaceId,
            // Rules (spec §2.1, T-21) — the launch rules run HERE, at spawn, so the card is
            // born tagged: one delta, no flash. Never on "first seen" — /clear re-upserts
            // under a new id and must not run them again.
            // Past sessions — a resume is born with the record's surviving tags; the launch
            // rules run for NEW launches only (a resume is not one).
            minted.resume !== null
              ? minted.resume.tagIds
              : launchTags(rulesSnapshot(), minted, workspaceId)
          )
        )
        // (d) Push the exact terminalId ↔ sessionId binding to the owning window IMMEDIATELY —
        // the Starting-banner join is instant (no ancestry walk, no c9watch discovery wait).
        // Validate AT SOURCE before send (main→renderer delta; zod-boundaries.md), exactly as
        // the ancestry-correlation push does; PATH + CODE only on a miss (Guardrail #6). The
        // renderer's boardStore.addCorrelation is idempotent, and mintSpawn marked the launch
        // already-joined so the ancestry walk can never fire a second push for this pair.
        sendLaunchCorrelated(wc, terminalId, minted.sessionId)
      }
    }
  })

  // terminal:resize — main resizes the pty FIRST (the renderer already computed cols/rows via
  // fit(); terminal.md). UNTRUSTED arg → parse-and-throw-typed (this is an invoke so a reject
  // surfaces to the renderer). An out-of-range dim FAILS CLOSED.
  ipc.handle(CH.terminalResize, (_event, raw: unknown) => {
    const terminalManager = getTerminalManager()
    if (terminalManager === null) throw new Error('terminal manager not initialized')
    const { terminalId, cols, rows } = TerminalResizeSchema.parse(raw)
    terminalManager.resize(terminalId, cols, rows)
  })

  // terminal:stop — destroy the terminal (port.close() THEN pty.kill(), in the manager).
  // UNTRUSTED arg → parse-and-throw-typed.
  ipc.handle(CH.terminalStop, (_event, raw: unknown) => {
    const terminalManager = getTerminalManager()
    const launchService = getLaunchService()
    const shellCompanions = getShellCompanions()
    if (terminalManager === null) throw new Error('terminal manager not initialized')
    const { terminalId, openToken } = TerminalStopSchema.parse(raw)
    const parentWasLive = terminalManager.has(terminalId)
    // Story 5.6 — forward the optional openToken to the manager. The manager no-ops if the token
    // is stale (a superseded StrictMode cleanup-stop). Omitted (user-initiated / quit teardown) →
    // unconditional kill (unchanged behavior). See terminalManager.stop() for the full semantics.
    //
    // Story 6.3 — FAST REMOVAL: when THIS stop actually tears the pty down (NOT a stale-token
    // StrictMode no-op, NOT an already-dead terminal — the helper's live-before/after gate),
    // the bound launched session is removed from the owning window's reducer on the same tick:
    // binding resolved + cleared, then applyHookStatus(removed) → handleDelta →
    // `session.removed` → the card vanishes NOW, with no dependency on any external event.
    // An explicit stop fires NO manager onExit, so this handler is the removal's ONLY trigger.
    stopTerminalAndRemoveBound(
      terminalId,
      openToken,
      terminalManager,
      launchService,
      (sessionId) => {
        // An unmount-stop that really kills the pty is ARCHIVE too (D-3) — CH.terminalStop is
        // not the operator's Delete; that is the explicit CH.sessionDelete exit below.
        const wc = terminalOwners.get(terminalId)
        if (wc !== undefined) launchBoardSeams.get(wc)?.removeLaunched(sessionId, 'archive')
      }
    )
    // Card shell pane — the shell dies with its parent's frame, unless THIS stop was a stale-token
    // no-op (the parent is still live). A dead parent's unmount is not stale. Decision + tests:
    // shellCompanion.ts `stopCompanionAfterParentStop`.
    if (shellCompanions !== null) {
      stopCompanionAfterParentStop(terminalId, parentWasLive, terminalManager, shellCompanions)
    }
    // Story 5.4 — do NOT drop the launch's spawn-override here. This handler fires on EVERY
    // EmbeddedTerminal unmount, INCLUDING the transient unmount React StrictMode performs in dev
    // (mount → cleanup → mount). Dropping the recipe on that transient stop made the surviving
    // mount re-spawn the default `$SHELL` instead of `claude` — the dev blank/wrong-terminal bug.
    // The spawn-override (the Reopen recipe) is kept for the life of the process.
  })

  return manager
}
