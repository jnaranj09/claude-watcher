import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTranscriptLookup, type TranscriptLookupDeps } from './claudeTranscript'

const ID = '39464e81-0e90-4c3e-bc0e-f3b1e2638e3d'

function deps(files: string[], over: Partial<TranscriptLookupDeps> = {}): TranscriptLookupDeps {
  return {
    projectsDir: '/c/projects',
    listDir: () => ['-home-op-api', '-tmp-x'],
    isFile: (path) => files.includes(path),
    ...over
  }
}

describe('createTranscriptLookup', () => {
  it('a known path is checked as is, with no scan', () => {
    const listDir = vi.fn(() => [])
    const has = createTranscriptLookup(deps(['/t/a.jsonl'], { listDir }))
    expect(has(ID, '/t/a.jsonl')).toBe(true)
    expect(has(ID, '/t/gone.jsonl')).toBe(false)
    expect(listDir).not.toHaveBeenCalled()
  })
  it('no path: finds <id>.jsonl in any projects folder', () => {
    const has = createTranscriptLookup(deps([`/c/projects/-tmp-x/${ID}.jsonl`]))
    expect(has(ID, undefined)).toBe(true)
  })
  it('no path: false when no projects folder holds the id (a session with no prompt)', () => {
    expect(createTranscriptLookup(deps([]))(ID, undefined)).toBe(false)
  })
  it('fails OPEN when the projects folder cannot be listed', () => {
    const listDir = (): string[] => {
      throw new Error('EACCES')
    }
    expect(createTranscriptLookup(deps([], { listDir }))(ID, undefined)).toBe(true)
  })
  it('fails OPEN on an id that is not a UUID — never joins it into a path', () => {
    const isFile = vi.fn(() => false)
    const has = createTranscriptLookup(deps([], { isFile }))
    expect(has('../../etc/passwd', undefined)).toBe(true)
    expect(isFile).not.toHaveBeenCalled()
  })
  it('works over a real folder tree', async () => {
    const { readdirSync, statSync } = await import('node:fs')
    const root = mkdtempSync(join(tmpdir(), 'cw-transcript-'))
    mkdirSync(join(root, '-home-op-api'))
    mkdirSync(join(root, '-tmp-x'))
    writeFileSync(join(root, '-tmp-x', `${ID}.jsonl`), '{}\n')
    const has = createTranscriptLookup({
      projectsDir: root,
      listDir: (dir) => readdirSync(dir),
      isFile: (path) => {
        try {
          return statSync(path).isFile()
        } catch {
          return false
        }
      }
    })
    expect(has(ID, undefined)).toBe(true)
    expect(has('00000000-0000-4000-8000-000000000000', undefined)).toBe(false)
  })
})
