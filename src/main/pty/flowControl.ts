// Story 3.1 — renderer-ACK flow-control accounting (AC: #1; AR-4; architecture.md:557-559).
//
// VS-Code-style flow control: the renderer ACKs each rendered output chunk; main tracks
// the UNACKED backlog and `pause()`s the PTY when the backlog crosses a HIGH-water mark,
// `resume()`s it once it drains below a LOW-water mark. This bounds memory under a flood
// (htop's silent-failure mode — part of FR-10's acceptance) without dropping bytes.
//
// This module is PURE + unit-testable: the backlog counter + pause/resume thresholds +
// drain logic live here with NO MessagePort and NO real PTY. The byte transport itself
// rides the MessagePort (packaged-smoke-only — no `MessagePortMain` in jsdom; ipc.md);
// the pause/resume CALLS are injected (the fake PTY's `pause`/`resume` in tests), so
// Vitest asserts the accounting via the `main-unit` DI seam. [Source: AR-11;
//  .claude/rules/ipc.md "byte-transport over MessagePort is packaged-smoke-only";
//  architecture.md:264 ("renderer ACKs, pause the PTY … resume on drain")]

/**
 * Default backpressure thresholds. The unit counts UNACKED CHUNKS (one chunk = one
 * `pty data → port` post the renderer has not yet ACKed). Chunk-count (not byte-count)
 * keeps the accounting transport-agnostic and matches the per-write ACK granularity
 * (`xterm.write(data, cb)` fires one ACK per chunk). HIGH > LOW gives hysteresis so the
 * PTY does not flap pause/resume on every chunk near the boundary.
 */
export const DEFAULT_HIGH_WATER = 100
export const DEFAULT_LOW_WATER = 20

export interface FlowControlOptions {
  /** Backlog at/above which we pause the PTY (default 100 unacked chunks). */
  highWater?: number
  /** Backlog at/below which we resume the PTY (default 20 unacked chunks). */
  lowWater?: number
  /** Pause the PTY (injected — the real PTY's `pause`, or a fake in tests). */
  pause: () => void
  /** Resume the PTY (injected — the real PTY's `resume`, or a fake in tests). */
  resume: () => void
}

export interface FlowController {
  /** Record that one output chunk was sent to the renderer (backlog++). May `pause()`
   *  the PTY when the backlog crosses the high-water mark (once per crossing). */
  onSent(): void
  /** Record that the renderer ACKed one chunk (backlog--). May `resume()` the PTY when
   *  the backlog drains to/below the low-water mark (once per crossing). */
  onAck(): void
  /** Current unacked backlog (for tests/diagnostics). */
  readonly backlog: number
  /** Whether the PTY is currently paused by this controller (for tests/diagnostics). */
  readonly paused: boolean
}

/**
 * Build a flow controller. Pure accounting + injected pause/resume — no PTY, no port.
 *
 * Invariants:
 *   - `pause()` is called EXACTLY ONCE per high-water crossing (not on every chunk while
 *     already paused).
 *   - `resume()` is called EXACTLY ONCE per drain to/below the low-water mark (and only
 *     when actually paused).
 *   - the backlog never goes negative (a stray ACK with an empty backlog is ignored).
 */
export function createFlowController(opts: FlowControlOptions): FlowController {
  const highWater = opts.highWater ?? DEFAULT_HIGH_WATER
  const lowWater = opts.lowWater ?? DEFAULT_LOW_WATER

  let backlog = 0
  let paused = false

  function onSent(): void {
    backlog += 1
    if (!paused && backlog >= highWater) {
      paused = true
      opts.pause()
    }
  }

  function onAck(): void {
    if (backlog > 0) backlog -= 1
    if (paused && backlog <= lowWater) {
      paused = false
      opts.resume()
    }
  }

  return {
    onSent,
    onAck,
    get backlog(): number {
      return backlog
    },
    get paused(): boolean {
      return paused
    }
  }
}
