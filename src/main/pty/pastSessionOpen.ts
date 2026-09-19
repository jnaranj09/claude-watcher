// Past sessions (D-1) — the "can this record be reopened, and as what launch?" decision,
// extracted (the launchMint.ts / launchRemoval.ts precedent) so it is unit-testable without
// Electron. index.ts binds it to CH.pastSessionOpen with the real store, fs, reducer and launch
// service. NEVER log the record's cwd or name — the outcome carries a CODE the dialog maps to copy.
import { PastSessionOpenSchema, type PastSession } from '../../shared/schemas/pastSession'
import { NO_LAUNCH_FLAGS, type LaunchRequest } from './launchSession'

export type PastSessionOpenCode = 'not_found' | 'folder_missing' | 'already_open'

export interface PastSessionOpenDeps {
  get(id: string): PastSession | null
  /** Production: `statSync(path).isDirectory()` inside a try (a missing path is `false`). */
  isDirectory(path: string): boolean
  /** True when any window's board still shows this id (the renderer then focuses the live card). */
  isLive(sessionId: string): boolean
  /** A tag deleted since the archive is dropped from the resumed card (spec: surviving tags only). */
  tagExists(tagId: string): boolean
  launch(req: LaunchRequest): { terminalId: string }
  /** The record leaves the history while the session is live; the next archive writes it again. */
  remove(id: string): void
}

export type PastSessionOpenOutcome =
  | { ok: true; terminalId: string; workspaceId: string; name: string }
  | { ok: false; code: PastSessionOpenCode }

export function openPastSession(raw: unknown, deps: PastSessionOpenDeps): PastSessionOpenOutcome {
  const { id } = PastSessionOpenSchema.parse(raw)
  const record = deps.get(id)
  if (record === null) return { ok: false, code: 'not_found' }
  if (!deps.isDirectory(record.cwd)) return { ok: false, code: 'folder_missing' }
  if (deps.isLive(id)) return { ok: false, code: 'already_open' }
  const { terminalId } = deps.launch({
    cwd: record.cwd,
    name: record.name,
    workspaceId: record.workspaceId,
    resumeSessionId: id,
    tagIds: record.tagIds.filter((tagId) => deps.tagExists(tagId)),
    flags: NO_LAUNCH_FLAGS
  })
  deps.remove(id)
  return { ok: true, terminalId, workspaceId: record.workspaceId, name: record.name }
}
