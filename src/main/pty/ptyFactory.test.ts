// Story 3.1 — ptyFactory DI-seam tests (main-unit / node project).
//
// The DEFAULT `createPty` wraps the REAL node-pty (`pty.spawn`) — that is NOT exercised
// here: spawning a real PTY is the packaged-smoke's job, and a real node-pty `.node`
// is not on the bare-node unit path. Instead this asserts the module imports without
// throwing (the node-pty import resolves; no real spawn). The `IPtyLike` seam shape is
// checked by `tsc` wherever a test injects a fake (AR-11: inject, never deep-mock).
//
// `createPty` itself is a thin adapter (spawn → IPtyLike); its correctness is proven by
// the packaged smoke (spawn → type → resize → htop). [Source: story 3.1 Task 1.3; AR-11]
import { describe, it, expect } from 'vitest'
import * as ptyFactoryModule from './ptyFactory'

describe('ptyFactory — the DI seam (AR-11)', () => {
  it('exports createPty without spawning a real PTY on import', () => {
    // The module import above did not throw (no real node-pty spawn at import time) and
    // the default factory is present for production wiring.
    expect(typeof ptyFactoryModule.createPty).toBe('function')
  })
})
