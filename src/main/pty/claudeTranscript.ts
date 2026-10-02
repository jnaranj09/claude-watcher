// Does claude still have a session's conversation? (UX-08, NEW-5 in docs/reports/2026-09-23-bug-hunt)
//
// claude writes `<configDir>/projects/<encoded cwd>/<id>.jsonl` on the FIRST prompt, not at
// startup, and names the path in its hooks only from then on (drive run 2026-09-30, claude
// 2.1.285). So a record often has no `transcriptPath`: a session archived before its first prompt,
// or one that exited on claude's own folder-trust screen. Then the lookup scans every
// `projects/*` folder for `<id>.jsonl` — no guess at claude's folder-name encoding. A known path
// that is gone falls back to the same scan: the path came from a hook POST, which anyone on the
// machine can send, so it alone never proves the conversation is gone.
//
// It FAILS OPEN: only a clean "not found" counts as missing. An unlistable projects folder, a
// read error other than ENOENT/ENOTDIR, or an id that is not a UUID answers `true` — a wrong
// `false` drops a record or refuses an Open claude could have served. Never throws, never logs a
// path.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CLAUDE_SESSION_ID_PATTERN } from '../../shared/schemas/pastSession'
import { claudeConfigDir } from './claudeSessionFile'

/** `missing` only for a clean not-found; any other failure is `unknown`. */
export type FileState = 'file' | 'missing' | 'unknown'

export interface TranscriptLookupDeps {
  projectsDir: string
  /** Throws when the folder cannot be listed. */
  listDir(dir: string): string[]
  /** Never throws. */
  fileState(path: string): FileState
}

/** True unless claude surely has no transcript for `sessionId`. */
export type HasTranscript = (sessionId: string, knownPath: string | undefined) => boolean

/** Where claude keeps a session's transcript. `unknown` = could not tell (non-UUID id, unlistable
 *  projects folder, an unreadable candidate): the caller decides which way that fails. */
export type TranscriptLocation =
  | { kind: 'found'; path: string }
  | { kind: 'missing' }
  | { kind: 'unknown' }

/** Scan every `projects/*` folder for `<id>.jsonl` — no guess at claude's folder-name encoding.
 *  Never throws, never logs a path. Builds a path only from a UUID id. */
export function locateTranscript(
  deps: TranscriptLookupDeps,
  sessionId: string
): TranscriptLocation {
  if (!CLAUDE_SESSION_ID_PATTERN.test(sessionId)) return { kind: 'unknown' }
  let folders: string[]
  try {
    folders = deps.listDir(deps.projectsDir)
  } catch {
    return { kind: 'unknown' }
  }
  const file = `${sessionId}.jsonl`
  let unsure = false
  for (const folder of folders) {
    const path = join(deps.projectsDir, folder, file)
    const state = deps.fileState(path)
    if (state === 'file') return { kind: 'found', path }
    if (state === 'unknown') unsure = true
  }
  return unsure ? { kind: 'unknown' } : { kind: 'missing' }
}

export function createTranscriptLookup(deps: TranscriptLookupDeps): HasTranscript {
  return (sessionId, knownPath) => {
    if (knownPath !== undefined && deps.fileState(knownPath) !== 'missing') return true
    return locateTranscript(deps, sessionId).kind !== 'missing'
  }
}

export function fileStateOnDisk(path: string): FileState {
  try {
    return statSync(path).isFile() ? 'file' : 'missing'
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unknown'
  }
}

/** The real fs under claude's config folder (`CLAUDE_CONFIG_DIR` or `~/.claude`, read from THIS
 *  process's env — a login-profile-only override is not seen; see the hooks-listening gate on the
 *  archive side in index.ts). Shared by the Open check and the Resume-by-id reader. */
export function transcriptLookupDepsFromFs(
  env: NodeJS.ProcessEnv = process.env
): TranscriptLookupDeps {
  return {
    projectsDir: join(claudeConfigDir(env), 'projects'),
    listDir: (dir) => readdirSync(dir),
    fileState: fileStateOnDisk
  }
}

export function createTranscriptLookupFromFs(env: NodeJS.ProcessEnv = process.env): HasTranscript {
  return createTranscriptLookup(transcriptLookupDepsFromFs(env))
}

/**
 * The past-sessions store's check — the one that DELETES a record (NEW-5), so it is stricter than
 * Open's. With no known path it trusts the scan only while THIS app's hook server is bound: then
 * claude's first prompt would have named the path, so "no path" really means "no prompt". Without
 * the hooks (SEC-6: port taken, server error) every session has no path, and a `CLAUDE_CONFIG_DIR`
 * set only in the login profile — which claude sees and this process does not — would make the
 * scan look in the wrong folder and drop real conversations. Then the record is kept.
 */
export function archiveTranscriptCheck(
  lookup: HasTranscript,
  hooksListening: () => boolean
): HasTranscript {
  return (sessionId, knownPath) =>
    knownPath === undefined && !hooksListening() ? true : lookup(sessionId, knownPath)
}
