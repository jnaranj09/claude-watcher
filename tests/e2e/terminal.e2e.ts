// Story 0.3 — Playwright-Electron placeholder spec (AC-4: "a Playwright-Electron
// smoke config exist" + a minimal spec the config can discover).
//
// This is INTENTIONALLY skipped. The real FR-10 embedded-terminal smoke (launch
// the packaged app via Playwright's `_electron`, type into the live xterm, assert
// round-trip) is Epic-3 scope. Authoring it now would require Playwright browsers
// and a full E2E harness, which this enablement story explicitly does NOT pull in.
//
// The packaged node-pty gate that proves packaging survives TODAY is the zero-dep
// `tests/smoke/run-packaged-smoke.mjs` (run via `npm run smoke`). [Story 0.1 AC-3;
// architecture.md#Testing & Test Seams; FR-10 → Epic 3]
import { test } from '@playwright/test'

test.skip('FR-10 embedded terminal round-trip (Epic-3 — placeholder)', () => {
  // Epic-3 will: launch the packaged Electron app via `_electron.launch`, wait for
  // the xterm canvas, type a token, and assert it round-trips through node-pty.
})
