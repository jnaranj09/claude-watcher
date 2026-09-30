// Action feedback (spec 2026-09-29 §2.4) — an in-app launch refusal is a CODE the renderer maps to
// copy (`claude_version`, `folder_missing`). Main shows no native error box for it any more: the
// name prompt stays open and says why (§2.2). The API path is untouched (claudeVersion.test.ts).
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LAUNCH_CLAUDE_VERSION, requireClaudeVersion, runInAppLaunch } from './inAppLaunch'
import { LAUNCH_FOLDER_MISSING } from './launchSession'

describe('requireClaudeVersion', () => {
  it('throws the claude_version CODE when the gate refuses', () => {
    expect(LAUNCH_CLAUDE_VERSION).toBe('claude_version')
    expect(() => requireClaudeVersion(() => false)).toThrow(new Error('claude_version'))
  })

  it('returns quietly when the gate allows (fail-open included)', () => {
    expect(() => requireClaudeVersion(() => true)).not.toThrow()
  })
})

describe('runInAppLaunch', () => {
  it('a too-old claude throws claude_version and never runs the launch', () => {
    const run = vi.fn(() => 'term-1')
    expect(() => runInAppLaunch({ allowsLaunch: () => false, log: vi.fn() }, run)).toThrow(
      new Error('claude_version')
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('returns the launch result when allowed', () => {
    expect(runInAppLaunch({ allowsLaunch: () => true, log: vi.fn() }, () => 'term-1')).toBe(
      'term-1'
    )
  })

  it('a missing folder rethrows the folder_missing code and logs a code only', () => {
    const log = vi.fn()
    const refusal = new Error(LAUNCH_FOLDER_MISSING)
    expect(() =>
      runInAppLaunch({ allowsLaunch: () => true, log }, () => {
        throw refusal
      })
    ).toThrow(refusal)
    expect(log).toHaveBeenCalledWith('[claude-watcher][launch] code=folder_missing')
  })

  it('any other failure passes through untouched and logs nothing', () => {
    const log = vi.fn()
    const other = new Error('spawn EACCES /home/op/project')
    expect(() =>
      runInAppLaunch({ allowsLaunch: () => true, log }, () => {
        throw other
      })
    ).toThrow(other)
    expect(log).not.toHaveBeenCalled()
  })
})

describe('index.ts shows no native error box for an in-app launch', () => {
  const src = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')

  it('has no showErrorBox call left', () => {
    expect(src).not.toContain('showErrorBox')
  })

  it('throws no sentence where a code belongs', () => {
    expect(src).not.toContain('claude version below the supported minimum')
  })
})
