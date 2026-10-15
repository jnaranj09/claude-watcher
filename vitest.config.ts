// The unit/integration gate the Stop hook runs (`vitest run`). Three projects, so each test runs in
// the cheapest environment that can run it:
//   - `unit`        jsdom — renderer code: components, hooks, stores, lib, renderer guards.
//   - `shared-node` node  — `src/shared/**`, `tests/unit/**`, `src/__fixtures__/**`: no DOM, and jsdom
//                   setup costs ~0.35 s per file.
//   - `main-unit`   node  — main-process logic with DI seams; no Electron.
// Threads, not forks: no unit test loads node-pty or calls chdir/exit (measured 2026-10-14: −15% wall).
// `isolate` stays on: off, 9 renderer tests fail on state shared between files.
// `restoreMocks`: every vi.spyOn is restored after each test, so a spy cannot leak.
// `allowOnly: false` in EACH project (a root-level one does not reach inline projects): a `.only`
// fails the run, locally too (technical-taste §5b-3).
import { defineConfig } from 'vitest/config'

const NODE_SHARED = [
  'src/shared/**/*.test.ts',
  'tests/unit/**/*.test.ts',
  'src/__fixtures__/**/*.test.ts'
]

export default defineConfig({
  test: {
    pool: 'threads',
    projects: [
      {
        test: {
          name: 'unit',
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
