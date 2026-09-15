// Resolve the `claude` executable to an ABSOLUTE path — do NOT trust the login shell's PATH.
//
// THE BUG THIS FIXES (CachyOS/Arch + KDE, packaged install): the launch spawn is
// `$SHELL -l -c "claude --session-id '<uuid>'"`. The `-l` was chosen for "the login-shell
// PATH/rc benefit" (index.ts rawClaudeSpawn comment) — the assumption being that a login
// shell reconstructs the operator's interactive PATH. On Arch that assumption is FALSE:
//
//   1. A KDE-menu-launched app inherits the graphical session PATH, which has NO
//      `~/.local/bin` (verified: plasmashell's /proc/<pid>/environ →
//      `/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:...` only).
//   2. `bash -l` sources `~/.bash_profile`, which on Arch sources `~/.bashrc`.
//   3. Arch's stock `~/.bashrc` opens with `[[ $- != *i* ]] && return` — and `-c` is
//      NON-interactive, so it returns THERE.
//   4. The `export PATH="$HOME/.local/bin:$PATH"` line sits BELOW that guard, so it never
//      runs. `claude` (installed at `~/.local/bin/claude`) is not on PATH.
//   5. bash exits 127 → the pty dies instantly → the board shows "Terminal exited." with no
//      reason. It "works in dev" only because `npm run dev` inherits an INTERACTIVE PATH.
//
// So the shell can never be the thing that finds claude. Main resolves the binary itself and
// passes an absolute path; the `-l` wrapper is kept (it is load-bearing for pid correlation —
// claude must be a CHILD of the pty leader, see launchSession.ts F3).
//
// Pure over its seams (an injected `isExecutable` reader) so `main-unit` tests never touch
// the real filesystem — mirrors the ptyFactory/readStatusFromProc DI precedent (AR-11).

import type { EffortLevel, PermissionMode } from '../../shared/schemas/template'

/** Where a resolution came from — a CODE for logging (never the path value). */
export type ClaudeBinSource = 'override' | 'path' | 'wellKnown' | 'unresolved'

export interface ClaudeBinResolution {
  /** The command to put in the shell string. Absolute when resolved; bare `claude` when not
   *  (the unresolved fallback preserves the pre-fix behavior rather than failing the launch
   *  outright — a PATH we could not see may still work). */
  readonly command: string
  /** The directory holding the resolved binary, or null when unresolved. Prepended to the
   *  child PATH so claude's own subprocess lookups see its siblings. */
  readonly dir: string | null
  /** Resolution provenance — log this CODE, never `command` (a path leaks the operator's
   *  filesystem layout; see zod-boundaries.md never-log-the-value). */
  readonly source: ClaudeBinSource
}

export interface ResolveClaudeBinDeps {
  /** Is this absolute path an existing, executable file? Injected (real: fs.accessSync X_OK). */
  isExecutable(path: string): boolean
  /** The PATH to scan (the value the app itself inherited). */
  readonly path: string | undefined
  /** The operator's home dir (real: os.homedir()). */
  readonly home: string
  /** Explicit operator escape hatch — `CLAUDE_WATCHER_CLAUDE_BIN`. Wins over everything when
   *  it is executable; when set-but-not-executable we log a code and fall through. */
  readonly override?: string | undefined
}

/** Directory separator handling is POSIX-only by design — the launch path is Linux/KDE
 *  (win32 takes the plain-shell path and never composes this command). */
function join(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
}

function dirnameOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

/**
 * Resolve `claude` to an absolute path. Order: explicit override → a scan of the inherited
 * PATH → the well-known user-local install locations the official installer uses → give up
 * and return bare `claude` (unchanged pre-fix behavior).
 *
 * The well-known list is what makes this fix work on a KDE-launched app: the app's own PATH
 * is the stripped graphical-session one, so the PATH scan misses, and `~/.local/bin/claude`
 * (the official Linux installer's target) is the entry that lands.
 *
 * Pure over `isExecutable`; never throws.
 */
export function resolveClaudeBin(deps: ResolveClaudeBinDeps): ClaudeBinResolution {
  const { isExecutable, path, home, override } = deps

  // 1. Operator override — absolute wins, so a non-standard install is always reachable.
  if (override !== undefined && override !== '') {
    if (isExecutable(override)) {
      return { command: override, dir: dirnameOf(override), source: 'override' }
    }
    // Set but unusable: fall through to the normal search rather than hard-failing.
  }

  // 2. The inherited PATH. Empty segments mean "cwd" in POSIX PATH semantics — skipped
  //    deliberately (a cwd-relative `claude` is not something we want to launch).
  for (const seg of (path ?? '').split(':')) {
    if (seg === '') continue
    const candidate = join(seg, 'claude')
    if (isExecutable(candidate)) {
      return { command: candidate, dir: seg, source: 'path' }
    }
  }

  // 3. Well-known install locations, most-specific first. `~/.local/bin/claude` is the
  //    official installer's target; `~/.claude/local/claude` is the older local-install
  //    layout; the system dirs cover a packaged/global install.
  const wellKnown = [
    join(join(home, '.local'), 'bin/claude'),
    join(join(home, '.claude'), 'local/claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude'
  ]
  for (const candidate of wellKnown) {
    if (isExecutable(candidate)) {
      return { command: candidate, dir: dirnameOf(candidate), source: 'wellKnown' }
    }
  }

  // 4. Unresolved — keep the pre-fix bare command so a PATH we could not observe still works.
  return { command: 'claude', dir: null, source: 'unresolved' }
}

/**
 * Single-quote a string for POSIX `sh -c`. The resolved path is interpolated into a command
 * STRING, so a home dir containing a space (or a quote) must not split the command or escape
 * the quoting. `'` is closed, escaped, and reopened — the standard POSIX-safe form.
 */
export function shellQuote(s: string): string {
  return `'${s.split("'").join(`'\\''`)}'`
}

/**
 * Deterministic-attention (spec DA-4) — the question-format nudge injected into every
 * APP-LAUNCHED claude (probe-verified on claude ≥2.1.245: --append-system-prompt is
 * accepted interactively and MERGES with the default prompt). Scoped exactly like the
 * --settings hooks file: zero footprint, app-launched sessions only. It raises how often
 * the DETERMINISTIC signals fire (AskUserQuestion PreToolUse / a `?` tail on Stop); the
 * board is already correct without it (YourTurn floor). Re-verify this flag whenever the
 * claude version floor is bumped (alongside --session-id / -n / --settings).
 */
export const QUESTION_FORMAT_PROMPT =
  'When you need information or a decision from the user, prefer the AskUserQuestion tool. ' +
  'When you instead ask in prose, end the question paragraph with a question mark as the last character.'

/** Everything that becomes a claude CLI flag. Every optional flag is REQUIRED-and-nullable so
 *  each call site decides explicitly; `null` (or '') omits the flag — never a bare flag that
 *  would eat the next argument. */
export interface ClaudeCommandSpec {
  claudeCommand: string
  sessionId: string
  displayName: string
  hookSettingsPath: string | null
  appendSystemPrompt: string | null
  /** Session templates: `--model <alias|full name>`. */
  model: string | null
  /** Session templates: `--permission-mode <mode>`. */
  permissionMode: PermissionMode | null
  /** Session templates: `--effort <low|medium|high|xhigh|max>`. Verified on claude 2.1.261
   *  (`claude --help`); present since ≲2.1.72, so below the 2.1.245 floor. An UNKNOWN VALUE is
   *  soft — claude warns on stderr and uses its default — but an unknown FLAG is fatal, which
   *  is what the version gate is for. */
  effort: EffortLevel | null
  /** Programmatic API: the template's initial prompt with its params filled, or null. Appended
   *  LAST as the positional `[prompt]` argument — seen in `claude --help` on 2.1.272, probed
   *  end-to-end on 2.1.273 (an interactive session submitted the prompt with `--session-id` /
   *  `-n` / `--effort` present) — so claude starts interactive AND submits it. `null` / ''
   *  appends nothing, so every existing command composes byte-identical. Shell-quoted: the
   *  template's prose is written in-app by a human, but the `$n` params filled into it come
   *  from an HTTP caller (regex- and length-constrained upstream), so the composed value is
   *  PARTLY caller-supplied and this quoting is the last line of defence. */
  initialPrompt: string | null
}

function flagArg(flag: string, value: string | null): string {
  return value !== null && value.length > 0 ? ` ${flag} ${shellQuote(value)}` : ''
}

/**
 * Compose the `$SHELL -l -c "<this>"` command string that launches claude for ONE spawn.
 *
 * Lives HERE, not inlined at the `rawClaudeSpawn` call site, because no test can import
 * `index.ts` — an inlined composition is unfalsifiable, which is exactly how the repo has
 * lost guards before (see spec-session-naming.md's KEEP note on `launchSynthesis.ts`).
 *
 * Both interpolated values are shell-quoted, and that quoting is load-bearing for DIFFERENT
 * reasons:
 *   - `claudeCommand` — an operator's home dir may contain a space.
 *   - `displayName` — `SessionNameSchema` bans control characters but ALLOWS an apostrophe,
 *     so an un-quoted `it's mine` would terminate the quoting and split the command apart.
 *     This is operator-supplied text reaching a shell; treat it as hostile.
 *
 * The session id is a crypto `randomUUID()` (hex + dashes), so quoting it is belt-and-
 * braces — but the string still passes through a shell and must not rely on that.
 *
 * `displayName` becomes claude's `-n <name>`, so claude adopts the operator's name for its
 * own session and `claude --resume` / the `/resume` picker agree with the board card. An
 * empty name is skipped rather than emitting a bare `-n` (unreachable through the IPC
 * boundary, which enforces `min(1)`, but a bare flag would eat the next argument).
 *
 * `hookSettingsPath` becomes `--settings <path>` — the ZERO-FOOTPRINT hook delivery that
 * replaced merging a hook block into the launched project's `.claude/settings.local.json`.
 * The hooks then scope to EXACTLY the sessions this app spawns; a plain `claude` in the same
 * folder stays silent (probe-verified, claude 2.1.245). It is REQUIRED and nullable rather
 * than optional so every call site must decide: `null` omits the flag, which is the fail-soft
 * path when the settings file could not be written (the session still spawns — it just
 * reports no status). Shell-quoted like the rest: the app's data dir is not guaranteed to be
 * free of spaces.
 *
 * `appendSystemPrompt` becomes `--append-system-prompt <text>` — the deterministic-attention
 * question-format nudge (`QUESTION_FORMAT_PROMPT`), probe-verified GO on claude ≥2.1.245
 * (accepted interactively, MERGES with the default system prompt rather than replacing it).
 * REQUIRED and nullable for the same reason as `hookSettingsPath`: every call site must
 * decide, and `null` omits the flag entirely (fail-soft — the session still spawns without
 * the nudge). Shell-quoted: the prompt text is not guaranteed free of shell metacharacters.
 *
 * `model` / `permissionMode` / `effort` become `--model <alias|full name>` /
 * `--permission-mode <mode>` / `--effort <level>` — session templates (folder + model +
 * permission mode + thinking effort). Same REQUIRED-and-nullable contract: `null` (or an empty
 * `model` string) omits the flag entirely rather than emitting a bare one. `--effort` is
 * appended LAST so a template with no effort composes a byte-identical command to the
 * pre-effort one — that is what the folder-flow no-regression test asserts.
 *
 * `initialPrompt` (programmatic API) is NOT a flag: it is claude's positional `[prompt]`
 * argument, so it goes after every flag — `claude [options] [prompt]` — and claude starts
 * interactive AND submits it. Same REQUIRED-and-nullable contract; `null` (or '') appends
 * nothing, so every launch that does not carry a prompt composes byte-identically to before.
 * Shell-quoted for the same reason as `displayName`, only more so: the template's prose is
 * written in-app by a human, but the `$n` params filled into it are supplied by an HTTP caller
 * (regex- and length-constrained upstream), so the composed value is PARTLY caller-supplied and
 * `shellQuote` is the last line of defence — which is what the real-shell argv test pins.
 */
export function composeClaudeCommand(spec: ClaudeCommandSpec): string {
  const prompt =
    spec.initialPrompt !== null && spec.initialPrompt.length > 0
      ? ` ${shellQuote(spec.initialPrompt)}`
      : ''
  return (
    `${shellQuote(spec.claudeCommand)} --session-id '${spec.sessionId}'` +
    flagArg('-n', spec.displayName) +
    flagArg('--settings', spec.hookSettingsPath) +
    flagArg('--append-system-prompt', spec.appendSystemPrompt) +
    flagArg('--model', spec.model) +
    flagArg('--permission-mode', spec.permissionMode) +
    flagArg('--effort', spec.effort) +
    prompt
  )
}

/**
 * Prepend `dir` to a PATH value, without duplicating it. Gives claude's OWN subprocesses
 * (its Bash tool, any sibling helper) the same lookup the operator gets in a terminal —
 * under a KDE-launched app they would otherwise inherit the stripped session PATH.
 */
export function prependToPath(dir: string | null, path: string | undefined): string | undefined {
  if (dir === null) return path
  if (path === undefined || path === '') return dir
  if (path.split(':').includes(dir)) return path
  return `${dir}:${path}`
}
