// PTY environment — the sanitizer for every spawned terminal's environment.
//
// WHY THIS IS NOT JUST `process.env`. The app can itself be launched from inside a Claude
// Code session (`npm run dev` from a claude terminal, or the packaged app started from
// one). Electron then inherits that session's `CLAUDE_CODE_*` markers, and copying the
// environment wholesale hands them to every claude the app spawns. Observed live on
// claude 2.1.250 (2026-08-27) — the spawned session printed:
//
//   ⚠ Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker
//
// That is not cosmetic. A session with no transcript is invisible to
// `transcriptWatcher`, so the app cannot see an Esc interrupt or a background task
// finishing — the two facts no hook reports. The same inheritance also handed the child
// the PARENT's `CLAUDE_CODE_SESSION_ID`, bridge id and messaging socket, which is wrong
// on its own terms whatever the transcript does.
//
// THE RULE: strip the whole `CLAUDE_CODE_*` family. A claude started from an ordinary
// terminal has none of them set, so stripping them makes an app-launched session behave
// exactly like a hand-launched one — which is the app's whole contract. A prefix match
// (rather than a list of names) means a future marker is covered without an edit here.
//
// Deliberately NOT done: forcing `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`. Removing an
// accidental inheritance restores claude's default; forcing a value would override an
// operator who has genuinely turned transcripts off. If they have, the feature degrades
// quietly to the age backstop rather than fighting their setting.

/** The prefix owned by Claude Code's own session state. Nothing under it should cross
 *  from the launching session into a session this app spawns. */
const CLAUDE_SESSION_PREFIX = 'CLAUDE_CODE_'

/** The packaged-smoke harness variables, which must never reach a real terminal. */
const SMOKE_VARS: ReadonlySet<string> = new Set(['C9_SMOKE', 'C9_SMOKE_OUT', 'C9_TEST_PICK_DIR'])

/**
 * Build the environment handed to a spawned pty: the app's own environment minus the
 * launcher's Claude Code session state and the smoke-harness variables.
 *
 * `source` is injectable so this is testable without mutating the real process env.
 */
export function buildPtyEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue
    if (SMOKE_VARS.has(k)) continue
    if (k.startsWith(CLAUDE_SESSION_PREFIX)) continue
    env[k] = v
  }
  return env
}
