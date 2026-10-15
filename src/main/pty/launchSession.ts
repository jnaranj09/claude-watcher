// The MAIN-side LAUNCH SERVICE. It sits on top of the embedded terminal and never re-implements
// the terminal or its transport. A launch differs from a plain shell spawn in one way: the pty
// runs raw `claude` in the picked folder, through a per-terminal spawn recipe the
// `terminal:open` handler reads (`peekSpawnOverride` / `mintSpawn`).
//
// IDENTITY IS MINTED AT SPAWN (Story 6.2). claude accepts a caller-minted `--session-id <uuid>`,
// and the transcript and every hook payload carry it. At each actual pty spawn (`mintSpawn`,
// never on a re-attach) the service mints a fresh `randomUUID()`, composes the spawn command
// through the injected `spawn(sessionId)` factory, records the exact `terminalId → sessionId`
// binding (`sessionIdFor`), and adds the id to the launched-set BEFORE the synthesized card's
// delta ships, so the board-ship gate passes at once. A Reopen of the same terminal frame is a
// new spawn and gets a new uuid (re-using a consumed `--session-id` risks a claude-side
// duplicate/resume error), and it overwrites the binding.
//
// The pre-6.2 /proc ancestry correlation (`correlateAgainst`) was deleted on 2026-10-15: the
// mint marked every launch as joined before its pty existed, so the walk could never match.
import { randomUUID } from 'node:crypto'
import type { LaunchedSet } from './launchedSet'
import type { EffortLevel, PermissionMode } from '../../shared/schemas/template'

/** Session templates — the three claude flags a launch may carry. Nullable, never undefined. */
export interface ClaudeLaunchFlags {
  model: string | null
  permissionMode: PermissionMode | null
  effort: EffortLevel | null
}
/** The folder-flow value — no template, no flags. */
export const NO_LAUNCH_FLAGS: ClaudeLaunchFlags = {
  model: null,
  permissionMode: null,
  effort: null
}

/** The launch invocation — raw `claude` in `cwd`, under the operator's chosen name. */
export interface LaunchRequest {
  /** The picked working directory (validated upstream at the IPC boundary). */
  cwd: string
  /** The operator-typed session name from the create-time prompt (validated upstream by
   *  `SessionNameSchema` — already trimmed and length-bounded when it reaches here). Becomes the
   *  synthesized card's `sessionName` instead of the cwd basename. */
  name: string
  /** Session templates — the model/permission-mode/effort flags to spawn claude with. Omitted ⇒
   *  `NO_LAUNCH_FLAGS` (the folder flow). */
  flags?: ClaudeLaunchFlags
  /** Tags and rules — the template this launch came from; omitted ⇒ null (the folder flow). Read by
   *  the rules engine's `template` condition (Phase 2), never by the spawn itself. */
  templateId?: string | null
  /** Programmatic API — the expanded initial prompt claude starts with; omitted ⇒ null (UI
   *  launches never set it in v1). Rides the durable override, so a Reopen re-runs it. */
  initialPrompt?: string | null
  /** Programmatic API — the workspace the card must land in (a template's own scope);
   *  omitted/null ⇒ main's active workspace at spawn (today's behaviour). */
  workspaceId?: string | null
  /** Past sessions (D-1) — resume claude's session `<id>` instead of minting a fresh one. The
   *  minted identity IS this id (probe-verified: `--resume` keeps it), the spawn is the
   *  `--resume` form, and a dead-pane Reopen resumes it again. Omitted/null ⇒ a fresh launch. */
  resumeSessionId?: string | null
  /** Past sessions — the record's tags that still exist; the card is born with them instead of
   *  running the launch rules (a resume is not a new launch). Ignored without `resumeSessionId`. */
  tagIds?: readonly string[]
}

/** The per-terminal launch recipe, set once at launch and read on EVERY spawn of that terminal. */
export interface LaunchOverride {
  cwd: string
  name: string
  flags: ClaudeLaunchFlags
  templateId: string | null
  /** Programmatic API — the expanded initial prompt, or null. Durable like `cwd`. */
  initialPrompt: string | null
  /** Programmatic API — the workspace this launch names, or null for "active at spawn". */
  workspaceId: string | null
  /** Epoch millis `launch()` registered this recipe — the archive record's `launchedAt`. */
  launchedAt: number
  /** Past sessions — set iff this launch resumes an archived record: the exact session id to
   *  resume + the record's surviving tags. Null for a normal (fresh) launch. `rebind` moves the
   *  id on `/clear`, so a dead-pane Reopen resumes the conversation the card last showed. */
  resume: { sessionId: string; tagIds: string[] } | null
  /** Past sessions (D-3) — the session id this terminal was LAST bound to: written by every
   *  `mintSpawn`, moved by `rebind` (`/clear`), and — unlike the binding — never cleared by
   *  `unbind`. It is what a Delete on a pane whose claude already exited reaches: that exit
   *  archived the card and consumed the binding, yet its record must still go (`CH.sessionDelete`
   *  → `deleteTerminalSession`, launchRemoval.ts). Null until the first spawn. NOT part of the
   *  spawn recipe — no spawn reads it. */
  lastSessionId: string | null
}

/** The launch outcome — the opaque terminalId the renderer's EmbeddedTerminal opens against. */
export interface LaunchOutcome {
  terminalId: string
}

/** Story 6.2 — the concrete spawn config for ONE actual pty spawn of a launch terminal:
 *  the injected `spawn(sessionId)` factory's file/args/env + the durable picked cwd. */
export interface LaunchSpawnConfig {
  file: string
  args?: string[]
  cwd: string
  env?: Record<string, string>
}

/** Story 6.2 — one consume-time mint: the fresh session identity + the spawn composed for it. */
export interface MintedLaunchSpawn {
  /** The freshly-minted session id (`randomUUID()`) — the EXACT identity claude will run as
   *  (`--session-id`), the launched-set member, and the binding value for this terminalId. */
  sessionId: string
  /** The spawn config the terminal manager spawns with (carries `--session-id <sessionId>`). */
  spawn: LaunchSpawnConfig
  /** The operator-typed session name recorded at `launch()`, read back off the spawn override so
   *  the card synthesis uses it instead of the cwd basename. It rides that entry because it is a
   *  per-terminal launch-recipe value with the same key and lifetime as `cwd` — NOT because a
   *  session name is meant to outlive its session (it is not: the dead pane's only action mints a
   *  NEW terminalId and re-prompts for a name). The one path that re-reads it is the dev
   *  StrictMode double-mount, where the same terminalId is stopped and re-opened. */
  displayName: string
  /** Tags and rules — the launch's template id (null for the folder flow), read back off the
   *  override exactly like `displayName`. */
  templateId: string | null
  /** Programmatic API — read back off the override like `displayName`. */
  initialPrompt: string | null
  /** Programmatic API — the override's workspace, or null for "active at spawn". */
  workspaceId: string | null
  /** Epoch millis `launch()` registered this recipe — read back off the override so
   *  `buildLaunchedSession` can stamp the card with it. */
  launchedAt: number
  /** Past sessions — the override's resume decision, read back verbatim. Null for a normal
   *  launch; set for a resume (the exact session id + the record's surviving tags). */
  resume: { sessionId: string; tagIds: string[] } | null
}

export interface LaunchServiceOptions {
  /** The launched-set this service fills at each mint (`mintSpawn`). */
  launchedSet: LaunchedSet
  /** UX-11 — the launch PREFLIGHT: true iff `cwd` is an existing directory. REQUIRED, so no
   *  construction can forget it. node-pty spawns into a missing cwd without throwing; the child
   *  fails its chdir and exits AFTER the card was synthesized and a record written. Main injects a
   *  `statSync().isDirectory()` that never throws and never logs the path. */
  isDirectory: (path: string) => boolean
  /** Story 6.2 — the raw-claude spawn FACTORY (was a static config). Called ONCE per ACTUAL
   *  pty spawn with the freshly-minted session id, so the composed command pins claude to the
   *  app-minted identity (`$SHELL -l -c "claude --session-id '<uuid>'"` in production —
   *  `rawClaudeSpawn` in ipc/registerLaunchIpc.ts). `env` is the sanitized child env (buildPtyEnv). The factory
   *  seam keeps the shell-wrapper composition OUT of this service (it never string-splices).
   *
   *  Name-sync: `displayName` is the operator-typed name from the launch override, passed so
   *  the composed command can carry claude's `-n <name>` flag — claude is then BORN with the
   *  operator's name (verified on 2.1.243), instead of generating its own title. Quoting it
   *  for the shell is the factory's job, not this service's.
   *
   *  Session templates: `flags` is the launch's `ClaudeLaunchFlags` (`NO_LAUNCH_FLAGS` for a
   *  plain folder launch), read back off the same override as `displayName` so a re-spawn of
   *  the same terminal (Reopen) keeps the flags it was launched with.
   *
   *  Programmatic API: `initialPrompt` is the expanded prompt this launch was registered with
   *  (null for every in-app flow), read off the same override for the same reason — a Reopen
   *  must re-run the prompt the launch was created with, not a bare `claude`. The factory
   *  appends it as claude's positional `[prompt]` argument; quoting it is the factory's job.
   *
   *  Past sessions (D-1): `resume` is true iff this launch's override carries a `resume`
   *  decision — the factory composes `claude --resume <sessionId>` instead of
   *  `--session-id <sessionId>` (claudeBin.ts `ClaudeCommandSpec.resume`), keeping `-n` (R3) and
   *  dropping the template flags and the positional prompt. */
  spawn: (
    sessionId: string,
    displayName: string,
    flags: ClaudeLaunchFlags,
    initialPrompt: string | null,
    resume: boolean
  ) => { file: string; args?: string[]; env?: Record<string, string> }
  /** Mint a fresh opaque terminalId per launch (NOT the session id, NOT a pid — F6). Injected
   *  for deterministic tests; defaults to a crypto-random id in main. */
  newTerminalId?: () => string
  /** Story 6.2 — mint a fresh SESSION id per ACTUAL pty spawn (the `--session-id` identity).
   *  Injected for deterministic tests; defaults to `randomUUID()` (node:crypto). */
  newSessionId?: () => string
  /** Epoch-millis clock — injected for determinism (the launch timestamp; diagnostics only). */
  now?: () => number
  /** Past sessions (R3) — the name the card LAST had for a resumed session id (main: its
   *  past-sessions record), or null. A resume passes it as `-n`; the recipe's name is frozen at
   *  Open and a Reopen that passed it would rename claude back. Null/omitted ⇒ the recipe's name.
   *  Never consulted for a fresh launch. */
  resumeName?: (sessionId: string) => string | null
}

export interface LaunchService {
  /** Launch raw `claude` in `cwd` (AC-1). Registers the spawn recipe and returns the opaque
   *  terminalId. The terminal is typeable IMMEDIATELY. The MessagePort transfer rides the SAME
   *  Story-3.1 terminal:open path in main — this service registers the recipe for `terminalId`;
   *  main consults it on open. */
  launch(req: LaunchRequest): LaunchOutcome
  /** The DURABLE spawn-recipe query for a launch terminalId. NON-CONSUMING (Story 5.4): the
   *  recipe survives reads, stops, and natural exits — so (a) a StrictMode dev double-mount's
   *  SURVIVING open still spawns claude, and (b) Reopen re-spawns claude (never the default
   *  `$SHELL`). A consume-once read was the latent Reopen bug + half of the dev blank-terminal
   *  bug. Returns null for a non-launch terminalId (the Story-3.1 host path). Reclaimed only
   *  at process exit.
   *
   *  Story 6.2 — NARROWED to the durable part (`cwd`): the concrete `file`/`args`/`env` are
   *  now composed PER SPAWN by `mintSpawn` (they carry the freshly-minted `--session-id`, so
   *  a static peek cannot return them). This is the "is this a launch terminal + where"
   *  query; `mintSpawn` is the consume-time read the terminal:open handler uses.
   *
   *  Session-naming: the operator-typed `name` rides the SAME entry (same key, same lifetime as
   *  the cwd), so it is returned here too. Session templates: `flags` rides the same entry too
   *  (`NO_LAUNCH_FLAGS` for a plain folder launch). */
  peekSpawnOverride(terminalId: string): LaunchOverride | null
  /** Story 6.2 — the consume-time mint, called by the terminal:open handler ONLY when an
   *  ACTUAL pty spawn is about to happen (never on a Story-5.6 re-attach of a live terminal).
   *  For a launch terminalId it synchronously:
   *    - mints a FRESH session uuid (a Reopen gets a NEW id — a consumed `--session-id` must
   *      never be re-used),
   *    - composes the spawn via the injected `spawn(sessionId)` factory + the durable cwd,
   *    - records the exact `terminalId → sessionId` binding (OVERWRITING any prior — Reopen),
   *    - adds the id to the launched-set (BEFORE the caller ships the synthesized delta, so
   *      the Story-3.3 ship gate passes).
   *  NON-consuming of the recipe: the durable cwd survives, and the NEXT actual spawn mints
   *  another fresh identity. Returns null for a non-launch terminalId (plain-shell path). */
  mintSpawn(terminalId: string): MintedLaunchSpawn | null
  /** Story 6.2 — the current `terminalId → sessionId` binding from the MOST RECENT actual
   *  spawn (null before the first mint / for a non-launch terminalId). Story 6.3 consumes
   *  this for exact stop/exit removal. */
  sessionIdFor(terminalId: string): string | null
  /** Programmatic API — resolve with the session id once `mintSpawn` binds this terminal (at
   *  once if already bound). Rejects with `Error('spawn_timeout')` after `timeoutMs`. A
   *  timed-out waiter is dropped; a later mint never calls it.
   *
   *  Why it exists: `launch()` only REGISTERS the recipe — the spawn (and therefore the minted
   *  session id the HTTP caller is told) happens when the RENDERER opens the terminal against
   *  the returned terminalId. This is how a command waits for that id without polling, and how
   *  it gives up when the renderer never opens the terminal at all. */
  awaitBinding(terminalId: string, timeoutMs: number): Promise<string>
  /** Session-rebind — the REVERSE of `sessionIdFor`: which terminal is bound to this session
   *  id, or null. Consumed by the mid-run id-change guard (hooks/sessionRebind.ts): a
   *  `SessionEnd` for a session whose terminal is still ALIVE is an id change, not a removal.
   *  Bindings are 1:1 (mintSpawn overwrites per terminal), so the first match is the match. */
  terminalIdFor(sessionId: string): string | null
  /** Session-rebind — repoint a LIVE terminal's binding at a new session id, after claude
   *  changed its own id mid-run. Unlike `mintSpawn` this does NOT spawn or mint; it moves the
   *  exact binding so a later stop/exit removes the session the board is actually showing, and
   *  the override's `lastSessionId` with it (a dead-pane Delete drops the NEW id's record) — plus
   *  a resume recipe's id (a dead-pane Reopen resumes the NEW id, never the pre-clear one). A
   *  no-op for an unknown terminalId (never invents a binding for a terminal that was never
   *  launched — the ship gate). */
  rebind(terminalId: string, sessionId: string): void
  /** Story 6.3 — clear the `terminalId → sessionId` binding after a stop/exit REMOVAL
   *  consumed it (the card is gone; the binding no longer names a live launched session).
   *  Idempotent. The durable spawn-override is NOT touched — a later Reopen still finds its
   *  recipe and `mintSpawn` writes a FRESH binding, and its `lastSessionId` still names the id
   *  this removal consumed (a dead-pane Delete needs it). Clearing here keeps the lifecycle
   *  coherent: a second stop/exit trigger for the same terminal resolves `sessionIdFor` to
   *  null and no-ops (removal is idempotent by construction). */
  unbind(terminalId: string): void
  /** Session-rebind — a snapshot of every live `terminalId → sessionId` binding, for the exact
   *  per-process adoption proof (hooks/sessionRebind.ts `claimByProcess`): when an unknown id
   *  posts a hook, each launched terminal's process tree is asked whether it now runs that id. */
  bindings(): ReadonlyArray<{ terminalId: string; sessionId: string }>
}

let idCounter = 0
/** Default terminalId minter — opaque + unique per launch. Not an identity key (F6). */
function defaultNewTerminalId(): string {
  idCounter += 1
  return `launch-term-${Date.now().toString(36)}-${idCounter}`
}

/**
 * Build the launch service. The spawn rides the injected factory, the folder check, time and
 * ids are injected, so every external touch is seamed.
 */
/** UX-11 — the code `launch()` throws for a cwd that is not an existing directory. */
export const LAUNCH_FOLDER_MISSING = 'folder_missing'

/** True iff `err` is `launch()`'s folder refusal (and not some other failure). */
export function isFolderMissing(err: unknown): boolean {
  return err instanceof Error && err.message === LAUNCH_FOLDER_MISSING
}

export function createLaunchService(options: LaunchServiceOptions): LaunchService {
  const now = options.now ?? Date.now
  const newTerminalId = options.newTerminalId ?? defaultNewTerminalId
  const newSessionId = options.newSessionId ?? randomUUID

  /** Durable spawn-overrides keyed by terminalId — Story 6.2 narrowed to the durable part (the
   *  picked cwd + the operator-typed name); `file`/`args`/`env` are composed per spawn by
   *  `mintSpawn` (they carry the freshly-minted `--session-id`). Story 5.4 NON-consuming; never
   *  deleted, reclaimed at process exit — so the surviving half of a dev StrictMode double-mount
   *  still finds the recipe and re-spawns `claude` rather than the default `$SHELL`. The name
   *  lives here because it is the same KIND of value as the cwd (per-terminal, set once at
   *  launch), not because a name is expected to outlive its session. Session templates: `flags`
   *  rides the same entry, same reasoning — set once at launch, read on every spawn. */
  const overrides = new Map<string, LaunchOverride>()
  /** Story 6.2 — the EXACT terminalId → sessionId binding, written at each actual spawn
   *  (mintSpawn) and OVERWRITTEN by a Reopen's fresh id. Story 6.3 consumes it (sessionIdFor)
   *  for immediate stop/exit removal and CLEARS it (unbind) once that removal lands — so a
   *  binding present means "the last spawn's session may still be on the board". */
  const bindings = new Map<string, string>()
  /** Programmatic API — one-shot waiters keyed by terminalId, resolved by mintSpawn. */
  const bindingWaiters = new Map<string, Set<(sessionId: string) => void>>()

  function launch(req: LaunchRequest): LaunchOutcome {
    // UX-11 — refuse a folder that was deleted, renamed or unmounted BEFORE anything is
    // registered: no recipe, no terminalId, so no card, no record and no pane. The thrown code is
    // the signal (the templates precedent); the path is never in it and never logged.
    if (!options.isDirectory(req.cwd)) throw new Error(LAUNCH_FOLDER_MISSING)
    const terminalId = newTerminalId()
    // Register the durable spawn recipe main consumes on terminal:open (the renderer opens the
    // EmbeddedTerminal against this terminalId, which triggers terminal:open in main; main calls
    // mintSpawn to mint the session identity + spawn `claude` in the picked cwd instead of the
    // default shell). Story 6.2: only the cwd is durable — the identity is minted per spawn.
    // Session-naming: the operator-typed name sits beside the cwd — both are per-terminal
    // launch-recipe values with the same key and lifetime. Session templates: `flags` too —
    // omitted (folder flow) collapses to NO_LAUNCH_FLAGS.
    // Programmatic API: the expanded initial prompt and the named workspace sit beside them —
    // same key, same lifetime, same "read on every spawn" contract, so a Reopen re-runs the
    // same prompt and lands the card in the same workspace. Omitted (every in-app flow) ⇒ null.
    // Past sessions: `resumeSessionId` set ⇒ the recipe carries the exact id to resume + the
    // record's surviving tags — read on every spawn (a Reopen resumes the SAME conversation).
    overrides.set(terminalId, {
      cwd: req.cwd,
      name: req.name,
      flags: req.flags ?? NO_LAUNCH_FLAGS,
      templateId: req.templateId ?? null,
      initialPrompt: req.initialPrompt ?? null,
      workspaceId: req.workspaceId ?? null,
      launchedAt: now(),
      resume:
        req.resumeSessionId != null
          ? { sessionId: req.resumeSessionId, tagIds: [...(req.tagIds ?? [])] }
          : null,
      lastSessionId: null // nothing spawned yet — mintSpawn writes it
    })
    return { terminalId }
  }

  function peekSpawnOverride(terminalId: string): LaunchOverride | null {
    // NON-CONSUMING (Story 5.4): do NOT delete on read. The recipe is durable for this launch
    // terminalId — it must survive EVERY terminal:open so a StrictMode dev double-mount's
    // surviving open AND a Reopen both re-spawn `claude` (not the default `$SHELL`).
    // A consume-once read was the latent Reopen bug + half of the dev blank-terminal bug.
    return overrides.get(terminalId) ?? null
  }

  function mintSpawn(terminalId: string): MintedLaunchSpawn | null {
    const override = overrides.get(terminalId)
    if (override === undefined) return null // non-launch terminalId — the Story-3.1 shell path

    // Fresh identity PER ACTUAL SPAWN (first open AND Reopen alike): claude consumes the
    // `--session-id` uuid — re-using one risks a claude-side duplicate/resume error. Past
    // sessions: a resume launch mints THAT id instead — claude already holds it, and a
    // dead-pane Reopen must resume the SAME conversation, never a fresh one.
    const sessionId = override.resume?.sessionId ?? newSessionId()
    // R3 — a resume passes `-n` too, so it must carry the card's LATEST name, not the recipe's.
    const displayName =
      override.resume !== null ? (options.resumeName?.(sessionId) ?? override.name) : override.name
    // The operator's name rides the spawn so claude starts under it (`-n <name>`), rather than
    // generating its own title that would then disagree with the board card. Session templates:
    // the flags ride the same override — a re-spawn of this terminal (Reopen) keeps them. The
    // resume flag tells the factory to compose `claude --resume <id>` instead.
    const base = options.spawn(
      sessionId,
      displayName,
      override.flags,
      override.initialPrompt,
      override.resume !== null
    )
    const spawn: LaunchSpawnConfig = {
      file: base.file,
      ...(base.args !== undefined ? { args: base.args } : {}),
      cwd: override.cwd,
      ...(base.env !== undefined ? { env: base.env } : {})
    }

    // (c) Record the EXACT binding — a Reopen OVERWRITES with the new id (the old session is
    // gone; the frame now hosts the fresh one). Story 6.3 reads this for removal. Past sessions:
    // the override remembers it too, past the removal that will clear the binding.
    bindings.set(terminalId, sessionId)
    overrides.set(terminalId, { ...override, lastSessionId: sessionId })
    // Programmatic API — wake anything waiting on THIS terminal's binding (awaitBinding). The
    // waiter set is deleted FIRST so each waiter is one-shot: a Reopen's second mint has
    // nobody left to call, and a waiter can never be resolved twice.
    const waiters = bindingWaiters.get(terminalId)
    if (waiters !== undefined) {
      bindingWaiters.delete(terminalId)
      for (const resolve of waiters) resolve(sessionId)
    }
    // (a) Launched-set membership BEFORE the caller ships the synthesized delta — the
    // Story-3.3 board-ship gate passes on the very first `session.updated` for this id.
    options.launchedSet.add(sessionId)

    // The operator's name rides back out of the override (never consumed, like the cwd), and so
    // do the programmatic API's prompt + workspace — the caller of terminal:open needs the
    // workspace to stamp the synthesized card with, and the prompt for diagnostics/parity.
    return {
      sessionId,
      spawn,
      displayName,
      templateId: override.templateId,
      initialPrompt: override.initialPrompt,
      workspaceId: override.workspaceId,
      launchedAt: override.launchedAt,
      resume: override.resume
    }
  }

  function sessionIdFor(terminalId: string): string | null {
    return bindings.get(terminalId) ?? null
  }

  function awaitBinding(terminalId: string, timeoutMs: number): Promise<string> {
    // Already bound (the renderer opened the terminal before the caller got here) — answer now.
    const bound = bindings.get(terminalId)
    if (bound !== undefined) return Promise.resolve(bound)
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Drop THIS waiter (not the whole set — another caller may still be waiting on the
        // same terminal), so a later mint never calls a promise that already rejected.
        bindingWaiters.get(terminalId)?.delete(onBound)
        reject(new Error('spawn_timeout'))
      }, timeoutMs)
      const onBound = (sessionId: string): void => {
        clearTimeout(timer)
        resolve(sessionId)
      }
      const set = bindingWaiters.get(terminalId) ?? new Set<(sessionId: string) => void>()
      set.add(onBound)
      bindingWaiters.set(terminalId, set)
    })
  }

  function terminalIdFor(sessionId: string): string | null {
    // Bindings are 1:1 (mintSpawn overwrites the entry for its terminalId), so a linear scan
    // over the live launches is exact and the map is bounded by the open terminals.
    for (const [terminalId, boundId] of bindings) {
      if (boundId === sessionId) return terminalId
    }
    return null
  }

  function rebind(terminalId: string, sessionId: string): void {
    // Only ever MOVE an existing binding — never create one. A terminal with no binding was
    // never launched by us (or its removal already consumed it), and inventing a binding here
    // would let an external session reach the board (Story 3.3 ship gate).
    if (!bindings.has(terminalId)) return
    bindings.set(terminalId, sessionId)
    // Past sessions — the terminal's LAST id moves with it: the card now lives (and will be
    // archived) under the new id, so that is the record a dead-pane Delete must drop. A RESUME
    // recipe moves too, or a dead-pane Reopen would `--resume` the conversation from before the
    // `/clear` while its card (and record) carry the new id. A fresh launch stays fresh.
    const override = overrides.get(terminalId)
    if (override !== undefined) {
      overrides.set(terminalId, {
        ...override,
        lastSessionId: sessionId,
        resume: override.resume === null ? null : { ...override.resume, sessionId }
      })
    }
  }

  function unbind(terminalId: string): void {
    // Story 6.3 — the stop/exit removal consumed this binding; drop it so a second trigger
    // (or a late SessionEnd-driven sweep) finds nothing to remove. Idempotent; the durable
    // spawn-override and the launched-set membership are deliberately untouched.
    bindings.delete(terminalId)
  }

  function listBindings(): ReadonlyArray<{ terminalId: string; sessionId: string }> {
    // A copy, not the live Map: the caller iterates while adoption may rebind mid-walk.
    return [...bindings].map(([terminalId, sessionId]) => ({ terminalId, sessionId }))
  }

  return {
    launch,
    peekSpawnOverride,
    mintSpawn,
    sessionIdFor,
    awaitBinding,
    terminalIdFor,
    rebind,
    unbind,
    bindings: listBindings
  }
}
