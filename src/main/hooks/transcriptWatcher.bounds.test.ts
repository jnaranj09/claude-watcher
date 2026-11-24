// Security audit finding `transcriptWatcher.ts:drain:unbounded-read`: the tailed path comes from
// a hook payload (`transcript_path`), so the file can be huge. Fault: a drain that allocates the
// whole unread size at once, or holds an endless line in memory.
import { appendFileSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTranscriptWatcher,
  TRANSCRIPT_MAX_DRAIN_BYTES,
  type TranscriptWatcher
} from './transcriptWatcher'

const INTERRUPT = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }
})

let dir = ''
let watcher: TranscriptWatcher
let signals: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tw-bounds-'))
  signals = []
  watcher = createTranscriptWatcher({
    pollMs: 25,
    onSignal: (_id, signal) => signals.push(signal.kind)
  })
})

afterEach(() => {
  watcher.dispose()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('transcript tail on a huge file', () => {
  it('a 64 MiB growth is read in chunks no larger than the cap, and the next line still counts', async () => {
    const sizes: number[] = []
    const real = Buffer.allocUnsafe.bind(Buffer)
    vi.spyOn(Buffer, 'allocUnsafe').mockImplementation((size: number) => {
      sizes.push(size)
      return real(size)
    })
    const path = join(dir, 'big.jsonl')
    writeFileSync(path, '')
    watcher.watch('s1', path)
    truncateSync(path, 64 * 1024 * 1024)
    appendFileSync(path, `\n${INTERRUPT}\n`)
    await vi.waitFor(() => expect(signals).toEqual(['interrupted']), { timeout: 10_000 })
    expect(Math.max(...sizes)).toBeLessThanOrEqual(TRANSCRIPT_MAX_DRAIN_BYTES)
  })
})
