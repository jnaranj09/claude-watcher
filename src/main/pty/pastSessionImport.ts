// Resume by id — bring a claude session the app did NOT launch onto the board. The decision is
// extracted (the pastSessionOpen.ts precedent) so it is unit-testable without Electron; the IPC
// handler binds the real seams. Only `{ id, workspaceId }` crosses: the folder and the name come
// from claude's transcript (claudeTranscriptInfo.ts), never from the renderer. An id the app
// already has a record for is a normal Open — one resume path per record. NEVER log the id, the
// folder or the name: the outcome carries a CODE the dialog maps to copy.
import { basename } from 'node:path'
import { PastSessionImportSchema } from '../../shared/schemas/pastSession'
import { SESSION_NAME_MAX_LENGTH, SessionNameSchema } from '../../shared/schemas/launch'
import type { PastSessionOpenResult } from '../../shared/ipc/contract'
import { requireClaudeVersion } from './inAppLaunch'
import { NO_LAUNCH_FLAGS } from './launchSession'
import {
  openPastSession,
  type PastSessionOpenCode,
  type PastSessionOpenDeps
} from './pastSessionOpen'
import type { ReadTranscriptInfo } from './claudeTranscriptInfo'

export type PastSessionImportCode = PastSessionOpenCode | 'invalid_id' | 'workspace_not_found'

export interface PastSessionImportDeps extends PastSessionOpenDeps {
  /** The workspace the renderer sent (its ACTIVE one) still exists in main's store. */
  workspaceExists(workspaceId: string): boolean
  readTranscriptInfo: ReadTranscriptInfo
}

export type PastSessionImportOutcome =
  | { ok: true; terminalId: string; workspaceId: string; name: string }
  | { ok: false; code: PastSessionImportCode }

/** Used only when neither the title nor the folder makes a valid session name. */
export const IMPORTED_SESSION_FALLBACK_NAME = 'claude session'

/** claude's title is free text: cut it to the session-name cap and run the same schema every
 *  launch name passes; a title it rejects (a control character) falls back to the folder name. */
export function importedSessionName(title: string | null, cwd: string): string {
  for (const candidate of [title, basename(cwd)]) {
    if (candidate === null) continue
    const named = SessionNameSchema.safeParse(candidate.trim().slice(0, SESSION_NAME_MAX_LENGTH))
    if (named.success) return named.data
  }
  return IMPORTED_SESSION_FALLBACK_NAME
}

export function importPastSession(
  raw: unknown,
  deps: PastSessionImportDeps
): PastSessionImportOutcome {
  const parsed = PastSessionImportSchema.safeParse(raw)
  if (!parsed.success) {
    // A bad id is the operator's paste: copy. Anything else is a renderer bug: throw (the IPC
    // boundary's parse-and-throw), and the dialog shows the generic line.
    if (parsed.error.issues.some((issue) => issue.path[0] === 'id')) {
      return { ok: false, code: 'invalid_id' }
    }
    throw new Error('invalid_request')
  }
  const { id, workspaceId } = parsed.data
  // A listed or live record (a hidden one answers null and is imported into the active
  // workspace; its new live record overwrites it by id).
  if (deps.get(id) !== null) return openPastSession({ id }, deps)
  if (!deps.workspaceExists(workspaceId)) return { ok: false, code: 'workspace_not_found' }
  if (deps.isLive(id)) return { ok: false, code: 'already_open' }
  // UX-14 — still open in Konsole or another tool. The app never stops a process it did not
  // launch; the operator closes it there first.
  if (deps.runningElsewhere(id)) return { ok: false, code: 'session_running_elsewhere' }
  const info = deps.readTranscriptInfo(id)
  if (info === null) return { ok: false, code: 'transcript_missing' }
  if (!deps.isDirectory(info.cwd)) return { ok: false, code: 'folder_missing' }
  const name = importedSessionName(info.title, info.cwd)
  const { terminalId } = deps.launch({
    cwd: info.cwd,
    name,
    workspaceId,
    resumeSessionId: id,
    tagIds: [],
    flags: NO_LAUNCH_FLAGS
  })
  return { ok: true, terminalId, workspaceId, name }
}

export interface PastSessionImportHandlerDeps extends Omit<
  PastSessionImportDeps,
  'workspaceExists'
> {
  /** The claude version gate (`requireClaudeVersion`): a too-old claude rejects `--resume`. */
  allowsLaunch: () => boolean
  /** Main's workspace store — the ONLY judge of whether the renderer's workspace exists. */
  workspaces: { get(id: string): unknown }
}

/** The `CH.pastSessionImport` handler body (registerLaunchIpc binds the real seams): the version
 *  gate, then the decision. A refusal THROWS its code; the dialog maps it to copy. */
export function handlePastSessionImport(
  raw: unknown,
  deps: PastSessionImportHandlerDeps
): PastSessionOpenResult {
  requireClaudeVersion(deps.allowsLaunch)
  const out = importPastSession(raw, {
    ...deps,
    workspaceExists: (id) => deps.workspaces.get(id) !== null
  })
  if (!out.ok) throw new Error(out.code)
  return { terminalId: out.terminalId, workspaceId: out.workspaceId, name: out.name }
}
