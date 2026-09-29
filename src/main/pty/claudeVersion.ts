// Claude version gate — refuse to launch against a claude too old for the flags this app
// depends on.
//
// WHY A GATE AT ALL: the spawn is not tolerant. `composeClaudeCommand` passes
// `--session-id`, `-n` and `--settings`, and a claude that does not know one of those flags
// does not degrade — it rejects the argument and the session dies instantly with a terminal
// error that looks nothing like "your claude is old". Worse, `--settings` is how the hook
// block reaches claude at all now (zero-footprint delivery), so a silent failure there means
// a board that never shows status and a name-sync that never converges, with no error anywhere.
//
// THE FLOOR is the version every one of those behaviours was verified on end-to-end
// (2.1.245): `--settings` delivery, `-n`, and the `hookSpecificOutput.sessionTitle` rename
// response. It is deliberately "the version we tested", NOT "the version we proved is the
// minimum" — nothing below it has been exercised, so nothing below it is claimed to work.
//
// FAIL-OPEN ON UNKNOWN — and this is the one place in the codebase that does NOT fail closed.
// If the version cannot be read or parsed, the launch is ALLOWED. The reason is asymmetry of
// harm: `resolveClaudeBin` may hand back a bare `claude` that only resolves inside the login
// shell, a future release may reword `--version`, and either would make a fail-closed gate
// brick a working install. A missed warning costs a confusing error; a false block costs the
// whole app. The gate exists to explain a real incompatibility, not to police the binary.
//
// [spec-zero-footprint-hooks.md; spec-claude-session-name-sync.md]

/** A three-part semantic version. Pre-release/build suffixes are ignored. */
export interface ClaudeVersion {
  major: number
  minor: number
  patch: number
}

/**
 * The oldest claude this app will launch against — the version every dependent behaviour was
 * verified on. Bump this ONLY together with a re-verification of the flags above.
 */
export const MIN_CLAUDE_VERSION: ClaudeVersion = { major: 2, minor: 1, patch: 245 }

/** `2.1.245` — for operator-facing messages. */
export function formatVersion(v: ClaudeVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`
}

/**
 * Pull a version out of `claude --version` output.
 *
 * Observed shape (2.1.245): `2.1.245 (Claude Code)`. The scan is deliberately not anchored to
 * the start of the line so a reworded future release (`Claude Code 2.2.0`) still parses —
 * only the FIRST line is considered, so a multi-line banner cannot smuggle in a number from
 * some unrelated tail. Returns `null` on anything it cannot read, which the caller treats as
 * "unknown" and allows.
 */
export function parseClaudeVersion(raw: string): ClaudeVersion | null {
  const firstLine = raw.split('\n').find((l) => l.trim() !== '')
  if (firstLine === undefined) return null

  const m = /(\d+)\.(\d+)\.(\d+)/.exec(firstLine)
  if (m === null) return null

  const major = Number(m[1])
  const minor = Number(m[2])
  const patch = Number(m[3])
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return null
  }
  return { major, minor, patch }
}

/**
 * Order two versions NUMERICALLY: negative when `a < b`, 0 when equal, positive when `a > b`.
 *
 * Numeric per segment, never lexicographic — `2.1.9` vs `2.1.10` is the case that makes a
 * string compare wrong, and it is exactly the case a patch-level floor runs into.
 */
export function compareVersions(a: ClaudeVersion, b: ClaudeVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/** The gate verdict. `unknown` is ALLOWED — see the fail-open note in the file header. */
export type VersionGate =
  | { kind: 'ok'; version: ClaudeVersion }
  | { kind: 'tooOld'; version: ClaudeVersion; min: ClaudeVersion }
  | { kind: 'unknown' }

/**
 * Decide whether a launch may proceed, from raw `claude --version` output.
 *
 * PURE on purpose: the decision is the part worth testing, and it stays testable without
 * spawning a process. `null` means the caller could not run the binary at all.
 */
export function gateClaudeVersion(raw: string | null): VersionGate {
  if (raw === null) return { kind: 'unknown' }

  const version = parseClaudeVersion(raw)
  if (version === null) return { kind: 'unknown' }

  return compareVersions(version, MIN_CLAUDE_VERSION) >= 0
    ? { kind: 'ok', version }
    : { kind: 'tooOld', version, min: MIN_CLAUDE_VERSION }
}

/**
 * The operator-facing message for a blocked launch. Kept here so the wording is asserted by a
 * test rather than buried in a dialog call, and so it names BOTH versions — "too old" without
 * the two numbers is not actionable.
 */
export function tooOldMessage(found: ClaudeVersion, min: ClaudeVersion): string {
  return (
    `This app needs claude ${formatVersion(min)} or newer, but found ${formatVersion(found)}.\n\n` +
    `Update claude, then try again.`
  )
}

/**
 * How long an API create reuses a non-ok verdict before probing again. The probe is a blocking
 * `$SHELL -l -c "claude --version"` on main's event loop (up to its 10 s timeout); a client
 * retrying a 503 must not pay it — or make main pay it — on every request (R25).
 */
export const API_VERSION_REFUSAL_TTL_MS = 30_000

export interface ClaudeVersionGateDeps {
  /** Raw `claude --version` output, or null when the binary could not be run. */
  readRaw: () => string | null
  now: () => number
  /** Explain a refusal to the operator (a native error box in main). IN-APP launches only. */
  showTooOld: (message: string) => void
  /** Code-only log sink. */
  log: (message: string) => void
}

export interface ClaudeVersionGateHandle {
  /** `+ New session`, a template, a past session: the operator is looking, so a refusal gets the
   *  box. Always re-probes a refusal, so upgrading claude unblocks the very next click. */
  allowsInteractiveLaunch(): boolean
  /** `POST /v1/sessions`: the caller gets its own 503, so NO box — ever. A non-ok verdict younger
   *  than `API_VERSION_REFUSAL_TTL_MS` is reused instead of re-probing. */
  allowsApiLaunch(): boolean
}

/**
 * The gate with its caching and its two faces (R25). Only an `ok` verdict is cached for good;
 * a refusal or an unknown is remembered for the API path alone, with a timestamp.
 */
export function createClaudeVersionGate(deps: ClaudeVersionGateDeps): ClaudeVersionGateHandle {
  let okCached = false
  let lastNonOk: { gate: VersionGate; at: number } | null = null

  function probe(): VersionGate {
    const gate = gateClaudeVersion(deps.readRaw())
    if (gate.kind === 'ok') {
      okCached = true
      lastNonOk = null
    } else {
      lastNonOk = { gate, at: deps.now() }
      deps.log(
        gate.kind === 'unknown'
          ? '[c9watch][version] code=claude_version_unknown_allowing_launch'
          : '[c9watch][version] code=claude_version_too_old'
      )
    }
    return gate
  }

  return {
    allowsInteractiveLaunch() {
      if (okCached) return true
      const gate = probe()
      if (gate.kind !== 'tooOld') return true // ok, or FAIL-OPEN on unknown
      deps.showTooOld(tooOldMessage(gate.version, gate.min))
      return false
    },
    allowsApiLaunch() {
      if (okCached) return true
      const fresh =
        lastNonOk !== null && deps.now() - lastNonOk.at < API_VERSION_REFUSAL_TTL_MS
          ? lastNonOk.gate
          : probe()
      return fresh.kind !== 'tooOld'
    }
  }
}
