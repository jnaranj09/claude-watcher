import { describe, it, expect, vi } from 'vitest'
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  archiveTranscriptCheck,
  createTranscriptLookup,
  createTranscriptLookupFromFs,
  fileStateOnDisk,
  type FileState,
  type TranscriptLookupDeps
} from './claudeTranscript'

const ID = '39464e81-0e90-4c3e-bc0e-f3b1e2638e3d'

function deps(files: string[], over: Partial<TranscriptLookupDeps> = {}): TranscriptLookupDeps {
  return {
    projectsDir: '/c/projects',
    listDir: () => ['-home-op-api', '-tmp-x'],
    fileState: (path): FileState => (files.includes(path) ? 'file' : 'missing'),
    ...over
  }
}

describe('createTranscriptLookup', () => {
  it('a known path that exists answers true with no scan', () => {
    const listDir = vi.fn(() => [])
    const has = createTranscriptLookup(deps(['/t/a.jsonl'], { listDir }))
    expect(has(ID, '/t/a.jsonl')).toBe(true)
    expect(listDir).not.toHaveBeenCalled()
  })
  it('a known path that is gone falls back to the scan by id (a hook can send any path)', () => {
    const inProjects = `/c/projects/-tmp-x/${ID}.jsonl`
    expect(createTranscriptLookup(deps([inProjects]))(ID, '/forged/path.jsonl')).toBe(true)
    expect(createTranscriptLookup(deps([]))(ID, '/t/gone.jsonl')).toBe(false)
  })
  it('a known path that cannot be read (not ENOENT) fails OPEN', () => {
    const fileState = (): FileState => 'unknown'
    expect(createTranscriptLookup(deps([], { fileState }))(ID, '/t/a.jsonl')).toBe(true)
  })
  it('no path: finds <id>.jsonl in any projects folder', () => {
    const has = createTranscriptLookup(deps([`/c/projects/-tmp-x/${ID}.jsonl`]))
    expect(has(ID, undefined)).toBe(true)
  })
  it('no path: false when no projects folder holds the id (a session with no prompt)', () => {
    expect(createTranscriptLookup(deps([]))(ID, undefined)).toBe(false)
  })
  it('no path: an unreadable candidate fails OPEN', () => {
    const fileState = (path: string): FileState => (path.includes('-tmp-x') ? 'unknown' : 'missing')
    expect(createTranscriptLookup(deps([], { fileState }))(ID, undefined)).toBe(true)
  })
  it('fails OPEN when the projects folder cannot be listed', () => {
    const listDir = (): string[] => {
      throw new Error('EACCES')
    }
    expect(createTranscriptLookup(deps([], { listDir }))(ID, undefined)).toBe(true)
  })
  it('fails OPEN on an id that is not a UUID — never joins it into a path', () => {
    const fileState = vi.fn((): FileState => 'missing')
    const has = createTranscriptLookup(deps([], { fileState }))
    expect(has('../../etc/passwd', undefined)).toBe(true)
    expect(fileState).not.toHaveBeenCalled()
  })
})

describe('the real filesystem', () => {
  it('fileStateOnDisk: file / missing (ENOENT, ENOTDIR, a folder) / unknown (EACCES)', () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-state-'))
    writeFileSync(join(root, 'f'), 'x')
    mkdirSync(join(root, 'locked'))
    writeFileSync(join(root, 'locked', 'g'), 'x')
    expect(fileStateOnDisk(join(root, 'f'))).toBe('file')
    expect(fileStateOnDisk(join(root, 'nope'))).toBe('missing')
    expect(fileStateOnDisk(join(root, 'f', 'under-a-file'))).toBe('missing')
    expect(fileStateOnDisk(root)).toBe('missing')
    chmodSync(join(root, 'locked'), 0o000)
    try {
      // root ignores permissions — only assert where they apply
      if (process.getuid?.() !== 0)
        expect(fileStateOnDisk(join(root, 'locked', 'g'))).toBe('unknown')
    } finally {
      chmodSync(join(root, 'locked'), 0o700)
    }
  })
  it('the production lookup reads <CLAUDE_CONFIG_DIR>/projects', () => {
    const config = mkdtempSync(join(tmpdir(), 'cw-config-'))
    mkdirSync(join(config, 'projects', '-tmp-x'), { recursive: true })
    writeFileSync(join(config, 'projects', '-tmp-x', `${ID}.jsonl`), '{}\n')
    const has = createTranscriptLookupFromFs({ CLAUDE_CONFIG_DIR: config })
    expect(has(ID, undefined)).toBe(true)
    expect(has('00000000-0000-4000-8000-000000000000', undefined)).toBe(false)
  })
})

describe('archiveTranscriptCheck (the check that deletes a record)', () => {
  it('no path and the hooks NOT bound: keeps the record without asking', () => {
    const lookup = vi.fn(() => false)
    expect(archiveTranscriptCheck(lookup, () => false)(ID, undefined)).toBe(true)
    expect(lookup).not.toHaveBeenCalled()
  })
  it('no path and the hooks bound: the lookup decides', () => {
    expect(
      archiveTranscriptCheck(
        () => false,
        () => true
      )(ID, undefined)
    ).toBe(false)
  })
  it('a known path: the lookup decides, hooks or not', () => {
    const lookup = vi.fn(() => false)
    expect(archiveTranscriptCheck(lookup, () => false)(ID, '/t/a.jsonl')).toBe(false)
    expect(lookup).toHaveBeenCalledWith(ID, '/t/a.jsonl')
  })
})
