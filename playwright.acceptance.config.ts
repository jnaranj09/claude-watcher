// Acceptance scenarios (.claude/rules/testing.md "Risky code"): one plain Given / When / Then
// scenario per shipped behaviour, in tests/acceptance/*.scenario.ts, through the BUILT app.
// `npm run test:acceptance` builds first. Local only, not in CI (owner decision 2026-11-24): most
// scenarios launch a real `claude`. Same launch fixture (tests/e2e/fixtures.ts), global setup
// (stale build and held e2e port fail the run; hidden display) and serial run as
// playwright.config.ts, for the same reason: every app binds the e2e profile's one hook port.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/acceptance',
  testMatch: '**/*.scenario.ts',
  globalSetup: './tests/e2e/globalSetup.ts',
  outputDir: 'test-results/acceptance',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: 'list'
})
