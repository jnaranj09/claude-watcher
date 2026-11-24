// Security audit finding `claudeBin.ts:shellQuote:posix-only-quoting-under-login-shell`: the
// composed claude command is POSIX-quoted, and it runs under the operator's login shell. Under
// fish, `\'` ends a quoted string and `(…)` runs a command, so a session name, a prompt or a
// memory line could run a program. Fault: a spawn that hands the composed command to a non-POSIX
// login shell to parse. Each case runs the real shell with a stub claude that prints its argv.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  composeClaudeCommand,
  LOGIN_SHELL_COMMAND_ENV,
  loginShellRun,
  type ClaudeCommandSpec
} from './claudeBin'

const SHELLS = ['/usr/bin/bash', '/usr/bin/fish'].filter((s) => existsSync(s))

let dir = ''
let stub = ''

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-login-shell-'))
  stub = join(dir, 'claude-stub.sh')
  // Prints each argument NUL-ended, then whether the launch var reached claude.
  writeFileSync(
    stub,
    `#!/bin/sh\nfor a in "$@"; do printf "%s\\0" "$a"; done\nprintf "env=%s\\0" "\${${LOGIN_SHELL_COMMAND_ENV}-unset}"\n`
  )
  chmodSync(stub, 0o755)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function spec(over: Partial<ClaudeCommandSpec>): ClaudeCommandSpec {
  return {
    claudeCommand: stub,
    sessionId: 'sid-1',
    displayName: 'x',
    hookSettingsPath: null,
    appendSystemPrompt: null,
    model: null,
    permissionMode: null,
    effort: null,
    initialPrompt: null,
    resume: false,
    pluginDirs: [],
    mcpConfigPaths: [],
    allowedTools: null,
    ...over
  }
}

function runUnder(shell: string, over: Partial<ClaudeCommandSpec>): string[] {
  const run = loginShellRun(shell, composeClaudeCommand(spec(over)))
  return execFileSync(shell, run.args, {
    encoding: 'utf8',
    env: { ...process.env, ...run.env },
    timeout: 20_000
  })
    .split('\0')
    .slice(0, -1)
}

describe.runIf(SHELLS.length === 2)('the composed command under a real login shell', () => {
  const marker = (): string => join(dir, 'ran')
  // `\'(…)\'` is balanced for fish after POSIX quoting, so fish runs the `(…)`; the rest is for
  // POSIX shells.
  const hostile = (): string =>
    `\\'(touch ${marker()})\\' ; $(touch ${marker()}) ; \`touch ${marker()}\``

  it.each(SHELLS)(
    'under %s a hostile name and prompt run nothing and reach argv whole',
    (shell) => {
      const argv = runUnder(shell, {
        displayName: hostile(),
        appendSystemPrompt: hostile(),
        initialPrompt: hostile()
      })
      expect(existsSync(marker())).toBe(false)
      expect(argv).toEqual([
        '--session-id',
        'sid-1',
        '-n',
        hostile(),
        '--append-system-prompt',
        hostile(),
        '--',
        hostile(),
        'env=unset'
      ])
    }
  )
})

it('a POSIX login shell gets the composed command as its -c argument, a non-POSIX one never does', () => {
  const command = composeClaudeCommand(spec({ displayName: 'n' }))
  expect([
    loginShellRun('/bin/zsh', command).args[2],
    loginShellRun('/usr/bin/fish', command).args[2]
  ]).toEqual([command, `exec /bin/sh -c "$${LOGIN_SHELL_COMMAND_ENV}"`])
})
