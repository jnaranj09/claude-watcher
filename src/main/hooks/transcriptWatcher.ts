// Transcript watcher — the incremental JSONL tailer behind the two hook-invisible signals.
//
// Claude Code appends one JSON object per line to the transcript named by every hook
// payload's `transcript_path`. This module tails those files and hands each new line to
// `transcriptSignal`, which extracts the two facts no hook reports: the turn was
// interrupted, and a background task finished.
//
// THE FOUR THINGS THAT MAKE THIS SAFE:
//
//   1. START AT THE END. A transcript already holds the whole conversation, usually
//      including OLD interrupts. Replaying history on attach would instantly flip a
//      healthy working session to idle, so the initial offset is the file's CURRENT size.
//   2. ONLY COMPLETE LINES. Appends can land mid-line. A trailing fragment is buffered
//      until its newline arrives rather than being parsed as truncated JSON.
//   3. NEVER THROW, NEVER LOG. Every read, parse and callback is guarded. A transcript
//      line is the most sensitive input in the app — it holds the operator's entire
//      conversation — so nothing here is ever logged: not a value, not a parse error, not
//      the path (which embeds the project directory). A bad line is dropped in silence.
//   4. A POLL BESIDE THE WATCH. `fs.watch` is the fast path (inotify fires on append,
//      which is what makes the interrupt feel instant). It is not reliable everywhere —
//      it misses events on some filesystems and cannot see a file that does not exist
//      yet — so a low-frequency poll runs alongside it as a floor. Both funnel into the
//      same idempotent drain, so a doubled notification costs one wasted read.
//
// [.claude/rules/zod-boundaries.md; .claude/rules/state.md]

import { watch, statSync, type FSWatcher } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { transcriptSignal, type TranscriptSignalResult } from './transcriptSignal'

/** Poll interval (ms) backing up `fs.watch`. Slow on purpose: it is a floor for the rare
 *  missed inotify event, not the mechanism — the watch is what makes this feel instant. */
export const TRANSCRIPT_POLL_MS = 2000

interface WatchEntry {
  path: string
  /** Bytes already consumed. Starts at the file's size on attach (rule 1). */
  offset: number
  /** A trailing partial line awaiting its newline (rule 2). */
  partial: string
  watcher?: FSWatcher
  /** Guards against two drains overlapping (watch + poll can fire together). */
  draining: boolean
  /** Set once the entry is torn down, so an in-flight drain stops emitting. */
  closed: boolean
}

export interface TranscriptWatcherOptions {
  /** Called for every signal found. Never called with session content. */
  onSignal: (sessionId: string, signal: TranscriptSignalResult) => void
  /** Backup poll interval (ms). Tests pass a short one so the poll runs inside their
   *  settle window; production uses the default, `TRANSCRIPT_POLL_MS`. */
  pollMs?: number
}

export interface TranscriptWatcher {
  /** Start (or re-point) the tail for a session. Idempotent for the same path.
   *  Returns true only when this call ATTACHED a new tail, so the caller can log the
   *  attach once per session instead of on every hook event. */
  watch(sessionId: string, path: string): boolean
  /** Stop tailing one session. */
  unwatch(sessionId: string): void
  /** Stop everything — the owning window is going away. Idempotent. */
  dispose(): void
}

export function createTranscriptWatcher(options: TranscriptWatcherOptions): TranscriptWatcher {
  const { onSignal } = options
  const entries = new Map<string, WatchEntry>()
  let poll: ReturnType<typeof setInterval> | undefined

  /** Read everything appended since `offset` and emit any signals found. */
  async function drain(sessionId: string, entry: WatchEntry): Promise<void> {
    if (entry.draining || entry.closed) return
    entry.draining = true
    try {
      const info = await stat(entry.path)
      // A shorter file means it was replaced/truncated — resync rather than read garbage.
      if (info.size < entry.offset) {
        entry.offset = 0
        entry.partial = ''
      }
      if (info.size === entry.offset) return

      const handle = await open(entry.path, 'r')
      try {
        const length = info.size - entry.offset
        const buffer = Buffer.allocUnsafe(length)
        const { bytesRead } = await handle.read(buffer, 0, length, entry.offset)
        entry.offset += bytesRead

        const text = entry.partial + buffer.subarray(0, bytesRead).toString('utf8')
        const lines = text.split('\n')
        // The final element is whatever follows the last newline — hold it back (rule 2).
        entry.partial = lines.pop() ?? ''

        for (const line of lines) {
          if (entry.closed) return
          if (line.trim().length === 0) continue
          let parsed: unknown
          try {
            parsed = JSON.parse(line)
          } catch {
            continue // not JSON → drop in silence (rule 3)
          }
          const signal = transcriptSignal(parsed)
          if (signal !== null) {
            try {
              onSignal(sessionId, signal)
            } catch {
              /* a consumer fault must never take down the tail */
            }
          }
        }
      } finally {
        await handle.close()
      }
    } catch {
      // Missing file, permission error, races — all non-fatal. The poll retries.
    } finally {
      entry.draining = false
    }
  }

  function scheduleDrain(sessionId: string, entry: WatchEntry): void {
    void drain(sessionId, entry)
  }

  /** Attach `fs.watch` to the file, falling back to its DIRECTORY when the file does not
   *  exist yet (claude creates the transcript slightly after the session starts). */
  function attach(sessionId: string, entry: WatchEntry): void {
    const onChange = (): void => scheduleDrain(sessionId, entry)
    try {
      entry.watcher = watch(entry.path, onChange)
    } catch {
      try {
        entry.watcher = watch(dirname(entry.path), onChange)
      } catch {
        /* no watch available — the poll alone carries it (rule 4) */
      }
    }
    entry.watcher?.on('error', () => {
      entry.watcher?.close()
      delete entry.watcher
    })
  }

  function ensurePoll(): void {
    if (poll !== undefined) return
    poll = setInterval(() => {
      for (const [sessionId, entry] of entries) {
        // A file that appeared after attach needs its watch upgraded from the directory.
        if (entry.watcher === undefined) attach(sessionId, entry)
        scheduleDrain(sessionId, entry)
      }
    }, options.pollMs ?? TRANSCRIPT_POLL_MS)
    poll.unref?.()
  }

  function teardown(entry: WatchEntry): void {
    entry.closed = true
    try {
      entry.watcher?.close()
    } catch {
      /* the watcher is already closed; teardown only needs it gone */
    }
    delete entry.watcher
  }

  return {
    watch(sessionId, path) {
      const existing = entries.get(sessionId)
      if (existing !== undefined) {
        if (existing.path === path) return false // idempotent — no double-report
        teardown(existing)
      }
      // Seek to the end SYNCHRONOUSLY, before this call returns. Doing it asynchronously
      // races the very first append: the stat would land after the write and the initial
      // offset would swallow the line we were waiting for.
      let startOffset = 0
      try {
        startOffset = statSync(path).size // rule 1 — never replay history
      } catch {
        /* not created yet → 0 is correct, there is nothing to skip */
      }
      const entry: WatchEntry = {
        path,
        offset: startOffset,
        partial: '',
        draining: false,
        closed: false
      }
      entries.set(sessionId, entry)
      attach(sessionId, entry)
      ensurePoll()
      return true
    },

    unwatch(sessionId) {
      const entry = entries.get(sessionId)
      if (entry === undefined) return
      teardown(entry)
      entries.delete(sessionId)
    },

    dispose() {
      for (const entry of entries.values()) teardown(entry)
      entries.clear()
      if (poll !== undefined) {
        clearInterval(poll)
        poll = undefined
      }
    }
  }
}
