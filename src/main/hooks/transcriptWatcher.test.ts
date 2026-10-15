// Transcript watcher — unit tests for the incremental JSONL tailer.
//
// Runs under the `main-unit` Vitest project (node). Uses REAL files and REAL fs watching
// — no mocks. The whole job of this module is filesystem behaviour, so a mock would only
// assert the calls I wrote, not that tailing actually works.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTranscriptWatcher, type TranscriptWatcher } from './transcriptWatcher'

/** Short backup poll so a negative test's settle window spans several polls. */
const POLL_MS = 25

let dir: string
let watcher: TranscriptWatcher
let signals: Array<{ sessionId: string; kind: string }>

const INTERRUPT = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tw-'))
  signals = []
  watcher = createTranscriptWatcher({
    pollMs: POLL_MS,
    onSignal: (sessionId, signal) =>
      signals.push({
        sessionId,
        kind: signal.kind,
        ...('taskId' in signal ? { taskId: signal.taskId } : {})
      })
  })
})
afterEach(() => {
  watcher.dispose()
  rmSync(dir, { recursive: true, force: true })
})

const file = (name: string): string => join(dir, name)

/** Wait a real interval before asserting. `vi.waitFor` is WRONG for a negative
 *  assertion — it succeeds on its FIRST check, so "stays empty" passes instantly
 *  without ever giving the watcher a chance to (incorrectly) fire. The default spans
 *  several `POLL_MS` polls, so the backup poll gets its chance to fire too. */
const settle = (ms = 100): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('createTranscriptWatcher — incremental tailing', () => {
  it('reports an interrupt appended after watching starts', async () => {
    const p = file('a.jsonl')
    writeFileSync(p, '')
    watcher.watch('s1', p)
    appendFileSync(p, INTERRUPT + '\n')
    await vi.waitFor(() => expect(signals).toEqual([{ sessionId: 's1', kind: 'interrupted' }]))
  })

  // LOAD-BEARING: a transcript already holds the whole conversation, often including OLD
  // interrupts. Replaying them on attach would immediately flip a healthy working session
  // to idle. Watching starts at the END of the file.
  it('does NOT replay history that existed before watching started', async () => {
    const p = file('c.jsonl')
    writeFileSync(p, INTERRUPT + '\n' + INTERRUPT + '\n')
    watcher.watch('s1', p)
    appendFileSync(p, JSON.stringify({ type: 'user', message: { content: 'hello' } }) + '\n')
    await settle()
    expect(signals).toEqual([])
  })

  it('handles several appends in sequence', async () => {
    const p = file('d.jsonl')
    writeFileSync(p, '')
    watcher.watch('s1', p)
    appendFileSync(p, INTERRUPT + '\n')
    appendFileSync(p, JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n')
    appendFileSync(p, INTERRUPT + '\n')
    await vi.waitFor(() => expect(signals.length).toBe(2))
    expect(signals.every((s) => s.kind === 'interrupted')).toBe(true)
  })

  it('survives a line that is not valid JSON (drop, keep tailing)', async () => {
    const p = file('e.jsonl')
    writeFileSync(p, '')
    watcher.watch('s1', p)
    appendFileSync(p, '{ this is not json\n')
    appendFileSync(p, INTERRUPT + '\n')
    await vi.waitFor(() => expect(signals).toEqual([{ sessionId: 's1', kind: 'interrupted' }]))
  })

  it('waits for a full line before parsing a partial write', async () => {
    const p = file('f.jsonl')
    writeFileSync(p, '')
    watcher.watch('s1', p)
    const half = INTERRUPT.slice(0, 30)
    appendFileSync(p, half)
    await settle()
    expect(signals).toEqual([])
    appendFileSync(p, INTERRUPT.slice(30) + '\n')
    await vi.waitFor(() => expect(signals).toEqual([{ sessionId: 's1', kind: 'interrupted' }]))
  })

  it('watching a path that does not exist yet picks it up once created', async () => {
    const p = file('g.jsonl')
    watcher.watch('s1', p)
    writeFileSync(p, INTERRUPT + '\n')
    await vi.waitFor(() => expect(signals).toEqual([{ sessionId: 's1', kind: 'interrupted' }]), {
      timeout: 4000
    })
  })

  it('keeps sessions separate', async () => {
    const p1 = file('h1.jsonl')
    const p2 = file('h2.jsonl')
    writeFileSync(p1, '')
    writeFileSync(p2, '')
    watcher.watch('s1', p1)
    watcher.watch('s2', p2)
    appendFileSync(p2, INTERRUPT + '\n')
    await vi.waitFor(() => expect(signals).toEqual([{ sessionId: 's2', kind: 'interrupted' }]))
  })

  it('re-watching the SAME path for a session does not double-report', async () => {
    const p = file('i.jsonl')
    writeFileSync(p, '')
    watcher.watch('s1', p)
    watcher.watch('s1', p)
    watcher.watch('s1', p)
    appendFileSync(p, INTERRUPT + '\n')
    await vi.waitFor(() => expect(signals.length).toBe(1))
  })

  it('unwatch stops reporting', async () => {
    const p = file('j.jsonl')
    writeFileSync(p, '')
    watcher.watch('s1', p)
    watcher.unwatch('s1')
    appendFileSync(p, INTERRUPT + '\n')
    await settle()
    expect(signals).toEqual([])
  })

  it('dispose stops every watch', async () => {
    const p = file('k.jsonl')
    writeFileSync(p, '')
    watcher.watch('s1', p)
    watcher.dispose()
    appendFileSync(p, INTERRUPT + '\n')
    await settle()
    expect(signals).toEqual([])
  })
})

describe('createTranscriptWatcher — attach reporting', () => {
  it('reports true on the first attach and false when already following that path', () => {
    const p = file('l.jsonl')
    writeFileSync(p, '')
    expect(watcher.watch('s1', p)).toBe(true)
    expect(watcher.watch('s1', p)).toBe(false)
  })

  it('reports true again when the session re-points at a DIFFERENT path', () => {
    const p1 = file('m1.jsonl')
    const p2 = file('m2.jsonl')
    writeFileSync(p1, '')
    writeFileSync(p2, '')
    expect(watcher.watch('s1', p1)).toBe(true)
    expect(watcher.watch('s1', p2)).toBe(true)
  })
})
