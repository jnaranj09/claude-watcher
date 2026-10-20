// The unit/integration gate the Stop hook runs (`vitest run`). One project per environment, so each
// test runs in the cheapest environment that can run it:
//   - `unit`        jsdom — renderer code: components, hooks, stores, lib, renderer guards.
//   - `shared-node` node  — `src/shared/**`, `tests/unit/**`, `src/__fixtures__/**`: no DOM, and
//                   jsdom setup costs ~0.35 s per file.
//   - `main-unit`   node  — main-process logic with DI seams; no Electron.
//   - `zone-berlin` node  — `*.zone.test.ts`: tests that need a clock-change zone. It runs in
//                   `forks` with `env.TZ`: every worker thread shares the runner process's zone,
//                   so a TZ set in a thread (or `env` on a threads project) never takes effect.
// Threads, not forks (except `zone-berlin`, above): no unit test loads node-pty or calls
// chdir/exit. `pool` is set in EACH project (a root-level one does not reach inline projects).
// Measured 2026-10-14, 3 full runs each: threads 19.6-19.9 s, `--pool=forks` 20.8-20.9 s (about
// 1 s, 5%).
// `isolate` stays on: off, 9 renderer tests fail on state shared between files.
// `restoreMocks`: every vi.spyOn is restored after each test, so a spy cannot leak.
// `allowOnly: false` in EACH project (same reason): a `.only` fails the run, locally too
// (technical-taste §5b-3). `tests/main/vitestConfig.guard.test.ts` fails when a project drops
// `pool`, `restoreMocks` or `allowOnly`, when `zone-berlin` loses its forks pool, its TZ or its
// `ZONE_TESTS` glob, when another project stops skipping that glob, or when no zone test exists.
import { defineConfig } from 'vitest/config'

// Built with a fixed zone; see `zone-berlin` above. Any folder: the guard pins this glob.
export const ZONE_TESTS = '**/*.zone.test.ts'

const NODE_SHARED = [
  'src/shared/**/*.test.ts',
  'tests/unit/**/*.test.ts',
  'src/__fixtures__/**/*.test.ts'
]
// The bridge mod's own `*.test.ts` are engine tests (`claude plugin test`, npm run test:mod), not
// Vitest files; its pure report builder is tested from tests/unit.
const MOD_TESTS = 'src/mod/**'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          pool: 'threads',
          allowOnly: false,
          restoreMocks: true,
          environment: 'jsdom',
          setupFiles: ['src/renderer/src/test/setup.ts'],
          // `.tsx` holds JSX; only `.tsx` component tests need it.
          include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
          exclude: [
            'src/main/**/*.test.ts',
            'tests/main/**/*.test.ts',
            ...NODE_SHARED,
            ZONE_TESTS,
            MOD_TESTS,
            '**/node_modules/**'
          ]
        }
      },
      {
        test: {
          name: 'shared-node',
          pool: 'threads',
          allowOnly: false,
          restoreMocks: true,
          environment: 'node',
          include: NODE_SHARED,
          exclude: [ZONE_TESTS, '**/node_modules/**']
        }
      },
      {
        test: {
          name: 'main-unit',
          pool: 'threads',
          allowOnly: false,
          restoreMocks: true,
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'tests/main/**/*.test.ts'],
          exclude: [ZONE_TESTS, '**/node_modules/**']
        }
      },
      {
        test: {
          name: 'zone-berlin',
          pool: 'forks',
          allowOnly: false,
          restoreMocks: true,
          environment: 'node',
          // Oct 25 2026 is a 25 h day in Berlin, Mar 29 2026 a 23 h day.
          env: { TZ: 'Europe/Berlin' },
          include: [ZONE_TESTS],
          exclude: ['**/node_modules/**']
        }
      }
    ]
  }
})
