// Past sessions (D-1) — the "can this record be reopened, and as what launch?" decision,
// extracted (the launchMint.ts / launchRemoval.ts precedent) so it is unit-testable without
// Electron. index.ts binds it to CH.pastSessionOpen with the real store, fs, reducer and launch
// service. NEVER log the record's cwd or name — the outcome carries a CODE the dialog maps to copy.
import {
  PastSessionOpenSchema,
  PastSessionResumeTerminalSchema,
  type PastSession
} from '../../shared/schemas/pastSession'
import { NO_LAUNCH_FLAGS, type LaunchRequest } from './launchSession'

export type PastSessionOpenCode =
  | 'not_found'
  | 'folder_missing'
  | 'already_open'
  | 'transcript_missing'

export interface PastSessionOpenDeps {
  get(id: string): PastSession | null
  /** Production: `statSync(path).isDirectory()` inside a try (a missing path is `false`). */
  isDirectory(path: string): boolean
  /** True when any window's board still shows this id (the renderer then focuses the live card). */
  isLive(sessionId: string): boolean
  /** Production: `statSync(path).isFile()` inside a try (a missing path is `false`). */
  transcriptExists(path: string): boolean
  /** A tag deleted since the archive is dropped from the resumed card (spec: surviving tags only). */
  tagExists(tagId: string): boolean
  launch(req: LaunchRequest): { terminalId: string }
}

// The record is NOT removed on Open (UX-02). It used to be, "the next archive writes it again" —
// and after a crash there is no next archive, so the record was lost for good. It stays: the
// resumed card's live record overwrites it by id (livePastSessions.ts), which hides it from the
// dialog while the card is up, and `already_open` still stops a second Open.

export type PastSessionOpenOutcome =
  | { ok: true; terminalId: string; workspaceId: string; name: string }
  | { ok: false; code: PastSessionOpenCode }

export function openPastSession(raw: unknown, deps: PastSessionOpenDeps): PastSessionOpenOutcome {
  const { id } = PastSessionOpenSchema.parse(raw)
  const record = deps.get(id)
  if (record === null) return { ok: false, code: 'not_found' }
  if (!deps.isDirectory(record.cwd)) return { ok: false, code: 'folder_missing' }
  if (deps.isLive(id)) return { ok: false, code: 'already_open' }
  // UX-08 — claude cleaned its history, or the session ended before claude wrote a transcript.
  // `claude --resume` would print "no conversation found" and exit, and that exit archived the
  // record again as the newest one: a loop. Refuse, and the dialog points at Forget.
  if (record.transcriptPath !== undefined && !deps.transcriptExists(record.transcriptPath)) {
    return { ok: false, code: 'transcript_missing' }
  }
  const { terminalId } = deps.launch({
    cwd: record.cwd,
    name: record.name,
    workspaceId: record.workspaceId,
    resumeSessionId: id,
    tagIds: record.tagIds.filter((tagId) => deps.tagExists(tagId)),
    flags: NO_LAUNCH_FLAGS
  })
  return { ok: true, terminalId, workspaceId: record.workspaceId, name: record.name }
}

export interface ResumeTerminalDeps extends PastSessionOpenDeps {
  /** The id the terminal LAST ran — the launch override's `lastSessionId` (moved by `/clear`), or
   *  null for a terminal the launch service never saw (a plain shell). */
  lastSessionIdFor(terminalId: string): string | null
  /** True while the terminal's pty is still running: only a DEAD pane resumes. */
  isTerminalLive(terminalId: string): boolean
}

/**
 * UX-10 — the dead pane's Resume. Only the TERMINAL id crosses the seam (the renderer's binding
 * died with the card); the session id comes from main's own launch record, and the resume then
 * runs through `openPastSession` — the same record, folder, live and transcript checks, the same
 * recipe. The renderer opens the new terminal and drops the dead pane (Resume replaces it).
 */
export function resumeTerminalSession(
  raw: unknown,
  deps: ResumeTerminalDeps
): PastSessionOpenOutcome {
  const { terminalId } = PastSessionResumeTerminalSchema.parse(raw)
  if (deps.isTerminalLive(terminalId)) return { ok: false, code: 'already_open' }
  const id = deps.lastSessionIdFor(terminalId)
  if (id === null) return { ok: false, code: 'not_found' }
  return openPastSession({ id }, deps)
}
