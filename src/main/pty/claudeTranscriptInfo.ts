// Resume by id — the folder and the name of a claude session the app did not launch, read from
// claude's own transcript (`<configDir>/projects/*/<id>.jsonl`). A fail-CLOSED boundary
// (zod-boundaries.md): without a trusted absolute folder there is nothing safe to launch, so any
// doubt answers `null` and the Open refuses `transcript_missing`. Unlike `hasTranscript`, which
// fails OPEN because a wrong `false` there drops a record.
//
// Reads at most 16 MiB from the START of the file: `cwd` is on the first user line, and claude
// writes title lines near the top (re-appended on a rename). A title past the cap falls back to
// the folder name — the card is renamed on the operator's next `/rename`. A cut last line is just
// a bad line. Never logs the id, path, cwd or title — codes only.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { TranscriptInfoLineSchema } from '../../shared/schemas/transcriptInfo'
import { locateTranscript, transcriptLookupDepsFromFs } from './claudeTranscript'

const LOG_PREFIX = '[claude-watcher][transcript-info]'
export const TRANSCRIPT_INFO_MAX_BYTES = 16 * 1024 * 1024

export interface TranscriptInfo {
  /** Absolute; the launch still checks it is a directory (`folder_missing`). */
  cwd: string
  /** The last `custom-title` (a `/rename`), else the last `ai-title`, else null. Raw: the caller
   *  cleans it into a session name. */
  title: string | null
}

export type ReadTranscriptInfo = (sessionId: string) => TranscriptInfo | null

export interface TranscriptInfoDeps {
  /** The transcript path, or null when it is not found (or that could not be told). */
  locate(sessionId: string): string | null
  /** At most `maxBytes` from the start, as UTF-8. Throws when the file cannot be read. */
  readHead(path: string, maxBytes: number): string
}

export function parseTranscriptInfo(text: string): TranscriptInfo | null {
  let cwd: string | null = null
  let customTitle: string | null = null
  let aiTitle: string | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      continue // a bad or cut line is skipped, never fatal
    }
    const parsed = TranscriptInfoLineSchema.safeParse(json)
    if (!parsed.success) continue
    const entry = parsed.data
    if (cwd === null && entry.cwd !== undefined && isAbsolute(entry.cwd)) cwd = entry.cwd
    if (entry.type === 'custom-title' && entry.customTitle !== undefined) {
      customTitle = entry.customTitle
    }
    if (entry.type === 'ai-title' && entry.aiTitle !== undefined) aiTitle = entry.aiTitle
  }
  if (cwd === null) return null
  return { cwd, title: customTitle ?? aiTitle }
}

export function createTranscriptInfoReader(deps: TranscriptInfoDeps): ReadTranscriptInfo {
  return (sessionId) => {
    const path = deps.locate(sessionId)
    if (path === null) return null
    let text: string
    try {
      text = deps.readHead(path, TRANSCRIPT_INFO_MAX_BYTES)
    } catch {
      console.warn(`${LOG_PREFIX} code=transcript_info_read_failed`)
      return null
    }
    const info = parseTranscriptInfo(text)
    if (info === null) console.warn(`${LOG_PREFIX} code=transcript_info_no_cwd`)
    return info
  }
}

/** Reads up to `maxBytes` from offset 0. Throws on open/read errors (the reader catches). */
export function readFileHead(path: string, maxBytes: number): string {
  const fd = openSync(path, 'r')
  try {
    const size = Math.min(fstatSync(fd).size, maxBytes)
    const buffer = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const n = readSync(fd, buffer, offset, size - offset, offset)
      if (n === 0) break
      offset += n
    }
    return buffer.toString('utf8', 0, offset)
  } finally {
    closeSync(fd)
  }
}

export function createTranscriptInfoReaderFromFs(
  env: NodeJS.ProcessEnv = process.env
): ReadTranscriptInfo {
  const lookup = transcriptLookupDepsFromFs(env)
  return createTranscriptInfoReader({
    locate: (sessionId) => {
      const at = locateTranscript(lookup, sessionId)
      return at.kind === 'found' ? at.path : null
    },
    readHead: readFileHead
  })
}
