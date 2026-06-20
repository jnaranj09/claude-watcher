// Story 3.1 — the node-pty DI seam (AC: #1, #8; AR-11).
//
// `createPty(opts): IPtyLike` wraps `node-pty`'s `pty.spawn` behind the minimal
// `IPtyLike` surface the terminal manager needs. This is the ONLY place node-pty is
// touched in the manager's dependency graph, so the `main-unit` (bare-node) Vitest
// path injects a FAKE pty and NEVER imports node-pty (AR-11: ban deep
// `vi.mock('node-pty')` — inject the factory instead). Mirrors the established
// main-side DI seams: `createTrayController` (kde/tray.ts) / `createAttentionNotifier`
// (kde/notifications.ts) / `createSettingsStore` (persistence/settings.ts) — an
// injectable external resource + a code-only `log` sink.
//
// node-pty stays in MAIN, externalized + `@electron/rebuild`-built + asarUnpack-ed
// (F4 / CLAUDE.md packaging gotcha). The packaged smoke proves the real `.node` loads;
// this module never runs on the unit-test path (the default factory body references
// node-pty, but the manager tests inject a fake — the import does not throw and the
// body never runs there). [Source: architecture.md:512 `pty/ ptyFactory.ts`; AR-11;
//  src/main/kde/tray.ts DI-seam precedent]
import * as pty from 'node-pty'

/**
 * The minimal surface the terminal manager needs off a `node-pty` IPty. Kept tiny so
 * the test fake implements exactly this — and so NO node-pty import sits on the
 * `main-unit` test path. `pause`/`resume` are the renderer-ACK flow-control levers
 * (architecture.md:557-559); `kill` tears the process down on terminal destroy.
 */
export interface IPtyLike {
  /** The OS process id of the spawned shell. Informational/logging only — NEVER an
   *  identity key (a wandering thread id; terminals key by terminalId — F6). */
  readonly pid: number
  /** Subscribe to PTY output bytes. Returns a disposable to unsubscribe. */
  onData(cb: (data: string) => void): { dispose(): void }
  /** Subscribe to PTY exit. Returns a disposable to unsubscribe. */
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void }
  /** Write keystroke bytes to the PTY. */
  write(data: string): void
  /** Resize the PTY (cols/rows computed by the renderer's `fit()` — terminal.md). */
  resize(cols: number, rows: number): void
  /** Flow control: stop reading from the PTY when the renderer-ACK backlog is high. */
  pause(): void
  /** Flow control: resume reading once the backlog drains. */
  resume(): void
  /** Kill the PTY process (on terminal destroy). */
  kill(): void
}

/** Options for spawning a PTY. Defaults mirror the Story-0.1 spike's spawn. */
export interface CreatePtyOptions {
  /** The shell/program to spawn. */
  file: string
  /** Argv for the program (default: none). */
  args?: string[]
  /** Initial column count (default 80). */
  cols?: number
  /** Initial row count (default 24). */
  rows?: number
  /** Working directory. */
  cwd?: string
  /** Child environment (already sanitized by the caller). */
  env?: Record<string, string>
}

/** The injectable PTY factory seam (AR-11). The default is the real node-pty-backed
 *  factory below; the `main-unit` tests inject a fake `createPty` so no real PTY spawns. */
export type PtyFactory = (opts: CreatePtyOptions) => IPtyLike

/**
 * The default, real node-pty-backed factory. Spawns a PTY via `pty.spawn` and adapts
 * its `IPty` to the `IPtyLike` surface above. NOT on the unit-test path (tests inject a
 * fake). The successful spawn IS the ABI proof — node-pty is matched to this Electron
 * (electron 39.8.10 / abi 140); the packaged smoke is the gate.
 */
export const createPty: PtyFactory = (opts) => {
  const term = pty.spawn(opts.file, opts.args ?? [], {
    name: 'xterm-256color',
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {})
  })
  return {
    get pid(): number {
      return term.pid
    },
    onData: (cb) => term.onData(cb),
    onExit: (cb) => term.onExit(cb),
    write: (data) => term.write(data),
    resize: (cols, rows) => term.resize(cols, rows),
    pause: () => term.pause(),
    resume: () => term.resume(),
    kill: () => term.kill()
  }
}
