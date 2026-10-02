import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createTranscriptInfoReader,
  createTranscriptInfoReaderFromFs,
  parseTranscriptInfo,
  readFileHead
} from './claudeTranscriptInfo'
import { locateTranscript } from './claudeTranscript'

const ID = '93b82f21-709b-41a5-8d8a-8b1a4af499bf'
const lines = (...objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n')

afterEach(() => vi.restoreAllMocks())

describe('parseTranscriptInfo', () => {
  it('takes the cwd of the first line that has one', () => {
    const text = lines(
      { type: 'custom-title', customTitle: 'x' },
      { type: 'user', cwd: '/home/op/api' },
      { type: 'user', cwd: '/home/op/other' }
    )
    expect(parseTranscriptInfo(text)?.cwd).toBe('/home/op/api')
  })
  it('the LAST custom-title wins over every ai-title', () => {
    const text = lines(
      { type: 'user', cwd: '/a' },
      { type: 'custom-title', customTitle: 'first' },
      { type: 'ai-title', aiTitle: 'ai' },
      { type: 'custom-title', customTitle: 'renamed' }
    )
    expect(parseTranscriptInfo(text)?.title).toBe('renamed')
  })
  it('falls back to the last ai-title', () => {
    const text = lines(
      { type: 'user', cwd: '/a' },
      { type: 'ai-title', aiTitle: 'one' },
      { type: 'ai-title', aiTitle: 'two' }
    )
    expect(parseTranscriptInfo(text)?.title).toBe('two')
  })
  it('no title line → title null', () => {
    expect(parseTranscriptInfo(lines({ type: 'user', cwd: '/a' }))).toEqual({
      cwd: '/a',
      title: null
    })
  })
  it('skips bad JSON and lines with a wrong-typed known key', () => {
    const text = ['{not json', JSON.stringify({ cwd: 5 }), JSON.stringify({ cwd: '/ok' })].join(
      '\n'
    )
    expect(parseTranscriptInfo(text)?.cwd).toBe('/ok')
  })
  it('a cut last line is skipped (16 MiB cap, or claude mid-write)', () => {
    const text = lines({ type: 'user', cwd: '/a' }) + '\n{"type":"ai-title","aiTi'
    expect(parseTranscriptInfo(text)).toEqual({ cwd: '/a', title: null })
  })
  it('a relative cwd is not trusted', () => {
    expect(parseTranscriptInfo(lines({ type: 'user', cwd: 'api' }))).toBeNull()
  })
  it('no cwd at all → null', () => {
    expect(parseTranscriptInfo(lines({ type: 'ai-title', aiTitle: 't' }))).toBeNull()
  })
  it('handles CRLF line ends', () => {
    expect(parseTranscriptInfo(`${JSON.stringify({ cwd: '/a' })}\r\n`)?.cwd).toBe('/a')
  })
})

describe('createTranscriptInfoReader', () => {
  it('not found → null, nothing read, nothing logged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const readHead = vi.fn(() => '')
    expect(createTranscriptInfoReader({ locate: () => null, readHead })(ID)).toBeNull()
    expect(readHead).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
  it('read error → null, logs the code only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const read = createTranscriptInfoReader({
      locate: () => '/home/op/.claude/projects/p/x.jsonl',
      readHead: () => {
        throw new Error('EACCES /home/op/.claude/projects/p/x.jsonl')
      }
    })
    expect(read(ID)).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      '[claude-watcher][transcript-info] code=transcript_info_read_failed'
    )
  })
  it('no cwd → null, logs the code only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const read = createTranscriptInfoReader({ locate: () => '/p', readHead: () => '{"type":"x"}' })
    expect(read(ID)).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      '[claude-watcher][transcript-info] code=transcript_info_no_cwd'
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/p')
  })
  it('passes the 16 MiB cap to readHead', () => {
    const readHead = vi.fn(() => JSON.stringify({ cwd: '/a' }))
    createTranscriptInfoReader({ locate: () => '/p', readHead })(ID)
    expect(readHead).toHaveBeenCalledWith('/p', 16 * 1024 * 1024)
  })
})

describe('on the real fs', () => {
  let root: string | undefined
  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
    root = undefined
  })

  it('readFileHead reads at most maxBytes', () => {
    root = mkdtempSync(join(tmpdir(), 'cw-ti-'))
    const file = join(root, 'f')
    writeFileSync(file, 'abcdef')
    expect(readFileHead(file, 3)).toBe('abc')
    expect(readFileHead(file, 100)).toBe('abcdef')
  })

  it('finds <configDir>/projects/*/<id>.jsonl and reads it', () => {
    root = mkdtempSync(join(tmpdir(), 'cw-ti-'))
    mkdirSync(join(root, 'projects', '-home-op-api'), { recursive: true })
    writeFileSync(
      join(root, 'projects', '-home-op-api', `${ID}.jsonl`),
      lines({ type: 'user', cwd: '/home/op/api' }, { type: 'ai-title', aiTitle: 'Fix billing' })
    )
    const read = createTranscriptInfoReaderFromFs({ CLAUDE_CONFIG_DIR: root })
    expect(read(ID)).toEqual({ cwd: '/home/op/api', title: 'Fix billing' })
  })
})

describe('locateTranscript', () => {
  const deps = (
    files: Record<string, 'file' | 'missing' | 'unknown'>,
    folders = ['a', 'b']
  ): Parameters<typeof locateTranscript>[0] => ({
    projectsDir: '/p',
    listDir: () => folders,
    fileState: (path: string) => files[path] ?? 'missing'
  })
  it('found → the path', () => {
    expect(locateTranscript(deps({ [`/p/b/${ID}.jsonl`]: 'file' }), ID)).toEqual({
      kind: 'found',
      path: `/p/b/${ID}.jsonl`
    })
  })
  it('nowhere → missing', () => {
    expect(locateTranscript(deps({}), ID)).toEqual({ kind: 'missing' })
  })
  it('an unreadable candidate and no hit → unknown', () => {
    expect(locateTranscript(deps({ [`/p/a/${ID}.jsonl`]: 'unknown' }), ID)).toEqual({
      kind: 'unknown'
    })
  })
  it('a non-uuid id → unknown (never builds a path from it)', () => {
    const listDir = vi.fn(() => ['a'])
    expect(
      locateTranscript({ projectsDir: '/p', listDir, fileState: () => 'file' }, '../x')
    ).toEqual({ kind: 'unknown' })
    expect(listDir).not.toHaveBeenCalled()
  })
  it('an unlistable projects dir → unknown', () => {
    const listDir = (): string[] => {
      throw new Error('EACCES')
    }
    expect(locateTranscript({ projectsDir: '/p', listDir, fileState: () => 'file' }, ID)).toEqual({
      kind: 'unknown'
    })
  })
})
