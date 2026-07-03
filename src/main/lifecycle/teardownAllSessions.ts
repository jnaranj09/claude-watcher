// Story 4.1 (FR-13) — centralized clean teardown (SM-3 = 0 orphans).
//
// The ONE function that tears down EVERY owned session on the app-quit path.
// Extracted here (not inline in index.ts) so it is unit-testable in the
// `main-unit` (node) project WITHOUT importing Electron — mirrors `shipGate.ts`
// and `enrichDelta.ts` as the extract-for-unit-coverage precedent.
//
// What it does:
//   1. `terminalManager.destroyAll()` — tears down EVERY owned terminal via the
//      EXISTING `terminalManager.teardown` ordering (port.close() THEN pty.kill(),
//      idempotent + never-throws; architecture.md:554). REUSE, do NOT reimplement.
//   2. Clears the `terminalOwners` map (no stale window↔terminalId entries after quit).
//
// (Story 6.4: the c9watch feed — and its `feed.stop()` step here — is RETIRED. The
// native session engine spawns no long-lived child; the hook HTTP listener is closed
// per-window in index.ts teardownWatchFeed, not on this quit path.)
//
// B-1/M-2 HARD CONSTRAINT (FROZEN #1 / the highest-priority rule):
//   Teardown stops PTYs EXPLICITLY IN MAIN (terminalManager.destroyAll → port.close()
//   THEN pty.kill()). It NEVER relies on a renderer FocusedSession/EmbeddedTerminal
//   unmount to kill the PTYs. The order is STOP FIRST, then (if any) unmount. See
//   src/renderer/src/App.tsx:~199-203 for the M-2 one-way mount-latch WARNING that
//   guards against the B-1 incidental-unmount path; the App.launch.test.tsx B-1
//   regression test is the guardrail that MUST stay green unchanged.
//
// SIGHUP-before-exit race (DEFERRED — not closed by 4-1): the term.kill()→app.exit()
// orphan race (deferred-work.md:11) lives ONLY on the Story-0.1 smoke-harness path
// (src/main/index.ts) where `app.exit()` is forced synchronously after `term?.kill()`
// so the Wayland smoke runner does not hang. The FR-13 quit path (before-quit →
// teardownAllSessions → Electron normal quit) does NOT call app.exit() synchronously
// after the kills — Electron proceeds with its normal quit sequence — so the race is
// NOT reachable here. Deferred explicitly.
//
// [Source: story 4.1 Tasks 1-3; AC #1/#3/#5; FR-13; architecture.md:554/:588;
//  src/main/c9watch/shipGate.ts (extract-for-unit-coverage precedent);
//  FROZEN #1/#2/#3; .claude/rules/ipc.md; .claude/rules/zod-boundaries.md]

import type { TerminalManager } from '../pty/terminalManager'

/** Minimal seam so the unit test can inject + assert without importing Electron. */
export interface TeardownDeps {
  /** The ONE app-global terminal manager (null if never constructed — quit early). */
  terminalManager: TerminalManager | null
  /**
   * Clear the terminalOwners map. In production this is `terminalOwners.clear()`;
   * in tests it is a spy. Called AFTER the manager tears down all terminals so the
   * map entry for an already-destroyed terminal is not left dangling.
   */
  clearTerminalOwners: () => void
}

/**
 * Tear down EVERY owned session on the app-quit path (FR-13, SM-3 = 0 orphans).
 *
 * Call from `app.on('before-quit', () => teardownAllSessions(deps))` so it runs on
 * EVERY quit (`app.quit()`, `window-all-closed → app.quit()`, tray-menu Quit).
 *
 * Idempotent + never-throws: `terminalManager.destroyAll()` is itself idempotent +
 * never-throws, so a second call (e.g. if `before-quit` fires more than once) is a
 * safe no-op.
 *
 * B-1/M-2: this is the STOP that happens FIRST, in MAIN, BEFORE any renderer unmount.
 * Never called from the renderer; never triggered by a React component teardown.
 *
 * @param deps Injectable seam (production: live registries; tests: fakes/spies).
 */
export function teardownAllSessions(deps: TeardownDeps): void {
  // 1. Stop every owned terminal. port.close() THEN pty.kill() ordering is INSIDE
  //    terminalManager.destroyAll() → teardown() — REUSE it, do NOT reimplement.
  //    B-1/M-2: this is the explicit-main-stop; it runs BEFORE any renderer unmount.
  deps.terminalManager?.destroyAll()

  // 2. Clear the terminalOwners map now that all terminals are destroyed. Any
  //    pending window.on('closed') terminal-stop loop on this window will see an
  //    empty map and become a no-op (idempotent convergence).
  deps.clearTerminalOwners()
}
