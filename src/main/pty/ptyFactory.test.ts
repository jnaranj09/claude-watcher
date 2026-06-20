// Story 3.1 — ptyFactory DI-seam tests (main-unit / node project).
//
// The DEFAULT `createPty` wraps the REAL node-pty (`pty.spawn`) — that is NOT exercised
// here: spawning a real PTY is the packaged-smoke's job, and a real node-pty `.node`
// is not on the bare-node unit path. Instead this asserts the SEAM:
//   - the module imports without throwing (the node-pty import resolves; no real spawn);
//   - the `IPtyLike` interface is implementable by a fake and is the surface the manager
//     consumes (the contract the DI seam guarantees — AR-11: inject, never deep-mock).
//
// `createPty` itself is a thin adapter (spawn → IPtyLike); its correctness is proven by
// the packaged smoke (spawn → type → resize → htop). [Source: story 3.1 Task 1.3; AR-11]
import { describe, it, expect } from 'vitest'
import * as ptyFactoryModule from './ptyFactory'
import type { IPtyLike, PtyFactory } from './ptyFactory'

describe('ptyFactory — the DI seam (AR-11)', () => {
  it('exports createPty without spawning a real PTY on import', () => {
    // The module import above did not throw (no real node-pty spawn at import time) and
    // the default factory is present for production wiring.
    expect(typeof ptyFactoryModule.createPty).toBe('function')
  })

  it('IPtyLike is implementable by a fake — the surface the manager injects', () => {
    // A fake conforming to IPtyLike is exactly what the manager tests inject. This pins the
    // seam shape (onData/onExit/write/resize/pause/resume/kill/pid) at the type level and at
    // runtime, with NO real node-pty.
    let killed = false
    const fake: IPtyLike = {
      pid: 1,
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
      write: () => {},
      resize: () => {},
      pause: () => {},
      resume: () => {},
      kill: () => {
        killed = true
      }
    }
    // A PtyFactory is `(opts) => IPtyLike` — the fake factory the manager accepts.
    const fakeFactory: PtyFactory = () => fake
    const produced = fakeFactory({ file: '/bin/bash', cols: 80, rows: 24 })
    expect(produced.pid).toBe(1)
    produced.kill()
    expect(killed).toBe(true)
  })
})
