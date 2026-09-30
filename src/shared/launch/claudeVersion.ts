// The oldest claude this app launches against, shared by main (the gate, claudeVersion.ts) and the
// renderer (the name prompt's `Update claude to <MIN> or newer…` copy — spec 2026-09-29 §2.4).
// Bump it ONLY together with a re-verification of `--session-id`, `-n` and `--settings`.

/** A three-part semantic version. Pre-release/build suffixes are ignored. */
export interface ClaudeVersion {
  major: number
  minor: number
  patch: number
}

/** The version every dependent behaviour was verified on. */
export const MIN_CLAUDE_VERSION: ClaudeVersion = { major: 2, minor: 1, patch: 245 }

/** `2.1.245` — for operator-facing messages. */
export function formatVersion(v: ClaudeVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`
}
