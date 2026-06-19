// Story 0.3 — Playwright-Electron smoke CONFIG (AC-4: "a Playwright-Electron
// smoke config exist").
//
// SCOPE: this story authors the CONFIG + a minimal SKIPPED placeholder spec only.
// The real FR-10 Playwright-Electron smoke (embedded terminal) is Epic-3 — do NOT
// build a full E2E suite or install Playwright browsers here.
//
// The packaged node-pty exit gate that proves packaging TODAY is the zero-dep
// `tests/smoke/run-packaged-smoke.mjs` from Story 0.1 (run via `npm run smoke`),
// NOT this config. Playwright is the FUTURE home for the FR-10 terminal smoke, not
// a replacement of the working gate. [architecture.md#Testing & Test Seams
// ("packaged smoke (Playwright-Electron) — FR-10 only"); epics.md#Story 0.3 AC-4;
// FR-10 → Epic 3]
import { defineConfig } from '@playwright/test'

export default defineConfig({
  // The Epic-3 FR-10 specs will live here. Today only a skipped placeholder exists.
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  // No web server / browser projects: Electron is driven via Playwright's
  // `_electron` launcher inside the spec (Epic-3), not a browser project here.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list'
})
