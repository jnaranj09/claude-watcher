// GOALS.md on the real fs (security audit finding `goalsFile.ts:writeAtomic:tmp-symlink-follow`):
// a project folder is not trusted, so a link planted there must never carry the export's write to
// a file outside the folder. Fault: a fixed temp name written with a following open, or a
// `readText` that follows a GOALS.md link to a file that carries the header.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Goal, Task } from '../../shared/schemas/goal'
import {
  createGoalsFileExporter,
  GOALS_FILE_HEADER,
  GOALS_FILE_NAME,
  nodeGoalsFileFs
} from './goalsFile'

let root = ''
let folder = ''
let outside = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cw-goals-link-'))
  folder = join(root, 'project')
  outside = join(root, 'outside.txt')
  mkdirSync(folder)
  writeFileSync(outside, 'operator data\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function snapshot(): { goals: Goal[]; tasks: Task[] } {
  const goal: Goal = {
    id: 'g1',
    workspaceId: 'w1',
    name: 'Goal one',
    defaultCwd: folder,
    saveToFile: true,
    createdAt: 1,
    memorySessionIds: []
  }
  return { goals: [goal], tasks: [] }
}

function exporter(): {
  run: ReturnType<typeof createGoalsFileExporter>
  logs: string[]
} {
  const logs: string[] = []
  const run = createGoalsFileExporter({
    fs: nodeGoalsFileFs,
    log: (m) => logs.push(m),
    reportOrphan: () => undefined
  })
  return { run, logs }
}

describe('GOALS.md export on the real fs with planted links', () => {
  it('a link planted at the old fixed temp name leaves its target untouched', () => {
    symlinkSync(outside, join(folder, `${GOALS_FILE_NAME}.claude-watcher-tmp`))
    const { run } = exporter()
    run.rewrite(folder, snapshot())
    expect(readFileSync(outside, 'utf8')).toBe('operator data\n')
    expect(readFileSync(join(folder, GOALS_FILE_NAME), 'utf8')).toContain('## Goal one')
  })

  it('a GOALS.md that is a link to a file with the header is not ours and is not written', () => {
    writeFileSync(outside, `${GOALS_FILE_HEADER}\nold\n`)
    symlinkSync(outside, join(folder, GOALS_FILE_NAME))
    const { run } = exporter()
    run.rewrite(folder, snapshot())
    expect(readFileSync(outside, 'utf8')).toBe(`${GOALS_FILE_HEADER}\nold\n`)
    expect(run.problems(snapshot())).toEqual([{ goalId: 'g1', code: 'goals_file_not_ours' }])
  })

  it('writeText refuses a path where a link already is', () => {
    const link = join(root, 'link')
    symlinkSync(outside, link)
    expect(() => nodeGoalsFileFs.writeText(link, 'x')).toThrow()
    expect(readFileSync(outside, 'utf8')).toBe('operator data\n')
    expect(existsSync(link)).toBe(true)
  })
})
