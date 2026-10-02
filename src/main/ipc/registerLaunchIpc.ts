import { app, BrowserWindow, dialog } from 'electron'
import { accessSync, constants as fsConstants } from 'fs'
import { statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as os from 'os'
import { CH } from '../../shared/ipc/contract'
import type { PastSessionOpenResult, ShellOpenResult } from '../../shared/ipc/contract'
import {
  resolveClaudeBin,
  composeClaudeCommand,
  prependToPath,
  shellQuote,
  QUESTION_FORMAT_PROMPT
} from '../pty/claudeBin'
import { ShellOpenSchema } from '../../shared/schemas/terminal'
import {
  SessionLaunchSchema,
  SessionRenameSchema,
  SessionSeenSchema,
  LaunchCorrelatedSchema,
  SessionArchiveSchema,
  SessionDeleteSchema
} from '../../shared/schemas/launch'
import type { WorkspacesStore } from '../persistence/workspaces'
import { parseSessionWorkspaceMove, pickDirectoryDefaultPath } from '../persistence/workspacesIpc'
import type { TemplatesStore } from '../persistence/templates'
import type { PastSessionsStore } from '../persistence/pastSessions'
import type { TagsStore } from '../persistence/tags'
import { parseSessionSetTags } from '../persistence/tagsIpc'
import { resolveTemplateLaunch } from '../pty/launchFromTemplate'
import type { ClaudeLaunchFlags } from '../pty/launchSession'
// Story 3.2 (FR-11) — the in-app LAUNCH flow built ON TOP of the Story-3.1 terminal: the raw
// `claude` launch service (reuses the terminal manager + ptyFactory; reuses pidCorrelation.ts
// for the Tgid join) + the per-run launched-set it POPULATES. The picked dir + launch request
// are UNTRUSTED cross-process input → Zod parse-and-throw at the boundary (never log the path).
import { createLaunchService, type LaunchService } from '../pty/launchSession'
// Action feedback (spec 2026-09-29 §2.4) — an in-app launch refusal is a CODE the renderer maps to
// copy (`claude_version`, `folder_missing`); main shows no native box for it.
import { requireClaudeVersion, runInAppLaunch } from '../pty/inAppLaunch'
import {
  deleteTerminalSession,
  stopTerminalAndRemoveBound,
  type RemovalReason
} from '../pty/launchRemoval'
import { createShellCompanionRegistry, type ShellCompanionRegistry } from '../pty/shellCompanion'
import type { LaunchedSet } from '../pty/launchedSet'
// Past sessions (D-1) — the extracted "can this record be reopened?" decision
// (unit-tested in pastSessionOpen.test.ts, mirroring the launchMint/launchRemoval extraction).
import {
  openPastSession,
  resumeTerminalSession,
  type PastSessionOpenDeps
} from '../pty/pastSessionOpen'
import { readStatusFromProc } from '../pty/pidCorrelation'
import type { RunningElsewhereCheck } from '../pty/runningElsewhere'
import type { HasTranscript } from '../pty/claudeTranscript'
import type { ReadTranscriptInfo } from '../pty/claudeTranscriptInfo'
import { handlePastSessionImport } from '../pty/pastSessionImport'
import type { TerminalManager } from '../pty/terminalManager'
import { buildPtyEnv } from '../pty/ptyEnv'
// ZERO FOOTPRINT: the hook block is handed to claude as `--settings <file>` from the app's
// OWN data dir. The app writes NOTHING into the operator's projects — no
// `.claude/settings.local.json`, no `~/.claude/settings.json` — and the hooks scope to
// exactly the sessions it spawns. (This replaced the retired registerHooks merger.)
import { ensureHookSettingsFile, hookSettingsPathIfListening } from '../hooks/hookSettingsFile'
import type { ServerHealthState } from '../serverHealth'
import type { LaunchBoardSeam } from '../window/watchFeed'
import type { TrustedIpc } from './trustedIpc'

// Claude version gate — read the installed version the SAME way the spawn resolves it.
//
// The spawn runs `$SHELL -l -c "<claude> ..."`, and `resolveClaudeBin` may legitimately hand
// back a bare `claude` that only resolves on the login shell's PATH. Probing through anything
// else would report "missing" for an install that works fine, so the probe uses the same shell.
//
// CACHING: only an `ok` verdict is cached for good. A blocked or unreadable result is re-probed on
// the next IN-APP launch, so upgrading claude un-blocks the app WITHOUT restarting it; an API
// create reuses it for 30 s (R25 — see createClaudeVersionGate). The probe costs ~67ms on this
// machine — cheap enough per launch, but not worth paying once it has passed.
//
// NEVER-LOG-THE-VALUE: the resolved command is never logged, only a `code=`.
export function readClaudeVersionRaw(shell: string): string | null {
  try {
    const claude = resolveClaudeBin({
      isExecutable: (p) => {
        try {
          accessSync(p, fsConstants.X_OK)
          return true
        } catch {
          return false
        }
      },
      path: process.env.PATH,
      home: os.homedir(),
      override: process.env.CLAUDE_WATCHER_CLAUDE_BIN
    })
    return execFileSync(shell, ['-l', '-c', `${shellQuote(claude.command)} --version`], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    // Missing binary, non-zero exit, timeout — all "unknown", which ALLOWS the launch.
    console.warn('[c9watch][version] code=claude_version_unreadable')
    return null
  }
}

/** UX-11 — the launch preflight's folder check. Never throws; never logs the path. */
export function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false // missing / unreadable / unmounted
  }
}

/** What the launch IPC reads from the app. Maps and the version gate are owned by index.ts;
 *  values it assigns after app-ready are GETTERS, read at call time. */
export interface LaunchIpcDeps {
  ipc: TrustedIpc
  /** The default spawn shell (`$SHELL`). */
  shell: string
  serverHealth: ServerHealthState
  terminalOwners: Map<string, Electron.WebContents>
  launchBoardSeams: Map<Electron.WebContents, LaunchBoardSeam>
  launchedSet: LaunchedSet
  runningElsewhere: RunningElsewhereCheck
  hasTranscript: HasTranscript
  /** Resume by id — folder + title from claude's transcript (fails closed). */
  readTranscriptInfo: ReadTranscriptInfo
  claudeVersionAllowsLaunch: () => boolean
  isSessionLive: (sessionId: string) => boolean
  getTerminalManager: () => TerminalManager | null
  getPastSessionsStore: () => PastSessionsStore | null
  getTagsStore: () => TagsStore | null
  requireWorkspacesStore: () => WorkspacesStore
  requireTemplatesStore: () => TemplatesStore
  requirePastSessionsStore: () => PastSessionsStore
  requireTagsStore: () => TagsStore
}

/** The app-global services the launch IPC builds; index.ts keeps the references. */
export interface LaunchIpc {
  launchService: LaunchService
  shellCompanions: ShellCompanionRegistry | null
}

// Story 3.2 (FR-11) — register the launch IPC ONCE (mirrors registerTerminalIpc / registerPtyIpc;
// Review-F1 single-registration). Constructs the app-global launch service (reusing the terminal
// manager + the launched-set + the production /proc readers). Channels are CH.* consts only.
// Cross-process args are UNTRUSTED → parse-and-throw at the boundary (zod-boundaries.md IPC-arg
// row); NEVER log the picked path value (it leaks the operator's filesystem layout).
export function registerLaunchIpc(deps: LaunchIpcDeps): LaunchIpc {
  const {
    ipc,
    shell: SHELL,
    serverHealth,
    terminalOwners,
    launchBoardSeams,
    launchedSet,
    runningElsewhere,
    hasTranscript,
    readTranscriptInfo,
    claudeVersionAllowsLaunch,
    isSessionLive,
    getTerminalManager,
    getPastSessionsStore,
    getTagsStore,
    requireWorkspacesStore,
    requireTemplatesStore,
    requirePastSessionsStore,
    requireTagsStore
  } = deps

  /** The in-app launch seams: the interactive gate (re-probes a refusal) and a code-only log. */
  const IN_APP_LAUNCH_DEPS = {
    allowsLaunch: claudeVersionAllowsLaunch,
    log: (message: string): void => console.warn(message)
  }

  // Story 3.2 (FR-11) — the RAW `claude` spawn config (F3, FROZEN DECISION).
  //
  // STORY 5.5 UPDATE: the descendant-walk rationale below NO LONGER constrains the spawn — the
  // correlation now matches by SUBTREE ANCESTRY off the PTY leader (pidCorrelation.ts `isAncestorOf`),
  // which works whatever the spawn shape (in practice `bash -l -c claude` execs the claude ELF, so
  // the PTY leader IS claude and the tracked session is a deep `npm exec claude` descendant — both
  // are under the leader). We KEEP `$SHELL -l -c claude` purely for the LOGIN-SHELL PATH/rc benefit
  // (the second bullet below); the "claude must stay a child" reasoning is now moot.
  //
  // FROZEN DECISION (F3 fork resolved with live evidence): we spawn `claude` via a LOGIN SHELL
  // that runs claude AS A CHILD — `$SHELL -l -c 'claude'` — NOT the direct spawn and NOT
  // `exec claude`. Rationale grounded in the Story-0.4 LIVE evidence (oq-6 finding §E3): the
  // validated correlation walk (`resolveClaudeDescendant`, reused AS-IS) resolves claude as a
  // CHILD of the node-pty shell leader (the proven live ancestry `claude(664817) → bash(189223)`).
  //   - A DIRECT spawn (`file: 'claude'`) would make claude the PTY LEADER (term.pid == claude), so
  //     `resolveClaudeDescendant(term.pid)` finds NO claude CHILD → CLAUDE_NOT_RESOLVED forever
  //     (the as-is descendant walk only inspects children). It would also break on a minimal
  //     KDE-launched-app PATH where bare `claude` is not resolvable.
  //   - `exec claude` REPLACES the shell with claude (same defeat: claude becomes the leader).
  //   - The LOGIN SHELL (`-l`) resolves PATH/rc reliably (KDE app env can have a minimal PATH), and
  //     running `claude` (no exec) keeps it a CHILD — EXACTLY the shape the validated walk expects,
  //     keeping the layer thin (one shell, then claude). AR-7 "raw / minimal shell layering" is
  //     honored: a single login shell whose only job is to launch claude.
  // The env is the sanitized buildPtyEnv() (drops undefined keys + strips the smoke vars). [Source:
  // F3; AR-7; oq-6-pid-correlation-finding.md §E3 (claude → bash child ancestry, walk validated)]
  //
  // STORY 6.2 UPDATE: now a FACTORY over the freshly-minted session id. The launch service calls
  // it once per ACTUAL pty spawn so the composed command pins claude to the app-minted identity:
  // `$SHELL -l -c "claude --session-id '<uuid>'"`. The uuid is single-quoted for the shell (it is
  // a crypto randomUUID — hex + dashes — so quoting is belt-and-suspenders, but the command string
  // passes through a shell and MUST NOT rely on that). The `$SHELL -l -c` wrapper is unchanged
  // (the login-shell PATH/rc benefit). The env is computed per spawn (fresh buildPtyEnv).
  //
  // CACHYOS/ARCH + KDE FIX: the "login-shell PATH/rc benefit" claimed above does NOT hold on
  // Arch. A KDE-menu-launched app inherits the graphical-session PATH (no `~/.local/bin`), and
  // `bash -l -c` sources `~/.bash_profile` → `~/.bashrc`, whose stock Arch first line is
  // `[[ $- != *i* ]] && return` — `-c` is non-interactive, so it returns BEFORE the
  // `export PATH="$HOME/.local/bin:$PATH"` below it. Bare `claude` was therefore not found,
  // bash exited 127, the pty died instantly, and the board showed "Terminal exited." with no
  // reason. (It worked under `npm run dev` only because that inherits an INTERACTIVE PATH.)
  // So main resolves the binary to an ABSOLUTE path itself (claudeBin.ts) instead of trusting
  // the shell, and prepends its directory to the child PATH so claude's own subprocesses get
  // the same lookup the operator has in a terminal. The `$SHELL -l -c` wrapper is UNCHANGED —
  // it is load-bearing for pid correlation (claude must be a CHILD of the pty leader, F3).
  function rawClaudeSpawn(
    sessionId: string,
    displayName: string,
    flags: ClaudeLaunchFlags,
    initialPrompt: string | null,
    resume: boolean
  ): {
    file: string
    args: string[]
    env: Record<string, string>
  } {
    const env = buildPtyEnv()
    const claude = resolveClaudeBin({
      isExecutable: (p) => {
        try {
          accessSync(p, fsConstants.X_OK)
          return true
        } catch {
          return false // missing / not executable / unreadable dir — never throws out
        }
      },
      path: env.PATH,
      home: os.homedir(),
      override: env.CLAUDE_WATCHER_CLAUDE_BIN
    })

    // Log the PROVENANCE CODE only — never the resolved path (it leaks the operator's
    // filesystem layout; zod-boundaries.md never-log-the-value). `unresolved` is the code to
    // look for when a launch dies instantly again.
    console.log(`[c9watch][launch] claude_bin source=${claude.source}`)

    const childPath = prependToPath(claude.dir, env.PATH)
    if (childPath !== undefined) env.PATH = childPath

    return {
      file: SHELL,
      // Composed in claudeBin.ts, NOT inlined here: this registrar is only reachable through
      // Electron's ipc, so the quoting of the operator-typed name would otherwise be untestable. Name-sync adds `-n <name>` so
      // claude runs under the operator's name instead of generating its own title,
      // `--settings <file>` carries the hook block WITHOUT touching the operator's project, and
      // `--append-system-prompt` injects the deterministic-attention question-format nudge
      // (DA-4; probe-verified GO).
      args: [
        '-l',
        '-c',
        composeClaudeCommand({
          claudeCommand: claude.command,
          sessionId,
          displayName,
          hookSettingsPath: hookSettingsPathForSpawn(),
          appendSystemPrompt: QUESTION_FORMAT_PROMPT,
          model: flags.model,
          permissionMode: flags.permissionMode,
          effort: flags.effort,
          // The programmatic API threads the template's filled-in prompt through here (it rode
          // the durable launch recipe from `launchService.launch`); the in-app launch flows carry
          // none, so for them the composed command stays byte-identical to before.
          initialPrompt,
          // Past sessions (D-1) — a resume composes `claude --resume <id>` instead (claudeBin.ts
          // keeps `-n` (R3) and drops the template flags and the positional prompt for that form).
          resume
        })
      ],
      env
    }
  }

  // Hook delivery — the app's OWN settings file, handed to claude with `--settings`.
  //
  // ZERO FOOTPRINT: this writes into `app.getPath('userData')`, never into the operator's
  // project. It replaced a merger that wrote the hook block into the launched project's
  // `.claude/settings.local.json`, which left a permanent trace in every directory the app was
  // ever launched in — one a plain `claude` in that folder then kept firing forever.
  //
  // Ordering: resolved at spawn-composition time, which is inside the `claude` spawn itself, so
  // the file is on disk before claude reads it.
  //
  // NEVER-CRASH: a failed write must not fail the launch. `ensureHookSettingsFile` swallows its
  // own IO errors and returns null; the try/catch is belt-and-braces for an unexpected throw.
  // Either way the flag is omitted and the session spawns WITHOUT status reporting — degraded,
  // not dead. NEVER-LOG-THE-VALUE: the path is never logged, only a `code=`.
  //
  // SEC-6: no `--settings` at all unless THIS process's hook server is bound — a port someone else
  // holds would otherwise receive every prompt of the session. The banner (UX-05) says why.
  function hookSettingsPathForSpawn(): string | null {
    return hookSettingsPathIfListening({
      listening: () => serverHealth.hookListening(),
      ensure: () =>
        ensureHookSettingsFile({
          dir: app.getPath('userData'),
          log: (msg) => console.warn(msg)
        }),
      written: (ok) => serverHealth.hookSettingsWritten(ok),
      log: (msg) => console.warn(msg)
    })
  }

  // The launch service spawns through the SAME terminal manager (reuse) + the production
  // pidCorrelation readers (Linux /proc). It POPULATES the app-global launched-set on a landed
  // Tgid join. A null terminal manager (a race vs app-ready) is guarded at the handler.
  if (getTerminalManager() === null) {
    // Defensive: registerLaunchIpc is called AFTER registerTerminalIpc in the ready block, so
    // this never trips in practice; surface it as a code rather than spawn a half-wired service.
    console.error('[c9watch][launch] code=launch_ipc_before_terminal_manager')
  }
  const launchService = createLaunchService({
    // The launch SPAWN rides the existing terminal:open handler; the launch service only reads
    // the spawned shell leader pid for the correlation walk (pidOf). The terminal manager is
    // non-null by construction order (registerTerminalIpc ran first); pidOf is null-safe.
    terminalManager: {
      pidOf: (terminalId) => getTerminalManager()?.pidOf(terminalId) ?? null
    },
    launchedSet,
    // UX-11 — refuse a missing folder before anything is registered (no card, no record).
    isDirectory: isExistingDirectory,
    // Story 6.2 — the spawn FACTORY (not a static config): composes the raw-claude command for
    // each freshly-minted session id at actual-spawn time (mintSpawn).
    spawn: rawClaudeSpawn,
    // R3 — a resume's `-n` is the card's LATEST name: its past-sessions record (live or archived)
    // follows every rename, the recipe's name is frozen at Open.
    resumeName: (sessionId) => getPastSessionsStore()?.get(sessionId)?.name ?? null,
    // Story 5.5 — the ONLY `/proc` seam the correlation needs now: status (for the session's Tgid
    // + the PPid ancestry walk up to the PTY leader). The pre-5.5 comm/children readers are gone.
    readStatus: readStatusFromProc,
    // Opaque, unique per launch (NOT a session id, NOT a pid — F6). crypto UUID is plenty unique.
    newTerminalId: () => `launch-${randomUUID()}`,
    // Story 3.4 (FR-16) — push the terminalId ↔ sessionId binding to the OWNING window when a
    // launch's Tgid join lands. Resolve the owner from `terminalOwners` (the same map the
    // dead-terminal onExit uses); VALIDATE AT SOURCE (LaunchCorrelatedSchema) before send so a
    // malformed binding never crosses the seam (main→renderer delta; zod-boundaries.md). Re-check
    // the destroyed window per send (a late event after close is a no-op, mirroring the wc.send
    // guards above). never-log-the-value: PATH + CODE only on a parse miss (Guardrail #6).
    onCorrelated: (binding) => {
      const wc = terminalOwners.get(binding.terminalId)
      if (!wc || wc.isDestroyed()) return
      const r = LaunchCorrelatedSchema.safeParse(binding)
      if (!r.success) {
        const issue = r.error.issues[0]
        console.error(
          `[c9watch][launch] dropped launch:correlated path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
        )
        return
      }
      wc.send(CH.launchCorrelated, r.data)
    },
    // never-log-the-value: a code= ONLY, never a path/pty/session value (Guardrail #6).
    log: (message) => console.warn(message)
  })
  // Card shell pane — the companion registry reads the launch recipe (the folder) and stops
  // companions through the same manager; `isExistingDirectory` is the UX-11 preflight check.
  let shellCompanions: ShellCompanionRegistry | null = null
  const managerForCompanions = getTerminalManager()
  if (managerForCompanions !== null) {
    shellCompanions = createShellCompanionRegistry({
      launch: launchService,
      isDirectory: isExistingDirectory,
      manager: managerForCompanions,
      log: (message) => console.warn(message)
    })
  }

  // session:pick-directory — open the NATIVE KDE directory chooser in MAIN and return the chosen
  // path, or null on cancel (UX-DR23). The renderer NEVER opens a dialog itself. Modal-to-window
  // (pass the owning BrowserWindow) on KDE. This is an invoke (returns the value directly).
  ipc.handle(CH.sessionPickDirectory, async (event, raw: unknown) => {
    // Story 5.4 — TEST-ONLY seam (mirrors the C9_SMOKE env gate): when C9_TEST_PICK_DIR is set,
    // bypass the native KDE dialog (which Playwright cannot drive) and return that path. This
    // exists SOLELY so the launch-path e2e can exercise `+ New session → claude` end-to-end on the
    // built app. Inert in normal use (the env var is never set in production). Never logged.
    const testPickDir = process.env.C9_TEST_PICK_DIR
    if (testPickDir !== undefined && testPickDir !== '') return testPickDir
    const owner = BrowserWindow.fromWebContents(event.sender)
    // Workspaces — open the picker at a workspace's default folder when it has one: the one the
    // Workspaces dialog is editing (R26, by id), else the active one. Read from MAIN's own store
    // (the renderer never sends a path) and NEVER logged. A malformed arg rejects the invoke.
    const defaultPath = pickDirectoryDefaultPath(requireWorkspacesStore(), raw)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      ...(defaultPath !== null ? { defaultPath } : {})
    }
    // showOpenDialog accepts an optional parent window; pass it so the dialog is modal-to-window.
    const result = owner
      ? await dialog.showOpenDialog(owner, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    // Cancel ⇒ canceled:true (or empty filePaths) ⇒ null ⇒ the renderer no-ops (no launch).
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })

  // session:launch — UNTRUSTED cross-process input. Parse-and-throw-typed at THIS boundary (a
  // blank/non-string cwd rejects the invoke). NEVER log the cwd value — the throw IS the signal.
  // On a valid cwd, the launch service spawns raw `claude` (via the reused terminal manager) and
  // returns the opaque terminalId the renderer's EmbeddedTerminal opens against. The terminal is
  // typeable IMMEDIATELY; the Tgid correlation reconciles asynchronously on feed deltas (UX-DR19).
  ipc.handle(CH.sessionLaunch, (_event, raw: unknown) => {
    if (launchService === null) throw new Error('launch service not initialized')
    // Both fields are UNTRUSTED cross-process input. `name` comes back already TRIMMED and
    // length-bounded (SessionNameSchema); a blank/whitespace-only/over-long name rejects the
    // invoke here and NOTHING spawns. Never log either value on the throw path — a cwd leaks
    // the filesystem layout and a name is operator content (zod-boundaries.md).
    const { cwd, name } = SessionLaunchSchema.parse(raw)
    // Version gate + UX-11 folder check, as CODES (`claude_version` / `folder_missing`): the name
    // prompt stays open and maps them to copy (spec 2026-09-29 §2.2/§2.4). An unknown flag would
    // kill the session instantly with an error that looks nothing like "your claude is old", so
    // the gate fails EARLY; unreadable versions are allowed through (claudeVersion.ts).
    // NOTE: nothing is written into `cwd`. Hooks ride `--settings` from the app's own data dir,
    // resolved at spawn-composition time (see hookSettingsPathForSpawn).
    const service = launchService
    const { terminalId } = runInAppLaunch(IN_APP_LAUNCH_DEPS, () => service.launch({ cwd, name }))
    // Workspaces — report the workspace MAIN stamped on this launch's card so the renderer can
    // register the terminal's workspace before any session delta arrives.
    return { terminalId, workspaceId: requireWorkspacesStore().activeId() }
  })

  // session:launch-from-template — resolve the template FIRST (untrusted arg → main-owned
  // cwd/model/permissionMode via resolveTemplateLaunch; throws template_not_found on an unknown
  // id), then run the SAME version gate as session:launch before anything spawns.
  ipc.handle(CH.sessionLaunchFromTemplate, (_event, raw: unknown) => {
    if (launchService === null) throw new Error('launch service not initialized')
    const req = resolveTemplateLaunch(requireTemplatesStore(), raw)
    const service = launchService
    const { terminalId } = runInAppLaunch(IN_APP_LAUNCH_DEPS, () => service.launch(req))
    // Workspaces — same reasoning as session:launch above.
    return { terminalId, workspaceId: requireWorkspacesStore().activeId() }
  })

  // session:rename — UNTRUSTED cross-process input. Parse-and-throw-typed at THIS boundary: a
  // blank id, or a blank/whitespace-only/over-long/control-char name, rejects the invoke and
  // NOTHING is renamed. NEVER log either value on the throw path — the name is operator content
  // (zod-boundaries.md IPC-arg row); the throw IS the signal.
  //
  // Routed by `event.sender` to the OWNING window's seam, exactly like the launch board seam
  // above: session truth is per-window (one reducer per WebContents), so a rename must land in
  // the reducer that owns that board — never broadcast to every window.
  //
  // An unknown id is NOT an error here: the reducer logs `rename_unknown_id` and emits nothing
  // (a rename racing a stop/exit that already removed the card). Returns void — the retitled card
  // arrives as a normal `session.updated` delta.
  ipc.handle(CH.sessionRename, (event, raw: unknown) => {
    const { id, name } = SessionRenameSchema.parse(raw)
    launchBoardSeams.get(event.sender)?.renameLaunched(id, name)
  })

  // Past sessions (D-3) — the two explicit exits. Same stop as `terminal:stop` (the manager's
  // token-less kill), then the bound card leaves with the REASON. Keyed by terminalId: the
  // renderer holds it from the first frame. This routes the removal to the owning window's seam.
  function removeOwnedSession(
    terminalId: string,
    reason: RemovalReason
  ): (sessionId: string) => void {
    return (sessionId) => {
      const wc = terminalOwners.get(terminalId)
      if (wc !== undefined) launchBoardSeams.get(wc)?.removeLaunched(sessionId, reason)
    }
  }
  // session:archive — UNTRUSTED cross-process input; parse-and-throw at THIS boundary (a blank
  // terminalId rejects the invoke). Explicit "Archive"/Stop from the board: stop the pty, archive
  // the card.
  ipc.handle(CH.sessionArchive, (_event, raw: unknown) => {
    const terminalManager = getTerminalManager()
    const { terminalId } = SessionArchiveSchema.parse(raw)
    if (terminalManager === null) throw new Error('terminal manager not initialized')
    stopTerminalAndRemoveBound(
      terminalId,
      undefined,
      terminalManager,
      launchService,
      removeOwnedSession(terminalId, 'archive')
    )
    shellCompanions?.stopFor(terminalId)
  })
  // session:delete — UNTRUSTED cross-process input; parse-and-throw at THIS boundary. Explicit
  // Delete: stop the pty, drop the card AND any history record for it. The decision is
  // `deleteTerminalSession` (launchRemoval.ts, unit-tested): on a pane whose claude already
  // EXITED there is no binding and the renderer's `sessionId` is null (its card is gone), so the
  // record that exit archived is found through the launch override's `lastSessionId`. The
  // renderer's id is only a hint, removed too (idempotent).
  ipc.handle(CH.sessionDelete, (_event, raw: unknown) => {
    const terminalManager = getTerminalManager()
    const { terminalId, sessionId } = SessionDeleteSchema.parse(raw)
    if (terminalManager === null) throw new Error('terminal manager not initialized')
    deleteTerminalSession(
      terminalId,
      sessionId,
      terminalManager,
      launchService,
      removeOwnedSession(terminalId, 'delete'),
      (id) => {
        getPastSessionsStore()?.remove(id)
      }
    )
    shellCompanions?.stopFor(terminalId)
  })
  // shell:open — UNTRUSTED arg; parse-and-throw at THIS boundary. Main resolves the folder from its
  // OWN launch recipe (never from the arg) and answers the companion's id. A refusal THROWS its
  // code (`terminal_not_found` / `folder_missing`, the pastSessionOpen precedent); the renderer maps
  // it to copy. The spawn itself rides the renderer's terminal:open for the returned id.
  ipc.handle(CH.shellOpen, (_event, raw: unknown): ShellOpenResult => {
    const { parentTerminalId } = ShellOpenSchema.parse(raw)
    if (shellCompanions === null) throw new Error('terminal manager not initialized')
    const out = shellCompanions.register(parentTerminalId)
    if (!out.ok) throw new Error(out.code)
    return { terminalId: out.terminalId }
  })

  // past-sessions:open — UNTRUSTED arg (parse-and-throw inside openPastSession). The decision is
  // the extracted module; this binds the real seams. A refusal THROWS its code (the templates
  // precedent: `template_not_found`), which the dialog maps to copy. The same version gate as
  // session:launch runs first: `--resume` is no older than the flags the gate already covers.
  // The real seams behind an Open — shared by the Past sessions dialog and the dead pane's Resume.
  const pastSessionOpenDeps = (service: LaunchService): PastSessionOpenDeps => ({
    get: (id) => requirePastSessionsStore().get(id),
    isDirectory: (path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false // missing / unreadable — never throws, never logs the path
      }
    },
    isLive: isSessionLive,
    hasTranscript,
    runningElsewhere: (id) => runningElsewhere.isRunningElsewhere(id),
    tagExists: (id) => {
      const tagsStore = getTagsStore()
      return tagsStore !== null && tagsStore.get(id) !== null
    },
    launch: (req) => service.launch(req)
  })

  ipc.handle(CH.pastSessionOpen, (_event, raw: unknown): PastSessionOpenResult => {
    if (launchService === null) throw new Error('launch service not initialized')
    requireClaudeVersion(claudeVersionAllowsLaunch)
    const out = openPastSession(raw, pastSessionOpenDeps(launchService))
    if (!out.ok) throw new Error(out.code)
    return { terminalId: out.terminalId, workspaceId: out.workspaceId, name: out.name }
  })

  // past-sessions:import — Resume by id (a claude session the app did not launch). UNTRUSTED arg
  // (parsed inside importPastSession: a bad id is a code, anything else throws). The same version
  // gate and the same Open seams; the folder and the name come from claude's transcript. A
  // refusal THROWS its code; the dialog maps it to copy.
  ipc.handle(CH.pastSessionImport, (_event, raw: unknown): PastSessionOpenResult => {
    if (launchService === null) throw new Error('launch service not initialized')
    return handlePastSessionImport(raw, {
      ...pastSessionOpenDeps(launchService),
      allowsLaunch: claudeVersionAllowsLaunch,
      workspaces: requireWorkspacesStore(),
      readTranscriptInfo
    })
  })

  // past-sessions:resume-terminal (UX-10) — the dead pane's Resume. UNTRUSTED arg (parse-and-throw
  // inside resumeTerminalSession). Only the terminal id crosses: the session id is the launch
  // override's `lastSessionId` (main's own record, moved by /clear), then the same Open checks and
  // the same version gate. A refusal THROWS its code; the pane maps it to copy.
  ipc.handle(CH.pastSessionResumeTerminal, (_event, raw: unknown): PastSessionOpenResult => {
    if (launchService === null) throw new Error('launch service not initialized')
    requireClaudeVersion(claudeVersionAllowsLaunch)
    const service = launchService
    const out = resumeTerminalSession(raw, {
      ...pastSessionOpenDeps(service),
      lastSessionIdFor: (terminalId) =>
        service.peekSpawnOverride(terminalId)?.lastSessionId ?? null,
      isTerminalLive: (terminalId) => getTerminalManager()?.has(terminalId) ?? false
    })
    if (!out.ok) throw new Error(out.code)
    return { terminalId: out.terminalId, workspaceId: out.workspaceId, name: out.name }
  })

  // session:set-workspace — UNTRUSTED cross-process input; parse-and-throw at THIS boundary.
  // The WORKSPACE is validated against main's own store: moving a card into a workspace that
  // does not exist would strand it where no view can show it, so that fails closed with a code
  // instead of being applied. An unknown SESSION id is not an error (the reducer logs
  // set_workspace_unknown_id and emits nothing — a move racing a stop that already removed it).
  ipc.handle(CH.sessionSetWorkspace, (event, raw: unknown) => {
    // Both gates live in persistence/workspacesIpc.ts (unit-testable in node, unlike this file);
    // index.ts only binds the CH.* channel and routes to the sender's seam.
    const { sessionId, workspaceId } = parseSessionWorkspaceMove(requireWorkspacesStore(), raw)
    launchBoardSeams.get(event.sender)?.setWorkspaceLaunched(sessionId, workspaceId)
  })

  // session:set-tags — UNTRUSTED cross-process input; parse-and-throw at THIS boundary. Every id
  // must exist and be visible to the card's workspace (tagsIpc.ts parseSessionSetTags — unit-
  // testable, unlike this file). Routed by event.sender to the owning window's seam (session truth
  // is per-window). Returns void; the tagged card arrives as a normal `session.updated` delta.
  ipc.handle(CH.sessionSetTags, (event, raw: unknown) => {
    const seam = launchBoardSeams.get(event.sender)
    const { sessionId, tagIds } = parseSessionSetTags(requireTagsStore(), raw, (id) =>
      seam?.workspaceOf(id)
    )
    seam?.setTagsLaunched(sessionId, tagIds)
  })

  // session:seen — UNTRUSTED cross-process input; parse-and-throw at THIS boundary. Routed by
  // event.sender to the owning window's seam (session truth is per-window). The reducer's
  // markSeen guard makes a stale seen harmless — only YourTurn demotes. Returns void; the
  // demoted card arrives as a normal `session.updated` delta.
  ipc.handle(CH.sessionSeen, (event, raw: unknown) => {
    const { id } = SessionSeenSchema.parse(raw)
    launchBoardSeams.get(event.sender)?.seenLaunched(id)
  })

  return { launchService, shellCompanions }
}
