// Vitest config for StrykerJS (`npm run mutate`): the node projects only. The jsdom `unit` project
// is left out on purpose (spec 2026-10-15 testing standards): slow under mutation and noisy.
// `zone-berlin` is left out too: its `env.TZ` does not reach the tests under Stryker's runner, so
// the dry run fails, and its `*.zone.test.ts` files test none of the modules Stryker mutates.
import { defineConfig } from 'vitest/config'
import base from './vitest.config'

const LEFT_OUT = new Set(['unit', 'zone-berlin'])
const projects = (base.test?.projects ?? []).filter(
  (p) => typeof p === 'object' && 'test' in p && !LEFT_OUT.has(p.test?.name ?? '')
)

export default defineConfig({ test: { projects } })
