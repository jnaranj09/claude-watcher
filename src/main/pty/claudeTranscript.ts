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
import { claudeConfigDir } from './claudeSessionFile'

const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

export function createTranscriptLookup(deps: TranscriptLookupDeps): HasTranscript {
  return (sessionId, knownPath) => {
    if (knownPath !== undefined && deps.fileState(knownPath) !== 'missing') return true
    if (!SESSION_UUID.test(sessionId)) return true
    let folders: string[]
    try {
      folders = deps.listDir(deps.projectsDir)
    } catch {
      return true
    }
    const file = `${sessionId}.jsonl`
    return folders.some(
      (folder) => deps.fileState(join(deps.projectsDir, folder, file)) !== 'missing'
    )
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

/** The production lookup over the real fs and claude's config folder (`CLAUDE_CONFIG_DIR` or
 *  `~/.claude`, read from THIS process's env — a login-profile-only override is not seen; see
 *  the hooks-listening gate on the archive side in index.ts). */
export function createTranscriptLookupFromFs(env: NodeJS.ProcessEnv = process.env): HasTranscript {
  return createTranscriptLookup({
    projectsDir: join(claudeConfigDir(env), 'projects'),
    listDir: (dir) => readdirSync(dir),
    fileState: fileStateOnDisk
  })
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
