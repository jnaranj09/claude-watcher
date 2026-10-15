// Playwright-Electron e2e: the specs in tests/e2e/*.e2e.ts (launch, native engine, terminal,
// quit, single instance) plus the e2e profile's refusal check (profile.e2e.ts). Each launches the
// BUILT app (`out/main/index.js`); `npm run test:e2e` builds first, and globalSetup fails the run
// on an older build. Every app runs on the e2e profile (its own ports, a fresh temp data folder
// per launch, tests/e2e/fixtures.ts) on a hidden display (tests/headless/headlessDisplay.mjs).
// The zero-dependency packaged smoke (`npm run smoke`) is a separate gate.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  // Fails the run on a stale build or a held e2e port, then starts the hidden display
  // (CW_HEADED=1 to watch on the desktop).
  globalSetup: './tests/e2e/globalSetup.ts',
  // Per-test output dirs: hand-made screenshots, and on failure the fixture's trace.zip.
  outputDir: 'test-results/e2e',
  // No web server / browser projects: Electron is driven via Playwright's `_electron` launcher
  // in tests/e2e/fixtures.ts.
  fullyParallel: false,
  // ONE worker so spec FILES run serially too (fullyParallel:false only serializes WITHIN a
  // file): every spec's app binds the e2e profile's one hook port, so two at once would fight
  // for it and the native-engine POSTs could reach the wrong app.
  workers: 1,
  // A `.only` would silently skip every other e2e test (technical-taste §5b-3), locally too.
  forbidOnly: true,
  retries: 0,
  reporter: 'list'
})
