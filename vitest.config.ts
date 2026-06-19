// Story 0.3 — Vitest two-project test architecture (AC-4).
//
// This is the unit/integration gate the Stop hook runs (`vitest run`). It defines
// TWO projects via the Vitest 4 `test.projects` API (the successor to the old
// `workspace` file) so pure code is tested under the right environment:
//
//   - `unit`      — environment: 'jsdom' — schemas, the identity adapter, reducers,
//                   store actions, ESLint-rule fixture runners. Pure; no Electron.
//   - `main-unit` — environment: 'node'  — main-process logic (the c9watch
//                   reducer/reconnect with the fake feed; node-pty/child_process
//                   injected via DI seams in later epics). Pure; no Electron.
//
// `MessagePortMain` does NOT exist in jsdom — byte-transport stays packaged-smoke-
// only (the Story-0.1 `tests/smoke/run-packaged-smoke.mjs` gate); do not try to
// unit-test it here. [architecture.md#Testing & Test Seams; epics.md#Story 0.3 AC-4]
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        // jsdom unit project — pure renderer/shared logic (schemas, adapters,
        // the fail-closed fixture-replay test, the no-literal-channels runner).
        test: {
          name: 'unit',
          environment: 'jsdom',
          // Story 1.3 widened the glob to `.test.{ts,tsx}`: TypeScript only parses
          // JSX in `.tsx` files, so renderer COMPONENT tests are `.test.tsx`
          // (util/schema tests stay `.test.ts`). The matching widen in
          // `tsconfig.test.json` keeps them typechecked. [Story 1.3 Task 8 GOTCHA]
          include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
          // The main-process unit globs are owned by the `main-unit` project; keep
          // them out of `unit` so each test runs under exactly one environment.
          exclude: ['src/main/**/*.test.ts', 'tests/main/**/*.test.ts', '**/node_modules/**']
        }
      },
      {
        // node main-unit project — main-process logic with DI seams (no Electron).
        test: {
          name: 'main-unit',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'tests/main/**/*.test.ts'],
          exclude: ['**/node_modules/**']
        }
      }
    ]
  }
})
