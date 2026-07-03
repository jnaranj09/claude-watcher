// Story 6.2 — the "should this terminal:open MINT a session identity?" decision, extracted
// (mirrors the launchRemoval.ts precedent) so it is unit-testable without Electron
// (index.ts wiring itself is untestable in main-unit). index.ts wires it once, inside the
// CH.terminalOpen handler, to decide whether the open that just arrived is an ACTUAL pty
// spawn (→ mint) or a re-attach to a LIVE terminal (→ never mint).
//
// WHY THE GUARD IS LOAD-BEARING (the regression this module pins): a re-open of a live
// terminal — the StrictMode dev double-mount's second open, or a focus round-trip
// re-mounting the EmbeddedTerminal (Story 5.6 re-attach) — must NOT mint. If the guard
// regressed (mintSpawn called unconditionally), the re-attach would:
//   - mint a SECOND uuid for the already-running claude (which keeps its original
//     `--session-id` — the new uuid names nothing),
//   - synthesize a GHOST board card for that id (minted !== null gates the upsert), and
//   - OVERWRITE the terminalId → sessionId binding, so the Story-6.3 stop/exit removal
//     resolves the ghost id and the ORIGINAL card could never be removed.
// A Reopen of a DEAD terminal is a real spawn and correctly gets a FRESH id (a consumed
// `--session-id` is never re-used); a non-launch terminalId (the Story-3.1 host shell
// path) mints null either way. [Source: spec-native-session-engine.md Story 6.2;
// launchMint.test.ts (fault-injection proof); launchRemoval.ts (extraction precedent)]

import type { MintedLaunchSpawn } from './launchSession'

/** The minimal launch-service surface the mint decision needs (structurally satisfied by
 *  `LaunchService` — see launchSession.ts `mintSpawn`). */
export interface LaunchMintSource {
  /** Consume-time mint for a launch terminalId: fresh uuid + spawn recipe + binding +
   *  launched-set membership. Null for a non-launch terminalId. */
  mintSpawn(terminalId: string): MintedLaunchSpawn | null
}

/** The minimal terminal-manager surface the mint decision needs (structurally satisfied by
 *  `TerminalManager` — see terminalManager.ts `has`). */
export interface LiveTerminalSource {
  /** Whether a live pty already exists for this terminalId (→ the open is a re-attach). */
  has(terminalId: string): boolean
}

/**
 * Decide the mint for one terminal:open. Returns the minted spawn recipe when THIS open is
 * about to perform an ACTUAL pty spawn of a launch terminal; null otherwise:
 *   - the terminal is already LIVE (Story 5.6 re-attach — no spawn) → null, and
 *     `mintSpawn` is NEVER called (no fresh uuid, no binding overwrite, no ghost card);
 *   - the launch service does not exist yet (an open racing app-ready) → null;
 *   - a non-launch terminalId (the plain-shell host path) → the service itself mints null.
 * Pure over its seams; never throws.
 */
export function mintForOpen(
  terminalId: string,
  manager: LiveTerminalSource,
  launch: LaunchMintSource | null
): MintedLaunchSpawn | null {
  if (manager.has(terminalId)) return null // re-attach of a LIVE terminal — never mint
  return launch?.mintSpawn(terminalId) ?? null
}
