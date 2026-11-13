// Reads what is new in a session's transcript for memory (memory phase 2): whole lines from a byte
// offset, within a byte cap. claude is still appending to the file while this reads it, so only
// bytes up to a line break are ever consumed: a half-written last line is read again next time.
//
// The file is claude's, not ours, and every odd state of it ends in a defined answer: missing or
// unreadable → null; shorter than the offset → null; a line that is not JSON or fails the shared
// schema → skipped; a line longer than the cap → read past in steps and skipped whole, never
// buffered; bytes that are not UTF-8 → replacement characters (offsets stay byte offsets); a file
// that grows meanwhile → read up to the size seen first, the rest next time; one that shrinks →
// read up to where the bytes end.
//
// SENSITIVE: a line holds the operator's conversation. Nothing here logs, not a value, not a path.
// [.claude/rules/zod-boundaries.md]
import { open, stat } from 'node:fs/promises'
import { EXTRACT_LIMITS } from '../../../shared/schemas/memoryExtract'
import {
  TranscriptEntrySchema,
  type TranscriptEntry
} from '../../../shared/schemas/transcriptEntry'

export interface TranscriptFs {
  size(path: string): Promise<number>
  read(path: string, offset: number, length: number): Promise<Buffer>
}

export const transcriptFsOnDisk: TranscriptFs = {
  size: async (path) => (await stat(path)).size,
  read: async (path, offset, length) => {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }
}

/** `end` = the byte offset just after this line's line break. */
export interface ReadLine {
  entry: TranscriptEntry
  end: number
}

export interface TranscriptSlice {
  lines: ReadLine[]
  nextOffset: number
  more: boolean
}

const NEWLINE = 0x0a

const isByteCount = (n: number, min: number): boolean => Number.isSafeInteger(n) && n >= min

function parseLine(bytes: Buffer): TranscriptEntry | null {
  let raw: unknown
  try {
    raw = JSON.parse(bytes.toString('utf8'))
  } catch {
    return null // not JSON (an empty line included): skipped, by design never logged
  }
  const parsed = TranscriptEntrySchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

const nextTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Whole lines from `fromOffset`, at most `maxBytes`, read in EXTRACT_LIMITS.readStepBytes steps with a
 *  yield to the event loop between steps. A line that is not JSON or fails the schema is skipped (its
 *  bytes count against `maxBytes`). The bytes after the last line break are not consumed. A single line
 *  longer than `maxBytes` is skipped whole (read past, never kept, not counted). `more` = the file has
 *  unread whole lines left. null: the file cannot be read, it is shorter than `fromOffset`, or the offset
 *  or the cap is not a whole number of bytes (the cap at least 1). Never throws, never logs. */
export async function readTranscriptSlice(
  fs: TranscriptFs,
  path: string,
  fromOffset: number,
  maxBytes: number
): Promise<TranscriptSlice | null> {
  if (!isByteCount(fromOffset, 0) || !isByteCount(maxBytes, 1)) return null
  let size: number
  try {
    size = await fs.size(path)
  } catch {
    return null // missing or unreadable: the caller tells null from every slice
  }
  if (size < fromOffset) return null

  const lines: ReadLine[] = []
  let used = 0
  let nextOffset = fromOffset
  // The bytes of the line being read, held only while it can still fit the cap: a longer line is
  // read past, never held whole.
  let parts: Buffer[] = []
  let pos = fromOffset

  while (pos < size) {
    if (pos > fromOffset) await nextTick()
    let chunk: Buffer
    try {
      chunk = await fs.read(path, pos, Math.min(EXTRACT_LIMITS.readStepBytes, size - pos))
    } catch {
      return null // unreadable mid-way: the caller tells null from every slice
    }
    if (chunk.length === 0) break // the file shrank: stop at the bytes there are
    let from = 0
    while (from < chunk.length) {
      const nl = chunk.indexOf(NEWLINE, from)
      if (nl === -1) {
        if (pos + chunk.length - nextOffset <= maxBytes) parts.push(chunk.subarray(from))
        else parts = []
        break
      }
      const end = pos + nl + 1
      const lineBytes = end - nextOffset
      if (lineBytes <= maxBytes) {
        if (used + lineBytes > maxBytes) return { lines, nextOffset, more: true }
        used += lineBytes
        const entry = parseLine(Buffer.concat([...parts, chunk.subarray(from, nl)]))
        if (entry !== null) lines.push({ entry, end })
      }
      nextOffset = end
      parts = []
      from = nl + 1
    }
    pos += chunk.length
  }
  return { lines, nextOffset, more: false }
}
