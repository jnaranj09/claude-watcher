// StrykerJS: mutation testing of the core modules, run in the release clean-up pass
// (`.claude/rules/release.md` step 0), never in the gate, hooks or CI. A surviving mutant ends as
// a killing test, an IdeasBoard item, or a one-line reason (e.g. an equivalent mutant).
// One file: `npm run mutate -- --mutate src/main/c9watch/reducer.ts`.
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.ts' },
  mutate: [
    'src/main/c9watch/{reducer,attention,columns,enrichDelta,shipGate}.ts',
    'src/shared/schemas/*.ts',
    '!src/shared/schemas/*.test.ts',
    'src/main/api/commands/*.ts',
    '!src/main/api/commands/*.test.ts',
    'src/shared/prompt/expand.ts'
  ],
  incremental: true,
  incrementalFile: 'reports/mutation/stryker-incremental.json',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  tempDirName: '.stryker-tmp'
}
