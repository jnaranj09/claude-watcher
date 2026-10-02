// Story 0.3 (Task 6) — the AUTOMATED fixture-test runner for the
// `no-literal-channels` ESLint rule (AC-4).
//
// Story 0.2 authored the rule (`eslint-rules/no-literal-channels.js`) + two
// fixtures (`eslint-rules/__fixtures__/{bad-literal-channel,good-ch-channel}.ts`)
// and demonstrated them MANUALLY via `npx eslint`, explicitly deferring the
// AUTOMATED pass/fail runner to Story 0.3 (now that Vitest is installed). This
// closes that deferral + the architecture's "fixture-tested" enforcement
// requirement: it runs ESLint PROGRAMMATICALLY (the flat-config `ESLint` API)
// over the bad fixture (asserts the rule reports ≥1 violation) and the good
// fixture (asserts clean). [Source: 0-2 Task 3; deferred-work.md:17;
// architecture.md#Enforcement ("fixture-tested")]
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { ESLint } from 'eslint'
// Import the authored rule directly so the test is hermetic — it builds a flat
// config containing ONLY the local plugin + rule, independent of the repo's
// eslint.config.mjs (which IGNORES the fixtures so `npm run lint` stays green).
// @ts-expect-error — the local rule is a plain .js flat-config plugin with no types.
import localIpc from '../../eslint-rules/no-literal-channels.js'

const FIXTURE_DIR = resolve(__dirname, '..', '..', 'eslint-rules', '__fixtures__')
const RULE_ID = 'local-ipc/no-literal-channels'

/** Build an ESLint instance scoped to ONLY the local rule (no extends, no ignores). */
function makeLinter(): ESLint {
  return new ESLint({
    overrideConfigFile: true, // ignore the repo eslint.config.mjs entirely
    overrideConfig: [
      {
        files: ['**/*.ts'],
        plugins: { 'local-ipc': localIpc as ESLint.Plugin },
        rules: { [RULE_ID]: 'error' }
      }
    ]
  })
}

describe('no-literal-channels — automated fixture runner (AC-4)', () => {
  let eslint: ESLint
  beforeAll(() => {
    eslint = makeLinter()
  })

  it('reports ≥1 no-literal-channels violation on the BAD fixture', async () => {
    const results = await eslint.lintFiles([resolve(FIXTURE_DIR, 'bad-literal-channel.ts')])
    const messages = results.flatMap((r) => r.messages)
    const ruleHits = messages.filter((m) => m.ruleId === RULE_ID)
    // The bad fixture has many non-contract IPC calls; assert the rule fired.
    expect(ruleHits.length).toBeGreaterThanOrEqual(1)
    // Be specific: the fixture has 12 banned call sites (5 plain literals + 3
    // less-common methods + 1 computed-member + 1 concat + 1 interpolated + 1 more);
    // assert a healthy lower bound rather than an exact brittle count.
    expect(ruleHits.length).toBeGreaterThanOrEqual(10)
  })

  it('reports ZERO no-literal-channels violations on the GOOD fixture', async () => {
    const results = await eslint.lintFiles([resolve(FIXTURE_DIR, 'good-ch-channel.ts')])
    const messages = results.flatMap((r) => r.messages)
    const ruleHits = messages.filter((m) => m.ruleId === RULE_ID)
    expect(ruleHits).toHaveLength(0)
  })

  // The trusted-sender wrapper (src/main/ipc/trustedIpc.ts) is named `ipc` at every main call
  // site; the rule must keep checking those, or the wrapper would hide a literal channel.
  it('checks the trusted wrapper `ipc` like ipcMain', async () => {
    const results = await eslint.lintText(
      "ipc.handle('tags:list', () => [])\nipc.on(`x:${y}`, () => {})\nipc.handle(CH.tagsList, () => [])\n",
      { filePath: resolve(FIXTURE_DIR, 'inline-wrapper.ts') }
    )
    const ruleHits = results.flatMap((r) => r.messages).filter((m) => m.ruleId === RULE_ID)
    expect(ruleHits.map((m) => m.line)).toEqual([1, 2])
  })
})
