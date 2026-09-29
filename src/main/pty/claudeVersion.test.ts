// Claude version gate. Two things are worth guarding here: that a genuinely too-old claude is
// BLOCKED (the spawn does not degrade — it dies on an unknown flag), and that an unreadable
// version is ALLOWED (a false block would brick a working install).
import { describe, it, expect, vi } from 'vitest'
import {
  parseClaudeVersion,
  compareVersions,
  gateClaudeVersion,
  formatVersion,
  tooOldMessage,
  createClaudeVersionGate,
  API_VERSION_REFUSAL_TTL_MS,
  MIN_CLAUDE_VERSION,
  type ClaudeVersion
} from './claudeVersion'

const v = (major: number, minor: number, patch: number): ClaudeVersion => ({ major, minor, patch })

describe('parseClaudeVersion', () => {
  it('reads the REAL observed output of claude 2.1.245', () => {
    // Captured from `claude --version` on the machine this was built against.
    expect(parseClaudeVersion('2.1.245 (Claude Code)')).toEqual(v(2, 1, 245))
  })

  it('tolerates surrounding whitespace and a trailing newline', () => {
    expect(parseClaudeVersion('  2.1.245 (Claude Code)\n')).toEqual(v(2, 1, 245))
  })

  it('still parses if a future release reworks the wording', () => {
    // The scan is not anchored precisely so a rename does not silently disable the gate.
    expect(parseClaudeVersion('Claude Code 2.2.0')).toEqual(v(2, 2, 0))
  })

  it('ignores a pre-release suffix rather than failing on it', () => {
    expect(parseClaudeVersion('2.2.0-beta.3 (Claude Code)')).toEqual(v(2, 2, 0))
  })

  it('ignores a trailing banner line and takes the version from the first', () => {
    expect(parseClaudeVersion('2.1.245 (Claude Code)\nupdate available: 9.9.9')).toEqual(
      v(2, 1, 245)
    )
  })

  it('returns null when the FIRST line has no version, even if a later line does', () => {
    // The real guard for first-line-only scanning. Scanning the whole output would read
    // `1.0.0` out of this tail and BLOCK the launch over a number that is not the version —
    // a false block, the one failure mode this gate must never produce. Reading only the
    // first line yields null instead, which is "unknown", which allows the launch.
    expect(parseClaudeVersion('A notice with no version here\n1.0.0 (something else)')).toBeNull()
  })

  it('returns null on output with no version at all', () => {
    expect(parseClaudeVersion('command not found')).toBeNull()
    expect(parseClaudeVersion('')).toBeNull()
    expect(parseClaudeVersion('   \n  \n')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions(v(3, 0, 0), v(2, 9, 9))).toBeGreaterThan(0)
    expect(compareVersions(v(2, 2, 0), v(2, 1, 999))).toBeGreaterThan(0)
    expect(compareVersions(v(2, 1, 246), v(2, 1, 245))).toBeGreaterThan(0)
    expect(compareVersions(v(2, 1, 245), v(2, 1, 245))).toBe(0)
    expect(compareVersions(v(2, 1, 244), v(2, 1, 245))).toBeLessThan(0)
  })

  it('compares NUMERICALLY, not as strings — 2.1.9 is older than 2.1.10', () => {
    // A string compare puts '2.1.9' AFTER '2.1.10' and would wave through an older claude.
    expect(compareVersions(v(2, 1, 9), v(2, 1, 10))).toBeLessThan(0)
    expect(compareVersions(v(2, 1, 100), v(2, 1, 99))).toBeGreaterThan(0)
  })
})

describe('gateClaudeVersion', () => {
  it('ALLOWS the exact floor — the boundary is inclusive', () => {
    const gate = gateClaudeVersion(`${formatVersion(MIN_CLAUDE_VERSION)} (Claude Code)`)

    expect(gate.kind).toBe('ok')
  })

  it('ALLOWS anything newer', () => {
    expect(gateClaudeVersion('2.2.0 (Claude Code)').kind).toBe('ok')
    expect(gateClaudeVersion('3.0.0 (Claude Code)').kind).toBe('ok')
  })

  it('BLOCKS one patch below the floor', () => {
    // The headline case: --settings / -n / the sessionTitle response are unverified below the
    // floor, and an unknown flag kills the spawn outright instead of degrading.
    const gate = gateClaudeVersion('2.1.244 (Claude Code)')

    expect(gate.kind).toBe('tooOld')
    if (gate.kind !== 'tooOld') return
    expect(gate.version).toEqual(v(2, 1, 244))
    expect(gate.min).toEqual(MIN_CLAUDE_VERSION)
  })

  it('BLOCKS a much older claude', () => {
    expect(gateClaudeVersion('2.1.199 (Claude Code)').kind).toBe('tooOld')
    expect(gateClaudeVersion('1.0.0 (Claude Code)').kind).toBe('tooOld')
  })

  describe('fail-OPEN on unknown (the deliberate inversion of the repo default)', () => {
    it('allows the launch when the binary could not be run at all', () => {
      // resolveClaudeBin can hand back a bare `claude` that only resolves inside the login
      // shell. Blocking here would brick a working install over a failed probe.
      expect(gateClaudeVersion(null).kind).toBe('unknown')
    })

    it('allows the launch when the output cannot be parsed', () => {
      expect(gateClaudeVersion('some future format with no numbers').kind).toBe('unknown')
      expect(gateClaudeVersion('').kind).toBe('unknown')
    })

    it('never reports unknown as tooOld — unknown must not block', () => {
      for (const raw of [null, '', 'garbage', '   ']) {
        expect(gateClaudeVersion(raw).kind).not.toBe('tooOld')
      }
    })
  })
})

describe('tooOldMessage', () => {
  it('names BOTH versions — "too old" alone is not actionable', () => {
    const msg = tooOldMessage(v(2, 1, 240), v(2, 1, 245))

    expect(msg).toContain('2.1.245')
    expect(msg).toContain('2.1.240')
  })

  it('says what to DO about it', () => {
    expect(tooOldMessage(v(2, 1, 240), MIN_CLAUDE_VERSION).toLowerCase()).toContain('update')
  })
})

describe('formatVersion', () => {
  it('renders the dotted form used in every operator-facing string', () => {
    expect(formatVersion(v(2, 1, 245))).toBe('2.1.245')
  })
})

// R25 — the gate has TWO callers that must fail differently. An in-app launch explains itself
// with a native error box (the renderer swallows a rejected invoke); an API create answers its
// own 503 `claude_version` and must NEVER put a box on the operator's desktop — a retrying
// client used to stack one per request, each after a blocking `$SHELL -l` probe.
describe('createClaudeVersionGate', () => {
  const OLD = '2.1.100 (Claude Code)'
  const NEW = '2.1.300 (Claude Code)'
  function gate(
    raw: string | null,
    t = { now: 0 }
  ): {
    g: ReturnType<typeof createClaudeVersionGate>
    readRaw: ReturnType<typeof vi.fn<() => string | null>>
    showTooOld: ReturnType<typeof vi.fn<(m: string) => void>>
    log: ReturnType<typeof vi.fn<(m: string) => void>>
    t: { now: number }
  } {
    const readRaw = vi.fn<() => string | null>(() => raw)
    const showTooOld = vi.fn<(m: string) => void>()
    const log = vi.fn<(m: string) => void>()
    const g = createClaudeVersionGate({ readRaw, now: () => t.now, showTooOld, log })
    return { g, readRaw, showTooOld, log, t }
  }

  it('an API create against a too-old claude is refused WITHOUT an error box', () => {
    const { g, showTooOld } = gate(OLD)
    expect(g.allowsApiLaunch()).toBe(false)
    expect(showTooOld).not.toHaveBeenCalled()
  })

  it('an in-app launch against a too-old claude is refused WITH the error box', () => {
    const { g, showTooOld } = gate(OLD)
    expect(g.allowsInteractiveLaunch()).toBe(false)
    expect(showTooOld).toHaveBeenCalledTimes(1)
    expect(showTooOld.mock.calls[0]?.[0]).toContain('2.1.100')
  })

  it('API retries inside the TTL reuse the refusal instead of re-probing the shell', () => {
    const { g, readRaw, t } = gate(OLD)
    expect(g.allowsApiLaunch()).toBe(false)
    t.now = API_VERSION_REFUSAL_TTL_MS - 1
    expect(g.allowsApiLaunch()).toBe(false)
    expect(g.allowsApiLaunch()).toBe(false)
    expect(readRaw).toHaveBeenCalledTimes(1)
    t.now = API_VERSION_REFUSAL_TTL_MS
    expect(g.allowsApiLaunch()).toBe(false)
    expect(readRaw).toHaveBeenCalledTimes(2)
  })

  it('an in-app launch ALWAYS re-probes a refusal, so an upgrade unblocks at once', () => {
    let raw: string | null = OLD
    const readRaw = vi.fn(() => raw)
    const g = createClaudeVersionGate({
      readRaw,
      now: () => 0,
      showTooOld: () => {},
      log: () => {}
    })
    expect(g.allowsApiLaunch()).toBe(false)
    raw = NEW
    expect(g.allowsInteractiveLaunch()).toBe(true)
    // …and the in-app probe's ok verdict is shared: the API is unblocked too, with no probe.
    expect(g.allowsApiLaunch()).toBe(true)
    expect(readRaw).toHaveBeenCalledTimes(2)
  })

  it('an ok verdict is cached for both callers', () => {
    const { g, readRaw } = gate(NEW)
    expect(g.allowsApiLaunch()).toBe(true)
    expect(g.allowsInteractiveLaunch()).toBe(true)
    expect(g.allowsApiLaunch()).toBe(true)
    expect(readRaw).toHaveBeenCalledTimes(1)
  })

  it('an unreadable version is ALLOWED (fail-open) and never shows a box', () => {
    const { g, showTooOld } = gate(null)
    expect(g.allowsApiLaunch()).toBe(true)
    expect(g.allowsInteractiveLaunch()).toBe(true)
    expect(showTooOld).not.toHaveBeenCalled()
  })

  it('logs a code only — never the raw version output', () => {
    const { g, log } = gate('2.1.100 (Claude Code) /home/op/secret')
    g.allowsApiLaunch()
    g.allowsInteractiveLaunch()
    for (const [line] of log.mock.calls) {
      expect(String(line)).toMatch(/code=/)
      expect(String(line)).not.toContain('/home/op')
    }
  })
})
