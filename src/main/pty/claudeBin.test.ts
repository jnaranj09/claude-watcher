// Tests for the absolute-`claude` resolver (claudeBin.ts).
//
// The headline case is the CachyOS/Arch + KDE regression this module exists for: the app is
// launched from the KDE menu, so it inherits the graphical-session PATH (no `~/.local/bin`),
// and `bash -l -c` returns out of Arch's stock `~/.bashrc` at its non-interactive guard —
// BEFORE the line that would add `~/.local/bin`. Pre-fix that spawned bare `claude`, bash
// exited 127, and the board showed "Terminal exited." The `wellKnown` fallback is the guard
// that fixes it; `resolves the REAL KDE-session repro` below is its fault-injection proof —
// drop the wellKnown block from resolveClaudeBin and that test goes red.

import { describe, it, expect } from 'vitest'
import { resolveClaudeBin, shellQuote, prependToPath } from './claudeBin'

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
    expect(shellQuote('/home/dev/.local/bin/claude')).toBe(
      "'/home/dev/.local/bin/claude'"
    )
  })

  it('survives a home dir containing a space (the command must not split)', () => {
    expect(shellQuote('/home/jose naranjo/.local/bin/claude')).toBe(
      "'/home/jose naranjo/.local/bin/claude'"
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
