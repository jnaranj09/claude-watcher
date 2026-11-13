// The oldest claude this app launches against, shared by main (the gate, claudeVersion.ts) and the
// renderer (the name prompt's `Update claude to <MIN> or newer…` copy — spec 2026-09-29 §2.4).
// Bump it ONLY together with a re-verification of `--session-id`, `-n` and `--settings`.
// MIN_MOD_CLAUDE_VERSION is the bridge mod's own floor (spec 2026-10-18 §1.1): below it the session
// launches without `--plugin-dir`, so it never moves MIN_CLAUDE_VERSION. MIN_EXTRACT_CLAUDE_VERSION is
// the floor for saving memory from a session; it moves neither of the other two.

/** A three-part semantic version. Pre-release/build suffixes are ignored. */
export interface ClaudeVersion {
  major: number
  minor: number
  patch: number
}

/** The version every dependent behaviour was verified on. */
export const MIN_CLAUDE_VERSION: ClaudeVersion = { major: 2, minor: 1, patch: 245 }

/** The version the bridge mod was probed on (2026-10-19): `--plugin-dir` loads it with no
 *  consent screen, `prompt.context` gives `instructionFiles`, `$.http.fetch` sends no `Origin`. */
export const MIN_MOD_CLAUDE_VERSION: ClaudeVersion = { major: 2, minor: 1, patch: 304 }

/** The version saving memory from a session was probed on (memory phase 2, 2026-11-12): the
 *  `-p` call with `--json-schema` and `structured_output`. Below it no save runs; an unknown
 *  version runs (fail open). */
export const MIN_EXTRACT_CLAUDE_VERSION: ClaudeVersion = { major: 2, minor: 1, patch: 323 }

/** `2.1.245` — for operator-facing messages. */
export function formatVersion(v: ClaudeVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`
}
