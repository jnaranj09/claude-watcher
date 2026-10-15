// The unit/integration gate the Stop hook runs (`vitest run`). Three projects, so each test runs in
// the cheapest environment that can run it:
//   - `unit`        jsdom — renderer code: components, hooks, stores, lib, renderer guards.
//   - `shared-node` node  — `src/shared/**`, `tests/unit/**`, `src/__fixtures__/**`: no DOM, and
//                   jsdom setup costs ~0.35 s per file.
//   - `main-unit`   node  — main-process logic with DI seams; no Electron.
// Threads, not forks: no unit test loads node-pty or calls chdir/exit. `pool` is set in EACH
// project (a root-level one does not reach inline projects). Measured 2026-10-14, 3 full runs each:
// threads 19.6-19.9 s, `--pool=forks` 20.8-20.9 s (about 1 s, 5%).
// `isolate` stays on: off, 9 renderer tests fail on state shared between files.
// `restoreMocks`: every vi.spyOn is restored after each test, so a spy cannot leak.
// `allowOnly: false` in EACH project (same reason): a `.only` fails the run, locally too
// (technical-taste §5b-3).
import { defineConfig } from 'vitest/config'

const NODE_SHARED = [
  'src/shared/**/*.test.ts',
  'tests/unit/**/*.test.ts',
  'src/__fixtures__/**/*.test.ts'
]

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
          // `.tsx` holds JSX; only `.tsx` component tests need it.
          include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
          exclude: [
            'src/main/**/*.test.ts',
            'tests/main/**/*.test.ts',
            ...NODE_SHARED,
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
          exclude: ['**/node_modules/**']
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
          exclude: ['**/node_modules/**']
        }
      }
    ]
  }
})
