// Story 3.1 (FR-10) — the MAIN-side terminal manager (AC: #1, #2, #4, #8; AR-4/AR-11).
//
// Owns the set of LIVE terminals keyed by an opaque per-terminal `terminalId` (NOT the
// session `id` — session↔terminal pairing is Story 3.2; F6). For each terminal it:
//   - spawns ONE pty via the injected `ptyFactory.createPty(): IPtyLike` (no real
//     node-pty on the unit-test path — AR-11);
//   - holds the MAIN end of the MessageChannel (`port1` ≈ `PortLike`) and wires it
//     to the pty bidirectionally (pty output → port; port input → pty.write);
//   - runs renderer-ACK flow control over the output path (createFlowController) —
//     pause()/resume() the pty as the unacked backlog crosses the water marks;
//   - on pty exit/die emits a typed dead-terminal signal (onExit) → the per-terminal
//     "Terminal exited." pane (UX-DR18) — one dying pty NEVER takes the board down.
//
// On destroy: **port.close() THEN pty.kill()** (architecture.md:554 ordering). The
// manager NEVER throws across the seam — a spawn/wire failure degrades to the dead-terminal
// signal (never-crash; PRECEDENCE #2). DI seams mirror createTrayController /
// createSettingsStore: inject the pty factory + a code-only `log` sink.
//
// The BYTE TRANSPORT (the MessagePort) is packaged-smoke-only (no `MessagePortMain` in
// jsdom — ipc.md). So the manager talks to a tiny `PortLike` seam, and the `main-unit`
// tests inject a FAKE port + FAKE pty to assert spawn-once / destroy-ordering / dead-pty /
// resize-math / flow-control accounting WITHOUT a real port or pty. The real
// `MessagePortMain` is adapted to `PortLike` in `src/main/index.ts`. [Source:
//  architecture.md:512/:553-559; AR-11; src/main/kde/tray.ts DI-seam precedent]
import type { IPtyLike, PtyFactory, CreatePtyOptions } from './ptyFactory'
import { createPty as defaultCreatePty } from './ptyFactory'
import { createFlowController, type FlowControlOptions } from './flowControl'
import type {
  TerminalPortMainMessage,
  TerminalPortRendererMessage
} from '../../shared/ipc/contract'
import { TerminalPortRendererMessageSchema } from '../../shared/schemas/terminal'

/**
 * The minimal MessagePort surface the manager needs (the MAIN end, `port1`). Kept tiny so
 * the test fake implements exactly this — and so NO Electron `MessagePortMain` import sits
 * on the unit-test path. The real `MessagePortMain` is adapted to this in main/index.ts.
 */
export interface PortLike {
  /** Post a typed message to the renderer end. */
  postMessage(message: TerminalPortMainMessage): void
  /** Subscribe to typed messages FROM the renderer end. */
  onMessage(cb: (message: TerminalPortRendererMessage) => void): void
  /** Begin delivering queued messages (Electron MessagePortMain requires an explicit
   *  `start()`; the adapter forwards it). */
  start(): void
  /** Close the port (called BEFORE pty.kill() on destroy — architecture.md:554). */
  close(): void
}

export interface TerminalManagerOptions {
  /** The PTY factory DI seam (AR-11). Defaults to the real node-pty-backed `createPty`;
   *  tests inject a fake so NO real node-pty spawns. */
  ptyFactory?: PtyFactory
  /** Default spawn options applied to every opened terminal (file/cwd/env). The caller
   *  (main/index.ts) supplies the sanitized shell + env; cols/rows come per-open. */
  spawnDefaults: Omit<CreatePtyOptions, 'cols' | 'rows'>
  /** Flow-control water marks (DI for tests). Defaults live in flowControl.ts. */
  flowControl?: Pick<FlowControlOptions, 'highWater' | 'lowWater'>
  /** Push a dead-terminal signal toward the renderer (validated-at-source IPC send lives
   *  in the caller). One dying pty → this fires ONCE per terminal; never throws out. */
  onExit: (terminalId: string, exitCode: number) => void
  /** Log sink — a `code=` ONLY, NEVER a pty/session value (Guardrail #6). Defaults to
   *  console.warn. */
  log?: (message: string) => void
}

/** One live terminal's main-side state. Internal. */
interface LiveTerminal {
  pty: IPtyLike
  port: PortLike
  ptyDataDisposable: { dispose(): void }
  ptyExitDisposable: { dispose(): void }
  /** Guards double-teardown (exit + explicit stop racing). */
  destroyed: boolean
}

export interface TerminalManager {
  /** Open a terminal for `terminalId`, wiring the given main-end port to a fresh pty.
   *  Spawn-once per terminalId (a re-open of a live id is a no-op). A spawn/wire failure
   *  degrades to an immediate dead-terminal signal (never throws).
   *
   *  `spawnOverride` (Story 3.2) overrides the `spawnDefaults` `file`/`args`/`cwd`/`env` for
   *  THIS open only — used by the FR-11 launch to spawn raw `claude` in the picked cwd instead
   *  of the default `$SHELL` in `$HOME`. Omitted ⇒ the Story-3.1 shell spawn (unchanged). */
  open(
    terminalId: string,
    port: PortLike,
    cols: number,
    rows: number,
    spawnOverride?: Partial<Omit<CreatePtyOptions, 'cols' | 'rows'>>
  ): void
  /** Resize the terminal's pty (main resizes FIRST — terminal.md). No-op for an unknown
   *  or destroyed terminal. */
  resize(terminalId: string, cols: number, rows: number): void
  /** Destroy the terminal: port.close() THEN pty.kill() (architecture.md:554). Idempotent;
   *  never throws. */
  stop(terminalId: string): void
  /** Whether a terminal id is currently live (for tests/diagnostics). */
  has(terminalId: string): boolean
  /** The PTY shell/pane-leader pid for a live terminal, or null if unknown/destroyed. Story
   *  3.2 reads this to walk DOWN to the launched `claude` descendant for the Tgid correlation
   *  (`resolveClaudeDescendant(shellPid, …)`). It is the SHELL leader, NOT claude (claude is a
   *  descendant) and NEVER an identity key — a wandering thread id; terminals key by
   *  `terminalId` (F6). [Source: story 3.2 Task 2; oq-6 finding §E3 (shell→claude descendant)] */
  pidOf(terminalId: string): number | null
  /** Tear down ALL terminals (on window close). Idempotent; never throws. */
  destroyAll(): void
}

/**
 * Build the terminal manager (AC-1/2/4/8). All external touches (pty factory, port) are
 * injected/seamed; every step that could throw is wrapped so one terminal's failure never
 * escapes (never-crash). The flow-control accounting is the pure `createFlowController`.
 */
export function createTerminalManager(options: TerminalManagerOptions): TerminalManager {
  const ptyFactory = options.ptyFactory ?? defaultCreatePty
  const log = options.log ?? ((message: string): void => console.warn(message))
  const terminals = new Map<string, LiveTerminal>()

  /** Internal teardown shared by stop() and a pty-exit. Ordering: port.close() THEN
   *  pty.kill() (architecture.md:554). Idempotent + never throws. Does NOT itself fire
   *  onExit — the caller decides whether this is a death (fire) or an explicit stop (silent). */
  function teardown(terminalId: string, live: LiveTerminal): void {
    if (live.destroyed) return
    live.destroyed = true
    terminals.delete(terminalId)
    // Dispose the pty listeners first so a late exit during teardown can't re-enter.
    try {
      live.ptyDataDisposable.dispose()
    } catch {
      /* disposing a listener must never throw out */
    }
    try {
      live.ptyExitDisposable.dispose()
    } catch {
      /* ignore */
    }
    // port.close() BEFORE pty.kill() (architecture.md:554).
    try {
      live.port.close()
    } catch {
      log('[c9watch][term] code=port_close_failed')
    }
    try {
      live.pty.kill()
    } catch {
      log('[c9watch][term] code=pty_kill_failed')
    }
  }

  function open(
    terminalId: string,
    port: PortLike,
    cols: number,
    rows: number,
    spawnOverride?: Partial<Omit<CreatePtyOptions, 'cols' | 'rows'>>
  ): void {
    // Spawn-once per terminalId: a re-open of a live id is a no-op (idempotent).
    if (terminals.has(terminalId)) return

    let term: IPtyLike
    try {
      // Story 3.2 — the launch passes a spawnOverride (file='claude', cwd=<picked>); without it
      // this is the Story-3.1 shell spawn (spawnDefaults), unchanged.
      term = ptyFactory({ ...options.spawnDefaults, ...spawnOverride, cols, rows })
    } catch {
      // A spawn failure degrades to an immediate dead-terminal signal — NEVER throws across
      // the seam (never-crash; the renderer shows the dead pane). Close the just-transferred
      // port so it doesn't dangle. Log a code only.
      log('[c9watch][term] code=pty_spawn_failed')
      try {
        port.close()
      } catch {
        /* ignore */
      }
      options.onExit(terminalId, 1)
      return
    }

    // Renderer-ACK flow control on the OUTPUT path: each chunk sent to the renderer is a
    // backlog++; each renderer ACK is a backlog--. Crossing the high-water mark pauses the
    // pty; draining below the low-water mark resumes it (AR-4; architecture.md:557-559).
    const flow = createFlowController({
      ...(options.flowControl?.highWater !== undefined
        ? { highWater: options.flowControl.highWater }
        : {}),
      ...(options.flowControl?.lowWater !== undefined
        ? { lowWater: options.flowControl.lowWater }
        : {}),
      pause: () => {
        try {
          term.pause()
        } catch {
          log('[c9watch][term] code=pty_pause_failed')
        }
      },
      resume: () => {
        try {
          term.resume()
        } catch {
          log('[c9watch][term] code=pty_resume_failed')
        }
      }
    })

    // pty output → port (and account one unacked chunk). Re-check destroyed so a late
    // chunk during teardown is a no-op.
    const ptyDataDisposable = term.onData((data) => {
      const liveNow = terminals.get(terminalId)
      if (!liveNow || liveNow.destroyed) return
      try {
        port.postMessage({ type: 'output', data })
        flow.onSent()
      } catch {
        log('[c9watch][term] code=port_post_failed')
      }
    })

    // pty exit/die → dead-terminal signal (UX-DR18). Tear down (port.close() THEN already-
    // dead pty.kill() is a harmless no-op) and fire onExit ONCE. One dying pty never takes
    // the board/window down (PRECEDENCE #2). Also push the exit in-band over the port so the
    // renderer sees it while draining the byte stream.
    const ptyExitDisposable = term.onExit(({ exitCode }) => {
      const liveNow = terminals.get(terminalId)
      try {
        port.postMessage({ type: 'exit', exitCode })
      } catch {
        /* the port may already be gone; the IPC onExit below is the durable signal */
      }
      if (liveNow) teardown(terminalId, liveNow)
      options.onExit(terminalId, exitCode)
    })

    // port input from the renderer: keystrokes → pty.write; ACK → flow.onAck. The port is a
    // CROSS-PROCESS boundary (MessagePortMain), so each message is UNTRUSTED → safeParse and
    // DROP a malformed one (log path/code only — never the value). This prevents a message with
    // an unknown `type` (or a missing `data` on an `input`) from silently falling through to the
    // ack branch and draining flow control (code-review M-1; zod-boundaries.md). The discriminant
    // is asserted here, NOT cast — `message` arrives as the typed projection but we re-validate
    // the shape at the seam.
    port.onMessage((message) => {
      const liveNow = terminals.get(terminalId)
      if (!liveNow || liveNow.destroyed) return
      const r = TerminalPortRendererMessageSchema.safeParse(message)
      if (!r.success) {
        const issue = r.error.issues[0]
        log(
          `[c9watch][term] dropped port message path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
        )
        return
      }
      const valid = r.data
      if (valid.type === 'input') {
        try {
          term.write(valid.data)
        } catch {
          log('[c9watch][term] code=pty_write_failed')
        }
      } else {
        // type === 'ack' — the renderer rendered one output chunk; drain the backlog.
        flow.onAck()
      }
    })

    terminals.set(terminalId, {
      pty: term,
      port,
      ptyDataDisposable,
      ptyExitDisposable,
      destroyed: false
    })

    // Begin delivering queued port messages (Electron MessagePortMain needs an explicit start).
    try {
      port.start()
    } catch {
      log('[c9watch][term] code=port_start_failed')
    }
  }

  function resize(terminalId: string, cols: number, rows: number): void {
    const live = terminals.get(terminalId)
    if (!live || live.destroyed) return
    // Main resizes the pty FIRST (the renderer already computed cols/rows via fit() and the
    // terminal reflows after — terminal.md resize-ordering). Guard already enforced by the
    // Zod boundary; belt-and-suspenders here too. Never throws out.
    if (cols > 0 && rows > 0) {
      try {
        live.pty.resize(cols, rows)
      } catch {
        log('[c9watch][term] code=pty_resize_failed')
      }
    }
  }

  function stop(terminalId: string): void {
    const live = terminals.get(terminalId)
    if (!live) return
    // Explicit stop: tear down (port.close() THEN pty.kill()) and DO NOT fire onExit (the
    // renderer initiated this — it doesn't need a dead-terminal push for its own stop).
    teardown(terminalId, live)
  }

  function has(terminalId: string): boolean {
    return terminals.has(terminalId)
  }

  function pidOf(terminalId: string): number | null {
    const live = terminals.get(terminalId)
    if (!live || live.destroyed) return null
    // The pty's pid is informational (a wandering thread id; never identity — F6). Reading it
    // never throws; a missing/exotic pty surfaces null rather than crashing the caller.
    try {
      const pid = live.pty.pid
      return Number.isInteger(pid) && pid > 0 ? pid : null
    } catch {
      return null
    }
  }

  function destroyAll(): void {
    // Snapshot the entries — teardown mutates the map.
    for (const [terminalId, live] of [...terminals.entries()]) {
      teardown(terminalId, live)
    }
  }

  return { open, resize, stop, has, pidOf, destroyAll }
}
