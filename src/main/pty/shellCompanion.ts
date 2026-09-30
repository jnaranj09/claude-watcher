// Card shell pane (spec 2026-09-30) — the COMPANION registry: a plain `$SHELL` that runs beside an
// app-launched terminal, in the SAME folder claude runs in.
//
// Main owns the folder: it is read from the parent's DURABLE launch recipe
// (`launchService.peekSpawnOverride`, launchSession.ts), never from an IPC argument. The
// companion's id is deterministic (`<parent>:shell`) so re-opening a hidden pane is the same
// terminal, and so every parent stop path can find it without a second map.
//
// A companion is NOT a session: it never goes through `mintSpawn`, so it has no session id, no
// board card, no `--settings` and no hook block (a `claude` started inside it is an external
// session and stays off the board). Its own exit is only a dead-terminal push (the existing
// terminalManager onExit → CH.terminalExit path); it removes and archives nothing.
//
// Extracted (the launchRemoval.ts precedent) so the decisions are unit-testable without Electron;
// index.ts only binds the seams. Logs are `code=` only — never the folder.
import { mintForOpen, type LaunchMintSource, type LiveTerminalSource } from './launchMint'
import {
  LAUNCH_FOLDER_MISSING,
  type LaunchSpawnConfig,
  type MintedLaunchSpawn
} from './launchSession'
import type { StoppableTerminalManager } from './launchRemoval'

export const SHELL_COMPANION_SUFFIX = ':shell'
export const SHELL_TERMINAL_NOT_FOUND = 'terminal_not_found'

/** The companion id for a parent terminal — deterministic on purpose (re-open = same shell). */
export function companionTerminalId(parentTerminalId: string): string {
  return `${parentTerminalId}${SHELL_COMPANION_SUFFIX}`
}

export type ShellOpenRefusal = typeof SHELL_TERMINAL_NOT_FOUND | typeof LAUNCH_FOLDER_MISSING

export type ShellRegisterResult =
  | { ok: true; terminalId: string }
  | { ok: false; code: ShellOpenRefusal }

/** The launch-service surface the registry reads (structurally satisfied by `LaunchService`). */
export interface CompanionRecipeSource {
  peekSpawnOverride(terminalId: string): { cwd: string } | null
}

export interface ShellCompanionRegistry {
  /** Register (or find) the companion of `parentTerminalId`. `terminal_not_found` when the parent
   *  has no launch recipe (a companion is only for an app-launched terminal); `folder_missing`
   *  when the recipe folder is gone — checked BEFORE anything registers (UX-11). An existing entry
   *  is returned as-is. */
  register(parentTerminalId: string): ShellRegisterResult
  /** The cwd a terminal:open must spawn `$SHELL` in, or null when `terminalId` is not a companion. */
  cwdFor(terminalId: string): string | null
  /** Stop the companion of `parentTerminalId` (token-less, unconditional) and drop its entry.
   *  Returns whether there was one. Never throws. */
  stopFor(parentTerminalId: string): boolean
  /** Every registered companion id (the rebind disproof reads their process trees). */
  terminalIds(): string[]
  size(): number
}

export interface ShellCompanionRegistryOptions {
  launch: CompanionRecipeSource
  /** The same never-throwing directory check the launch preflight uses (index.ts `isExistingDirectory`). */
  isDirectory: (path: string) => boolean
  manager: StoppableTerminalManager
  /** Code-only log sink. Defaults to console.warn. */
  log?: (message: string) => void
}

export function createShellCompanionRegistry(
  options: ShellCompanionRegistryOptions
): ShellCompanionRegistry {
  const log = options.log ?? ((message: string): void => console.warn(message))
  /** companion terminalId → its recipe. In memory only; nothing persists across a restart. */
  const companions = new Map<string, { parentTerminalId: string; cwd: string }>()

  function register(parentTerminalId: string): ShellRegisterResult {
    const terminalId = companionTerminalId(parentTerminalId)
    if (companions.has(terminalId)) return { ok: true, terminalId }
    const recipe = options.launch.peekSpawnOverride(parentTerminalId)
    if (recipe === null) {
      log('[claude-watcher][shell] code=terminal_not_found')
      return { ok: false, code: SHELL_TERMINAL_NOT_FOUND }
    }
    if (!options.isDirectory(recipe.cwd)) {
      log('[claude-watcher][shell] code=folder_missing')
      return { ok: false, code: LAUNCH_FOLDER_MISSING }
    }
    companions.set(terminalId, { parentTerminalId, cwd: recipe.cwd })
    return { ok: true, terminalId }
  }

  function cwdFor(terminalId: string): string | null {
    return companions.get(terminalId)?.cwd ?? null
  }

  function stopFor(parentTerminalId: string): boolean {
    const terminalId = companionTerminalId(parentTerminalId)
    if (!companions.has(terminalId)) return false
    companions.delete(terminalId)
    try {
      options.manager.stop(terminalId)
    } catch {
      log('[claude-watcher][shell] code=companion_stop_failed')
    }
    return true
  }

  return {
    register,
    cwdFor,
    stopFor,
    terminalIds: () => [...companions.keys()],
    size: () => companions.size
  }
}

/** What one terminal:open spawns. `minted` is non-null ONLY for an actual launch spawn (index.ts
 *  synthesizes the card off it); a companion answers `{ cwd }` over `spawnDefaults` (`$SHELL`, the
 *  normal pty env) and never reaches `mintSpawn`. */
export interface OpenSpawnDecision {
  minted: MintedLaunchSpawn | null
  spawnOverride: LaunchSpawnConfig | { cwd: string } | undefined
}

export function spawnForOpen(
  terminalId: string,
  manager: LiveTerminalSource,
  launch: LaunchMintSource | null,
  companions: Pick<ShellCompanionRegistry, 'cwdFor'> | null
): OpenSpawnDecision {
  const cwd = companions?.cwdFor(terminalId) ?? null
  if (cwd !== null) return { minted: null, spawnOverride: { cwd } }
  const minted = mintForOpen(terminalId, manager, launch)
  return { minted, spawnOverride: minted?.spawn }
}

/**
 * After a parent's `CH.terminalStop`: stop its companion UNLESS the stop was a stale-token no-op
 * (Story 5.6 — a superseded StrictMode cleanup-stop leaves the parent LIVE: `parentWasLive` and
 * still `has`). A parent that was already dead (claude exited; its dead pane unmounted on a switch
 * or a Resume replacement) is not stale: the shell goes with the frame.
 */
export function stopCompanionAfterParentStop(
  parentTerminalId: string,
  parentWasLive: boolean,
  manager: Pick<StoppableTerminalManager, 'has'>,
  companions: Pick<ShellCompanionRegistry, 'stopFor'>
): boolean {
  const stale = parentWasLive && manager.has(parentTerminalId)
  if (stale) return false
  return companions.stopFor(parentTerminalId)
}

/**
 * A companion id (`…:shell`) that main has NO entry for — its parent was archived / deleted while
 * `shell:open` was in flight, so the renderer's late pane opens an id the stop cascade already
 * dropped. terminal:open must refuse it: falling through to `spawnForOpen` would spawn a plain
 * `$SHELL` in main's own cwd (the home folder), attached to a hidden frame.
 */
export function isOrphanCompanionId(
  terminalId: string,
  companions: Pick<ShellCompanionRegistry, 'cwdFor'> | null
): boolean {
  if (!terminalId.endsWith(SHELL_COMPANION_SUFFIX)) return false
  return (companions?.cwdFor(terminalId) ?? null) === null
}
