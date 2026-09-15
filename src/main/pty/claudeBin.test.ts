// Tests for the absolute-`claude` resolver (claudeBin.ts).
//
// The headline case is the CachyOS/Arch + KDE regression this module exists for: the app is
// launched from the KDE menu, so it inherits the graphical-session PATH (no `~/.local/bin`),
// and `bash -l -c` returns out of Arch's stock `~/.bashrc` at its non-interactive guard —
// BEFORE the line that would add `~/.local/bin`. Pre-fix that spawned bare `claude`, bash
// exited 127, and the board showed "Terminal exited." The `wellKnown` fallback is the guard
// that fixes it; `resolves the REAL KDE-session repro` below is its fault-injection proof —
// drop the wellKnown block from resolveClaudeBin and that test goes red.

import { describe, it, expect, beforeAll } from 'vitest'
import {
  resolveClaudeBin,
  shellQuote,
  prependToPath,
  composeClaudeCommand,
  QUESTION_FORMAT_PROMPT
} from './claudeBin'
import type { ClaudeCommandSpec } from './claudeBin'
import { EFFORT_LEVELS } from '../../shared/schemas/template'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The exact PATH a KDE-menu-launched app inherits on this machine (read from
 *  plasmashell's /proc/<pid>/environ). Note: no `~/.local/bin`. */
const KDE_SESSION_PATH =
  '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/opt/cuda/bin:/usr/bin/site_perl:/usr/bin/vendor_perl:/usr/bin/core_perl'

const HOME = '/home/dev'

/** An `isExecutable` fake over an explicit set of existing executables. */
const only =
  (...paths: string[]) =>
  (p: string): boolean =>
    paths.includes(p)

describe('resolveClaudeBin', () => {
  it('resolves the REAL KDE-session repro: stripped PATH + claude in ~/.local/bin', () => {
    // This is the bug. The PATH scan MUST miss and the well-known fallback MUST land.
    const r = resolveClaudeBin({
      isExecutable: only(`${HOME}/.local/bin/claude`),
      path: KDE_SESSION_PATH,
      home: HOME
    })

    expect(r.command).toBe(`${HOME}/.local/bin/claude`)
    expect(r.dir).toBe(`${HOME}/.local/bin`)
    expect(r.source).toBe('wellKnown')
    // The whole point: never the bare command that exits 127.
    expect(r.command).not.toBe('claude')
  })

  it('prefers a PATH hit over the well-known list (an interactive-PATH dev run)', () => {
    const r = resolveClaudeBin({
      isExecutable: only('/usr/bin/claude', `${HOME}/.local/bin/claude`),
      path: `/usr/bin:${HOME}/.local/bin`,
      home: HOME
    })

    expect(r.command).toBe('/usr/bin/claude')
    expect(r.source).toBe('path')
  })

  it('the operator override wins over both PATH and well-known', () => {
    const r = resolveClaudeBin({
      isExecutable: only('/opt/custom/claude', '/usr/bin/claude', `${HOME}/.local/bin/claude`),
      path: '/usr/bin',
      home: HOME,
      override: '/opt/custom/claude'
    })

    expect(r.command).toBe('/opt/custom/claude')
    expect(r.dir).toBe('/opt/custom')
    expect(r.source).toBe('override')
  })

  it('a set-but-unusable override FALLS THROUGH instead of hard-failing the launch', () => {
    const r = resolveClaudeBin({
      isExecutable: only(`${HOME}/.local/bin/claude`),
      path: KDE_SESSION_PATH,
      home: HOME,
      override: '/opt/typo/claude' // not executable
    })

    expect(r.command).toBe(`${HOME}/.local/bin/claude`)
    expect(r.source).toBe('wellKnown')
  })

  it('an empty-string override is treated as unset', () => {
    const r = resolveClaudeBin({
      isExecutable: only('/usr/bin/claude'),
      path: '/usr/bin',
      home: HOME,
      override: ''
    })

    expect(r.source).toBe('path')
  })

  it('falls back to the older ~/.claude/local layout when ~/.local/bin has no claude', () => {
    const r = resolveClaudeBin({
      isExecutable: only(`${HOME}/.claude/local/claude`),
      path: KDE_SESSION_PATH,
      home: HOME
    })

    expect(r.command).toBe(`${HOME}/.claude/local/claude`)
    expect(r.source).toBe('wellKnown')
  })

  it('unresolved keeps the pre-fix bare command (never invents a path, never throws)', () => {
    const r = resolveClaudeBin({
      isExecutable: () => false,
      path: KDE_SESSION_PATH,
      home: HOME
    })

    expect(r.command).toBe('claude')
    expect(r.dir).toBeNull()
    expect(r.source).toBe('unresolved')
  })

  it('an undefined/empty PATH does not throw and still reaches the well-known list', () => {
    const r = resolveClaudeBin({
      isExecutable: only(`${HOME}/.local/bin/claude`),
      path: undefined,
      home: HOME
    })

    expect(r.source).toBe('wellKnown')
  })

  it('skips empty PATH segments (POSIX "cwd") — never launches a cwd-relative claude', () => {
    const isExecutable = (p: string): boolean => p === 'claude' || p === '/claude'
    const r = resolveClaudeBin({ isExecutable, path: '::', home: HOME })

    expect(r.source).toBe('unresolved')
    expect(r.command).toBe('claude')
  })

  it('handles a trailing-slash PATH segment without doubling the separator', () => {
    const r = resolveClaudeBin({
      isExecutable: only('/usr/bin/claude'),
      path: '/usr/bin/',
      home: HOME
    })

    expect(r.command).toBe('/usr/bin/claude')
  })
})

describe('shellQuote', () => {
  it('quotes a plain path', () => {
    expect(shellQuote('/home/dev/.local/bin/claude')).toBe("'/home/dev/.local/bin/claude'")
  })

  it('survives a home dir containing a space (the command must not split)', () => {
    expect(shellQuote('/home/dev user/.local/bin/claude')).toBe(
      "'/home/dev user/.local/bin/claude'"
    )
  })

  it('escapes an embedded single quote so the quoting cannot be broken out of', () => {
    // POSIX form: close, escaped-quote, reopen.
    expect(shellQuote("/home/o'brien/claude")).toBe(`'/home/o'\\''brien/claude'`)
  })
})

describe('prependToPath', () => {
  it('prepends the resolved dir so claude subprocesses see its siblings', () => {
    expect(prependToPath(`${HOME}/.local/bin`, KDE_SESSION_PATH)).toBe(
      `${HOME}/.local/bin:${KDE_SESSION_PATH}`
    )
  })

  it('does NOT duplicate a dir already on PATH', () => {
    expect(prependToPath('/usr/bin', '/usr/bin:/bin')).toBe('/usr/bin:/bin')
  })

  it('leaves PATH untouched when the binary was unresolved', () => {
    expect(prependToPath(null, KDE_SESSION_PATH)).toBe(KDE_SESSION_PATH)
  })

  it('handles an absent PATH', () => {
    expect(prependToPath('/usr/bin', undefined)).toBe('/usr/bin')
    expect(prependToPath('/usr/bin', '')).toBe('/usr/bin')
    expect(prependToPath(null, undefined)).toBeUndefined()
  })
})

// Name-sync — the composed launch command. This lives in claudeBin.ts precisely so it CAN be
// tested: `rawClaudeSpawn` sits in index.ts, which nothing can import, so an inlined
// composition would be unfalsifiable. [spec-claude-session-name-sync.md]
describe('composeClaudeCommand', () => {
  const BIN = '/home/dev/.local/bin/claude'
  const SID = 'aaaaaaaa-0000-4000-8000-000000000001'

  function spec(overrides: Partial<ClaudeCommandSpec> = {}): ClaudeCommandSpec {
    return {
      claudeCommand: BIN,
      sessionId: SID,
      displayName: 'x',
      hookSettingsPath: null,
      appendSystemPrompt: null,
      model: null,
      permissionMode: null,
      effort: null,
      initialPrompt: null,
      ...overrides
    }
  }

  describe('composeClaudeCommand — template flags (--model / --permission-mode)', () => {
    it('both null ⇒ the pre-template command, byte for byte', () => {
      expect(composeClaudeCommand(spec({ displayName: 'billing api' }))).toBe(
        `'${BIN}' --session-id '${SID}' -n 'billing api'`
      )
    })
    it('appends --model and --permission-mode after every other flag, shell-quoted', () => {
      expect(composeClaudeCommand(spec({ model: 'opus', permissionMode: 'acceptEdits' }))).toBe(
        `'${BIN}' --session-id '${SID}' -n 'x' --model 'opus' --permission-mode 'acceptEdits'`
      )
    })
    it('a full model name with brackets is one quoted argument', () => {
      expect(composeClaudeCommand(spec({ model: 'claude-fable-5[1m]' }))).toContain(
        `--model 'claude-fable-5[1m]'`
      )
    })
    it('an empty model string is treated like null (never a bare --model)', () => {
      expect(composeClaudeCommand(spec({ model: '' }))).not.toContain('--model')
    })
    it('effort null ⇒ no --effort anywhere (the folder flow must not change)', () => {
      expect(composeClaudeCommand(spec({ model: 'opus', permissionMode: 'plan' }))).not.toContain(
        '--effort'
      )
    })
    it('appends --effort LAST, shell-quoted, for every level', () => {
      expect(
        composeClaudeCommand(
          spec({ model: 'opus', permissionMode: 'acceptEdits', effort: 'xhigh' })
        )
      ).toBe(
        `'${BIN}' --session-id '${SID}' -n 'x' --model 'opus' --permission-mode 'acceptEdits' --effort 'xhigh'`
      )
      for (const level of EFFORT_LEVELS) {
        const cmd = composeClaudeCommand(spec({ effort: level }))
        expect(cmd).toBe(`'${BIN}' --session-id '${SID}' -n 'x' --effort '${level}'`)
        expect(cmd.split('--effort').length - 1).toBe(1)
      }
    })
  })

  describe('composeClaudeCommand — the initial prompt (programmatic API)', () => {
    it('null ⇒ byte-identical to the command without a prompt', () => {
      expect(composeClaudeCommand(spec({ initialPrompt: null }))).toBe(
        `'${BIN}' --session-id '${SID}' -n 'x'`
      )
    })
    it('appends the prompt LAST as one shell-quoted positional argument', () => {
      expect(composeClaudeCommand(spec({ effort: 'low', initialPrompt: 'work on HT-1' }))).toBe(
        `'${BIN}' --session-id '${SID}' -n 'x' --effort 'low' 'work on HT-1'`
      )
    })
    it('an apostrophe inside the prompt survives the quoting', () => {
      expect(composeClaudeCommand(spec({ initialPrompt: "it's HT-1" }))).toContain(
        `'it'\\''s HT-1'`
      )
    })
    it('an empty prompt appends nothing', () => {
      expect(composeClaudeCommand(spec({ initialPrompt: '' }))).toBe(
        `'${BIN}' --session-id '${SID}' -n 'x'`
      )
    })
  })

  it('carries the minted session id AND the operator name as claude -n', () => {
    expect(composeClaudeCommand(spec({ displayName: 'billing api' }))).toBe(
      `'${BIN}' --session-id '${SID}' -n 'billing api'`
    )
  })

  it('QUOTES a name containing an apostrophe — the injection this guard exists for', () => {
    // SessionNameSchema bans control characters but ALLOWS an apostrophe. Un-quoted, `it's`
    // would close the shell quoting and split the command into pieces the shell then runs.
    const cmd = composeClaudeCommand(spec({ displayName: "it's mine" }))

    expect(cmd).toBe(`'${BIN}' --session-id '${SID}' -n 'it'\\''s mine'`)
  })

  // Run the composed string through a REAL `$SHELL -l -c`, exactly as rawClaudeSpawn does,
  // with a stub standing in for claude that reports the argv it actually received. Asserting
  // the composed STRING proves what we wrote; this proves what the shell then does with it —
  // which is the thing that actually matters for an injection guard.
  describe('under a real shell', () => {
    let stub = ''
    beforeAll(() => {
      stub = join(mkdtempSync(join(tmpdir(), 'c9-argv-')), 'claude-stub.sh')
      // Print one argument per line so argument BOUNDARIES are visible (echo would hide them).
      writeFileSync(stub, '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n')
      chmodSync(stub, 0o755)
    })

    const argvFor = (name: string, settingsPath: string | null = null): string[] =>
      execFileSync(
        '/bin/sh',
        [
          '-l',
          '-c',
          composeClaudeCommand(
            spec({ claudeCommand: stub, displayName: name, hookSettingsPath: settingsPath })
          )
        ],
        {
          encoding: 'utf8'
        }
      )
        .split('\n')
        .filter((l) => l !== '')

    it('passes an apostrophe name as ONE argument, running nothing extra', () => {
      expect(argvFor("it's mine")).toEqual(['--session-id', SID, '-n', "it's mine"])
    })

    it('does not let a name run a second command', () => {
      // Un-quoted, the `;` would end the claude command and the shell would run the rest.
      expect(argvFor("x'; echo PWNED; '")).toEqual(['--session-id', SID, '-n', "x'; echo PWNED; '"])
    })

    it('does not let a name substitute a command', () => {
      expect(argvFor('$(echo PWNED) `echo PWNED2`')).toEqual([
        '--session-id',
        SID,
        '-n',
        '$(echo PWNED) `echo PWNED2`'
      ])
    })

    it('delivers a spaced --settings path as ONE argument, name still intact', () => {
      // Both operator-influenced values quoted at once: proves the two quoted arguments do not
      // interfere with each other once a real shell splits the command.
      expect(argvFor("it's mine", '/tmp/a b/hooks.json')).toEqual([
        '--session-id',
        SID,
        '-n',
        "it's mine",
        '--settings',
        '/tmp/a b/hooks.json'
      ])
    })

    it('delivers QUESTION_FORMAT_PROMPT to claude as ONE argument with the exact text', () => {
      // The question-format nudge (DA-4) is shell-quoted, not app-quoted — this proves a REAL
      // shell hands it to claude intact as a single argv entry, not split on its spaces/quotes.
      const cmd = composeClaudeCommand(
        spec({ claudeCommand: stub, appendSystemPrompt: QUESTION_FORMAT_PROMPT })
      )
      const argv = execFileSync('/bin/sh', ['-l', '-c', cmd], { encoding: 'utf8' })
        .split('\n')
        .filter((l) => l !== '')

      expect(argv).toEqual([
        '--session-id',
        SID,
        '-n',
        'x',
        '--append-system-prompt',
        QUESTION_FORMAT_PROMPT
      ])
    })

    it('hands a hostile initial prompt to claude as ONE positional argument', () => {
      // The programmatic API's prompt is REQUEST-supplied text reaching a shell — the same
      // injection surface as the operator-typed name, which is why it is shell-quoted. Proving
      // the composed string is not enough here; this proves what a real shell does with it.
      const prompt = "fix HT-1; echo PWNED $(echo PWNED2) `echo PWNED3` — it's urgent"
      const cmd = composeClaudeCommand(spec({ claudeCommand: stub, initialPrompt: prompt }))
      const argv = execFileSync('/bin/sh', ['-l', '-c', cmd], { encoding: 'utf8' })
        .split('\n')
        .filter((l) => l !== '')

      expect(argv).toEqual(['--session-id', SID, '-n', 'x', prompt])
    })
  })

  it('quotes a name with spaces, semicolons and substitutions as a single argument', () => {
    const cmd = composeClaudeCommand(spec({ displayName: 'a b; rm -rf /tmp/x $(whoami) `id`' }))

    expect(cmd).toContain(`-n 'a b; rm -rf /tmp/x $(whoami) \`id\`'`)
  })

  it('omits -n entirely for an empty name — never emit a bare flag that eats the next arg', () => {
    expect(composeClaudeCommand(spec({ displayName: '' }))).toBe(`'${BIN}' --session-id '${SID}'`)
  })

  it('still quotes a claude path containing a space', () => {
    expect(composeClaudeCommand(spec({ claudeCommand: '/home/dev user/bin/claude' }))).toContain(
      `'/home/dev user/bin/claude'`
    )
  })

  // ZERO-FOOTPRINT hook delivery. The flag is how the hook block reaches claude now that
  // nothing is written into the operator's project, so a session launched WITHOUT it reports
  // no status at all — losing this arg silently breaks the whole board.
  describe('--settings (zero-footprint hook delivery)', () => {
    const SETTINGS = '/home/dev/.config/c9watch/claude-hooks.settings.json'

    it('appends --settings with the hook file path', () => {
      expect(
        composeClaudeCommand(spec({ displayName: 'billing api', hookSettingsPath: SETTINGS }))
      ).toBe(`'${BIN}' --session-id '${SID}' -n 'billing api' --settings '${SETTINGS}'`)
    })

    it('omits the flag on null — the fail-soft path when the file could not be written', () => {
      // A bare `--settings` would swallow the next argument, and there is no next argument
      // here, so claude would take the flag with a missing value. Omit it entirely instead.
      const cmd = composeClaudeCommand(spec())

      expect(cmd).not.toContain('--settings')
    })

    it('omits the flag on an empty path too', () => {
      expect(composeClaudeCommand(spec({ hookSettingsPath: '' }))).not.toContain('--settings')
    })

    it('QUOTES a settings path containing a space', () => {
      // Electron's userData dir sits under the operator's home; a space there would split the
      // path into two arguments and claude would read a file that does not exist.
      const cmd = composeClaudeCommand(
        spec({ hookSettingsPath: '/home/dev user/.config/c9/hooks.json' })
      )

      expect(cmd).toContain(`--settings '/home/dev user/.config/c9/hooks.json'`)
    })
  })

  // Deterministic-attention (DA-4) — the question-format nudge given to every app-launched
  // claude via --append-system-prompt (probe-verified GO on claude ≥2.1.245).
  describe('--append-system-prompt (question-format nudge)', () => {
    it('appends --append-system-prompt shell-quoted when a prompt is given', () => {
      const cmd = composeClaudeCommand(
        spec({ appendSystemPrompt: "ask with AskUserQuestion; end questions with '?'" })
      )

      expect(cmd).toContain(
        ` --append-system-prompt ${shellQuote("ask with AskUserQuestion; end questions with '?'")}`
      )
    })

    it('omits the flag entirely for null (fail-soft — the spawn works without the nudge)', () => {
      const cmd = composeClaudeCommand(spec({ displayName: 'n' }))

      expect(cmd).not.toContain('--append-system-prompt')
    })

    it('omits the flag for an empty prompt too', () => {
      expect(composeClaudeCommand(spec({ appendSystemPrompt: '' }))).not.toContain(
        '--append-system-prompt'
      )
    })

    it('composes QUESTION_FORMAT_PROMPT with the exact real spawn call, shell-quoted', () => {
      const cmd = composeClaudeCommand(spec({ appendSystemPrompt: QUESTION_FORMAT_PROMPT }))

      expect(cmd).toBe(
        `'${BIN}' --session-id '${SID}' -n 'x' --append-system-prompt ${shellQuote(QUESTION_FORMAT_PROMPT)}`
      )
    })
  })
})
