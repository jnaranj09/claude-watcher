// Reading what is new in a session's transcript (memory phase 2): whole lines only, from a byte
// offset, within a byte cap. The transcript is a file claude is still writing, so every odd state
// of it ends in a defined answer. Synthetic lines only.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { EXTRACT_LIMITS } from '../../../shared/schemas/memoryExtract'
import {
  holdPartial,
  readTranscriptSlice,
  transcriptFsOnDisk,
  type TranscriptFs
} from './transcriptReader'

const line = (text: string): string =>
  JSON.stringify({ type: 'user', uuid: `u-${text.length}`, message: { content: text } })
const a = 'the api listens on 9281'
const b = 'the shop lives in /work/acme/shop'
const c = 'run the tests'

/** A fake file over a Buffer that records every read. */
function fsOf(
  text: string | Buffer
): TranscriptFs & { reads: { offset: number; length: number }[] } {
  const bytes = typeof text === 'string' ? Buffer.from(text, 'utf8') : text
  const reads: { offset: number; length: number }[] = []
  return {
    reads,
    size: () => Promise.resolve(bytes.length),
    read: (_p, offset, length) => {
      reads.push({ offset, length })
      return Promise.resolve(Buffer.from(bytes.subarray(offset, offset + length)))
    }
  }
}

const texts = (out: Awaited<ReturnType<typeof readTranscriptSlice>>): unknown[] =>
  (out?.lines ?? []).map((l) => l.entry.message?.content)

describe('readTranscriptSlice', () => {
  it('stops before a half-written last line and returns the offset of its start', async () => {
    const text = line(a) + '\n' + line(b) + '\n' + '{"type":"user","mess'
    const out = await readTranscriptSlice(fsOf(text), 'p', 0, 1 << 20)
    expect(out?.lines).toHaveLength(2)
    expect(out?.nextOffset).toBe(Buffer.byteLength(line(a) + '\n' + line(b) + '\n'))
    expect(out?.more).toBe(false)
  })

  it('gives each line the offset just after its line break', async () => {
    const text = line(a) + '\n' + line(b) + '\n'
    const out = await readTranscriptSlice(fsOf(text), 'p', 0, 1 << 20)
    expect(out?.lines.map((l) => l.end)).toEqual([
      Buffer.byteLength(line(a) + '\n'),
      Buffer.byteLength(text)
    ])
  })

  it('skips a line that is not JSON and a line that fails the schema, and keeps the rest', async () => {
    const bad = JSON.stringify({ type: 7, message: { content: 'x' } })
    const text = line(a) + '\n' + 'not json at all\n' + '\n' + bad + '\n' + line(b) + '\n'
    const out = await readTranscriptSlice(fsOf(text), 'p', 0, 1 << 20)
    expect(texts(out)).toEqual([a, b])
    expect(out?.nextOffset).toBe(Buffer.byteLength(text))
  })

  it('reads on from an offset and returns nothing new when the file has not grown', async () => {
    const first = line(a) + '\n'
    const text = first + line(b) + '\n'
    const out = await readTranscriptSlice(fsOf(text), 'p', Buffer.byteLength(first), 1 << 20)
    expect(texts(out)).toEqual([b])
    const again = await readTranscriptSlice(fsOf(text), 'p', Buffer.byteLength(text), 1 << 20)
    expect(again).toEqual({ lines: [], nextOffset: Buffer.byteLength(text), more: false })
  })

  it('skips one line longer than the cap and goes on after it', async () => {
    const big = line('z'.repeat(500))
    const text = line(a) + '\n' + big + '\n' + line(b) + '\n'
    const cap = Buffer.byteLength(line(a) + '\n' + line(b) + '\n')
    const out = await readTranscriptSlice(fsOf(text), 'p', 0, cap)
    expect(texts(out)).toEqual([a, b])
    expect(out?.nextOffset).toBe(Buffer.byteLength(text))
    expect(out?.more).toBe(false)
  })

  it('does not move past a half-written line longer than the cap', async () => {
    const text = line(a) + '\n' + '{"type":"user","message":{"content":"' + 'z'.repeat(500)
    const out = await readTranscriptSlice(fsOf(text), 'p', 0, 100)
    expect(texts(out)).toEqual([a])
    expect(out?.nextOffset).toBe(Buffer.byteLength(line(a) + '\n'))
    expect(out?.more).toBe(false)
  })

  it('says more when whole lines are left past the cap', async () => {
    const text = line(a) + '\n' + line(b) + '\n' + line(c) + '\n'
    const cap = Buffer.byteLength(line(a) + '\n' + line(b) + '\n')
    const out = await readTranscriptSlice(fsOf(text), 'p', 0, cap)
    expect(texts(out)).toEqual([a, b])
    expect(out?.nextOffset).toBe(cap)
    expect(out?.more).toBe(true)
  })

  it('says no more when only a half-written line is left past the cap', async () => {
    const text = line(a) + '\n' + '{"type":"us'
    const out = await readTranscriptSlice(fsOf(text), 'p', 0, Buffer.byteLength(line(a) + '\n'))
    expect(out?.more).toBe(false)
  })

  it('counts a skipped bad line against the cap', async () => {
    const text = 'x'.repeat(20) + '\n' + line(a) + '\n'
    const out = await readTranscriptSlice(fsOf(text), 'p', 0, Buffer.byteLength(line(a) + '\n'))
    expect(out).toEqual({ lines: [], nextOffset: 21, more: true })
  })

  it('answers null for a file shorter than the offset and for one that cannot be read', async () => {
    expect(await readTranscriptSlice(fsOf(line(a) + '\n'), 'p', 10_000, 1 << 20)).toBeNull()
    const noSize: TranscriptFs = {
      size: () => Promise.reject(new Error('ENOENT')),
      read: () => Promise.resolve(Buffer.alloc(0))
    }
    expect(await readTranscriptSlice(noSize, 'p', 0, 1 << 20)).toBeNull()
    const noRead: TranscriptFs = {
      size: () => Promise.resolve(100),
      read: () => Promise.reject(new Error('EACCES'))
    }
    expect(await readTranscriptSlice(noRead, 'p', 0, 1 << 20)).toBeNull()
  })

  it('answers null for an offset or a cap that is not a whole number of bytes', async () => {
    const fs = fsOf(line(a) + '\n')
    expect(await readTranscriptSlice(fs, 'p', -1, 1 << 20)).toBeNull()
    expect(await readTranscriptSlice(fs, 'p', 1.5, 1 << 20)).toBeNull()
    expect(await readTranscriptSlice(fs, 'p', 0, 0)).toBeNull()
    expect(await readTranscriptSlice(fs, 'p', 0, Number.NaN)).toBeNull()
  })

  it('counts bytes, not characters, for a line with a two-byte character', async () => {
    const first = line('café on port 9281') + '\n'
    const text = first + line(b) + '\n'
    const out = await readTranscriptSlice(fsOf(text), 'p', 0, 1 << 20)
    expect(out?.lines[0]?.end).toBe(Buffer.byteLength(first))
    expect(out?.lines[0]?.end).toBe(first.length + 1)
    expect(out?.nextOffset).toBe(Buffer.byteLength(text))
  })

  it('reads a byte that is not valid UTF-8 as a replacement character and keeps the offsets', async () => {
    const head = Buffer.from('{"type":"user","uuid":"u1","message":{"content":"bad ', 'utf8')
    const tail = Buffer.from(' byte"}}\n', 'utf8')
    const bytes = Buffer.concat([head, Buffer.from([0xff]), tail, Buffer.from(line(b) + '\n')])
    const out = await readTranscriptSlice(fsOf(bytes), 'p', 0, 1 << 20)
    expect(texts(out)).toEqual(['bad � byte', b])
    expect(out?.lines[0]?.end).toBe(head.length + 1 + tail.length)
    expect(out?.nextOffset).toBe(bytes.length)
  })

  it('reads in steps of the read step and keeps a line that spans two steps', async () => {
    const step = EXTRACT_LIMITS.readStepBytes
    const long = line('w'.repeat(step))
    const text = long + '\n' + line(b) + '\n'
    const fs = fsOf(text)
    const out = await readTranscriptSlice(fs, 'p', 0, step * 4)
    expect(texts(out)).toEqual(['w'.repeat(step), b])
    expect(fs.reads.map((r) => r.offset)).toEqual([0, step])
    expect(fs.reads.every((r) => r.length <= step)).toBe(true)
  })

  it('never reads past the size it saw first, so a file that grows meanwhile waits for the next read', async () => {
    const first = line(a) + '\n'
    let bytes = Buffer.from(first + '{"type":"user","mess')
    const growing: TranscriptFs = {
      size: () => Promise.resolve(bytes.length),
      read: (_p, offset, length) => {
        const out = Buffer.from(bytes.subarray(offset, offset + length))
        bytes = Buffer.from(first + line(b) + '\n' + line(c) + '\n')
        return Promise.resolve(out)
      }
    }
    const out = await readTranscriptSlice(growing, 'p', 0, 1 << 20)
    expect(texts(out)).toEqual([a])
    expect(out?.nextOffset).toBe(Buffer.byteLength(first))
  })

  it('stops at what it got when the file shrinks while it is read', async () => {
    const text = line(a) + '\n' + line(b) + '\n'
    const shrunk: TranscriptFs = {
      size: () => Promise.resolve(Buffer.byteLength(text) + 50),
      read: (_p, offset, length) =>
        Promise.resolve(Buffer.from(Buffer.from(text).subarray(offset, offset + length)))
    }
    const out = await readTranscriptSlice(shrunk, 'p', 0, 1 << 20)
    expect(texts(out)).toEqual([a, b])
    expect(out?.nextOffset).toBe(Buffer.byteLength(text))
    expect(out?.more).toBe(false)
  })
})

describe('readTranscriptSlice between steps', () => {
  it('gives the event loop a turn between two read steps, even when a read answers at once', async () => {
    const step = EXTRACT_LIMITS.readStepBytes
    const bytes = Buffer.from(line('w'.repeat(step)) + '\n')
    let ticked = false
    const tickedAtRead: boolean[] = []
    const instant: TranscriptFs = {
      size: () => Promise.resolve(bytes.length),
      read: (_p, offset, length) => {
        tickedAtRead.push(ticked)
        return Promise.resolve(Buffer.from(bytes.subarray(offset, offset + length)))
      }
    }
    setImmediate(() => {
      ticked = true
    })
    const out = await readTranscriptSlice(instant, 'p', 0, step * 2)
    expect(out?.lines).toHaveLength(1)
    expect(tickedAtRead).toEqual([false, true])
  })
})

describe('holdPartial', () => {
  const held = [Buffer.from('ab')]
  const piece = Buffer.from('cd')

  it('adds the latest bytes while the line so far fits the cap', () => {
    expect(Buffer.concat(holdPartial(held, piece, 4, 4)).toString()).toBe('abcd')
  })

  it('holds nothing once the line so far is longer than the cap', () => {
    expect(holdPartial(held, piece, 5, 4)).toEqual([])
  })
})

describe('transcriptFsOnDisk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-transcript-reader-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads a real file from an offset', async () => {
    const path = join(dir, 'one.jsonl')
    const text = line(a) + '\n' + line(b) + '\n'
    writeFileSync(path, text)
    const out = await readTranscriptSlice(transcriptFsOnDisk, path, 0, 1 << 20)
    expect(texts(out)).toEqual([a, b])
    expect(out?.nextOffset).toBe(Buffer.byteLength(text))
  })

  it('answers null for a file that is not there', async () => {
    expect(
      await readTranscriptSlice(transcriptFsOnDisk, join(dir, 'gone.jsonl'), 0, 1 << 20)
    ).toBeNull()
  })
})
