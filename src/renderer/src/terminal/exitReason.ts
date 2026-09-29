// UX-10 — the dead pane's two sentences, PURE: why the process stopped (its exit code or signal —
// state only, never pty content or a path) and a refused Resume mapped to copy (never the thrown
// message, which Electron wraps and a handler could fill with anything).

/** The signals a claude (or a shell) is usually stopped by. Anything else is named by number. */
const SIGNAL_NAMES: Readonly<Record<number, string>> = {
  1: 'SIGHUP',
  2: 'SIGINT',
  3: 'SIGQUIT',
  6: 'SIGABRT',
  9: 'SIGKILL',
  11: 'SIGSEGV',
  13: 'SIGPIPE',
  15: 'SIGTERM'
}

export interface ExitInfo {
  exitCode: number
  /** Set (≥ 1) only when a signal ended the process. */
  signal?: number
}

/** `who` is what the pane ran: `Claude` on the focused surface, `Terminal` for a plain shell. */
export function exitReasonCopy(who: 'Claude' | 'Terminal', exit: ExitInfo): string {
  if (exit.signal !== undefined && exit.signal > 0) {
    const name = SIGNAL_NAMES[exit.signal]
    return name === undefined
      ? `${who} was stopped by signal ${exit.signal}.`
      : `${who} was stopped by ${name} (signal ${exit.signal}).`
  }
  return `${who} exited with code ${exit.exitCode}.`
}

const RESUME_ERROR_COPY: Readonly<Record<string, string>> = {
  not_found: 'This conversation is no longer in Past sessions.',
  folder_missing: 'Its folder no longer exists.',
  already_open: 'This conversation is already open.',
  transcript_missing: 'Claude no longer has this conversation.',
  session_running_elsewhere:
    'This conversation is running in another terminal. Close it there first.'
}

/** Matched with `includes` (Electron wraps an invoke rejection — the `copyFor` precedent). */
export function resumeErrorCopy(err: unknown): string {
  const text = err instanceof Error ? err.message : ''
  for (const [code, copy] of Object.entries(RESUME_ERROR_COPY)) if (text.includes(code)) return copy
  return 'Could not resume the conversation.'
}
