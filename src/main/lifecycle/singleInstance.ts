// One app per profile (UX-04 in docs/reports/2026-09-23-bug-hunt).
//
// A title-bar close only MINIMIZES this app, so clicking the launcher again started a SECOND
// instance. It could not bind the hook port (its cards froze in Connecting — their hooks went to
// the first instance, which drops unknown ids), its API failed to bind, and both processes wrote
// the same whole-file stores: the last writer silently reverted the other's templates, tags,
// rules and past sessions.
//
// Electron's lock lives in `userData`, so it is PER PROFILE: the dev, drive and e2e profiles move
// userData first and never collide with the installed app (tests/e2e/singleInstance.e2e.ts proves
// the real lock). The smoke run is the exception — it runs on the DEFAULT profile beside a running
// installed app, and must still run, so it never takes the lock.

export interface SingleInstanceDeps {
  smoke: boolean
  requestLock: () => boolean
  /** Register the handler for a later launch attempt (Electron's `second-instance`). */
  onSecondInstance: (handler: () => void) => void
  /** Bring the existing window forward — operator-initiated, like the quit guard's raise. */
  raise: () => void
  log: (line: string) => void
}

/** True when THIS process is the one instance and should start; false means quit now. */
export function claimSingleInstance(deps: SingleInstanceDeps): boolean {
  if (deps.smoke) return true
  if (!deps.requestLock()) {
    deps.log('[claude-watcher][instance] code=already_running')
    return false
  }
  deps.onSecondInstance(() => {
    deps.log('[claude-watcher][instance] code=second_instance_raised')
    deps.raise()
  })
  return true
}
