// Vitest config for StrykerJS (`npm run mutate`): the node projects only. The jsdom `unit` project
// is left out on purpose (spec 2026-10-15 testing standards): slow under mutation and noisy.
import { defineConfig } from 'vitest/config'
import base from './vitest.config'

const projects = (base.test?.projects ?? []).filter(
  (p) => typeof p === 'object' && 'test' in p && p.test?.name !== 'unit'
)

export default defineConfig({ test: { projects } })
