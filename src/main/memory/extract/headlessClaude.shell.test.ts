// The composed extract command through a REAL `/bin/sh -l -c`, as the call runs it, with a stub in
// claude's place that prints each argument it received. Asserting the composed string proves what
// main wrote; this proves what a shell then hands claude.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EXTRACT_JSON_SCHEMA } from '../../../shared/schemas/memoryExtract'
import { EXTRACT_SYSTEM_PROMPT } from './extractPrompt'
import { composeExtractCommand } from './headlessClaude'

describe('the extract command under a real shell', () => {
  let dir = ''
  let stub = ''
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'cw-extract-argv-'))
    stub = join(dir, 'claude stub.sh')
    // NUL after each argument, so a multi-line or empty argument comes back whole.
    writeFileSync(stub, '#!/bin/sh\nfor a in "$@"; do printf "%s\\0" "$a"; done\n')
    chmodSync(stub, 0o755)
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const argvThroughSh = (command: string): string[] =>
    execFileSync('/bin/sh', ['-l', '-c', command], { encoding: 'utf8' }).split('\0').slice(0, -1)

  it('every flag value reaches claude as one argument, whatever it holds', () => {
    const prompt = `it's "quoted" $(id) \`id\` \\ and\na second line`
    const argv = argvThroughSh(
      composeExtractCommand({
        claudeCommand: stub,
        model: 'sonnet',
        systemPrompt: prompt,
        jsonSchema: EXTRACT_JSON_SCHEMA,
        budgetUsd: 1
      })
    )
    expect(argv[argv.indexOf('--system-prompt') + 1]).toBe(prompt)
    expect(argv[argv.indexOf('--json-schema') + 1]).toBe(EXTRACT_JSON_SCHEMA)
    expect(argv[argv.indexOf('--setting-sources') + 1]).toBe('')
    expect(argv[argv.indexOf('--tools') + 1]).toBe('')
  })

  it('the shipped prompt and schema give claude exactly the probed argv', () => {
    const argv = argvThroughSh(
      composeExtractCommand({
        claudeCommand: stub,
        model: 'haiku',
        systemPrompt: EXTRACT_SYSTEM_PROMPT,
        jsonSchema: EXTRACT_JSON_SCHEMA,
        budgetUsd: 1
      })
    )
    expect(argv).toEqual([
      '-p',
      '--model',
      'haiku',
      '--output-format',
      'json',
      '--json-schema',
      EXTRACT_JSON_SCHEMA,
      '--system-prompt',
      EXTRACT_SYSTEM_PROMPT,
      '--no-session-persistence',
      '--setting-sources',
      '',
      '--tools',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--max-budget-usd',
      '1'
    ])
  })
})
