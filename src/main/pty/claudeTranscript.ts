// Does claude still have a session's conversation? (UX-08, NEW-5 in docs/reports/2026-09-23-bug-hunt)
//
// claude writes `<configDir>/projects/<encoded cwd>/<id>.jsonl` on the FIRST prompt, not at
// startup, and names the path in its hooks only from then on (drive run 2026-09-30, claude
// 2.1.285). So a record often has no `transcriptPath`: a session archived before its first prompt,
// or one that exited on claude's own folder-trust screen. Without a path, the lookup scans every
// `projects/*` folder for `<id>.jsonl` — no guess at claude's folder-name encoding.
//
// It FAILS OPEN: an unlistable projects folder, or an id that is not a UUID, answers `true`. A
// wrong `false` would drop a record or refuse an Open that claude could have served. Never throws,
// never logs a path.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { claudeConfigDir } from './claudeSessionFile'

const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface TranscriptLookupDeps {
  projectsDir: string
  /** Throws when the folder cannot be listed. */
  listDir(dir: string): string[]
  /** False for a missing or unreadable path; never throws. */
  isFile(path: string): boolean
}

/** True unless claude surely has no transcript for `sessionId`. A known path is checked as is. */
export type HasTranscript = (sessionId: string, knownPath: string | undefined) => boolean

export function createTranscriptLookup(deps: TranscriptLookupDeps): HasTranscript {
  return (sessionId, knownPath) => {
    if (knownPath !== undefined) return deps.isFile(knownPath)
    if (!SESSION_UUID.test(sessionId)) return true
    let folders: string[]
    try {
      folders = deps.listDir(deps.projectsDir)
    } catch {
      return true
    }
    const file = `${sessionId}.jsonl`
    return folders.some((folder) => deps.isFile(join(deps.projectsDir, folder, file)))
  }
}

function isFileOnDisk(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** The production lookup over the real fs and claude's config folder. */
export function createTranscriptLookupFromFs(): HasTranscript {
  return createTranscriptLookup({
    projectsDir: join(claudeConfigDir(), 'projects'),
    listDir: (dir) => readdirSync(dir),
    isFile: isFileOnDisk
  })
}
