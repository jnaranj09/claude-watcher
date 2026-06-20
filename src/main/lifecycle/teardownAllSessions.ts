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
//   2. For every live feed, `feed.stop()` — aborts the feed's AbortController,
//      kills the c9watch watch child, and prevents any further reconnect.
//   3. Clears the `terminalOwners` map (no stale window↔terminalId entries after quit).
//
// Ordering matters: terminals are torn down BEFORE feeds are stopped.
// The feed is INDEPENDENT of terminal teardown (F3 — a feed reconnect NEVER touches
// PTY state); stopping the feed AFTER the manager is purely an "everything owned is
// dead before we abandon the registries" discipline, not a sequencing dependency.
//
// B-1/M-2 HARD CONSTRAINT (FROZEN #1 / the highest-priority rule):
//   Teardown stops PTYs EXPLICITLY IN MAIN (terminalManager.destroyAll → port.close()
//   THEN pty.kill()). It NEVER relies on a renderer FocusedSession/EmbeddedTerminal
//   unmount to kill the PTYs. The order is STOP FIRST, then (if any) unmount. See
//   src/renderer/src/App.tsx:~199-203 for the M-2 one-way mount-latch WARNING that
//   guards against the B-1 incidental-unmount path; the App.launch.test.tsx B-1
//   regression test is the guardrail that MUST stay green unchanged.
//
// no-floating-promises: `feed.stop()` is async. On the synchronous `before-quit`
// path, the AbortController.abort() + child.kill() calls inside `feed.stop()` are
// SYNCHRONOUS — the child is signalled immediately. The returned Promise settles
// only `whenReconnected()` (which in production resolves immediately since there is
// normally no in-flight reconnect at quit time). We void the Promise with a comment
// to satisfy no-floating-promises: the synchronous kill is what matters for the
// "0 orphans" guarantee on the quit path; the async tail is log-only cleanup.
//
// SIGHUP-before-exit race (DEFERRED — not closed by 4-1): the term.kill()→app.exit()
// orphan race (deferred-work.md:11) lives ONLY on the Story-0.1 smoke-harness path
// (src/main/index.ts:435-445) where `app.exit()` is forced synchronously after
// `term?.kill()` so the Wayland smoke runner does not hang. The FR-13 quit path
// (before-quit → teardownAllSessions → Electron normal quit) does NOT call
// app.exit() synchronously after the kills — Electron proceeds with its normal quit
// sequence — so the race is NOT reachable here. Deferred explicitly.
//
// [Source: story 4.1 Tasks 1-3; AC #1/#3/#5; FR-13; architecture.md:554/:588;
//  src/main/c9watch/shipGate.ts (extract-for-unit-coverage precedent);
//  FROZEN #1/#2/#3; .claude/rules/ipc.md; .claude/rules/zod-boundaries.md]

import type { TerminalManager } from '../pty/terminalManager'
import type { Feed } from '../c9watch/feed'

/** Minimal seam so the unit test can inject + assert without importing Electron. */
export interface TeardownDeps {
  /** The ONE app-global terminal manager (null if never constructed — quit early). */
  terminalManager: TerminalManager | null
  /**
   * Iterator over all live feed instances. In production this is the `feeds` Map's
   * values; in tests it is an array of fake feeds.
   */
  feeds: Iterable<Feed>
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
 * Idempotent + never-throws: `terminalManager.destroyAll()` and `feed.stop()` are
 * themselves idempotent + never-throw, so a second call (e.g. if `before-quit` fires
 * more than once) is a safe no-op.
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

  // 3. Stop every live feed. Abort the AbortController + kill the watch child
  //    (synchronous) + prevent further reconnect. The returned Promise settles
  //    whenReconnected(); we void it intentionally: the synchronous kill is the
  //    0-orphans guarantee; the async tail is cleanup the OS handles at process exit.
  for (const feed of deps.feeds) {
    // void + comment satisfies no-floating-promises (ESLint rule).
    void feed
      .stop()
      .catch((err) =>
        console.error(
          '[c9watch][teardown] feed.stop error (ignored on quit):',
          err instanceof Error ? err.message : 'unknown'
        )
      )
  }
}
