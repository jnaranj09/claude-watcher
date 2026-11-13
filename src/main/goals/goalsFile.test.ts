// GOALS.md (spec 2026-10-29): the pure render and the exporter over a fake in-memory fs. The
// exporter never writes or removes a file it did not make, never creates a folder, and writes
// only when a folder's text changed.
import { describe, it, expect } from 'vitest'
import type { Goal, Task } from '../../shared/schemas/goal'
import {
  createGoalsFileExporter,
  GOALS_FILE_HEADER,
  renderGoalsFile,
  type GoalsFileFs,
  type GoalsSnapshot
} from './goalsFile'
import { createGoalsStore } from '../persistence/goals'

const A = '/work/a'
const B = '/work/b'

function goal(over: Partial<Goal> & Pick<Goal, 'id'>): Goal {
  return {
    workspaceId: 'w1',
    name: `Goal ${over.id}`,
    defaultCwd: A,
    saveToFile: true,
    createdAt: 1,
    ...over
  }
}

function task(over: Partial<Task> & Pick<Task, 'id' | 'goalId'>): Task {
  return {
    workspaceId: 'w1',
    title: `Task ${over.id}`,
    status: 'open',
    sessionIds: [],
    createdAt: 1,
    doneAt: null,
    doneBy: null,
    check: null,
    leftWith: null,
    lastSeenAt: null,
    report: null,
    originSessionId: null,
    folder: null,
    ...over
  }
}

function fakeFs(
  opts: {
    dirs?: string[]
    files?: Record<string, string>
    failRename?: boolean
    failRemove?: boolean
  } = {}
): GoalsFileFs & { files: Map<string, string>; dirs: Set<string>; writes: string[] } {
  const files = new Map(Object.entries(opts.files ?? {}))
  const dirs = new Set(opts.dirs ?? [A, B])
  const writes: string[] = []
  return {
    files,
    dirs,
    writes,
    isDirectory: (p) => dirs.has(p),
    readText: (p) => files.get(p) ?? null,
    writeText(p, text) {
      writes.push(p)
      files.set(p, text)
    },
    rename(from, to) {
      if (opts.failRename === true) throw new Error('EACCES')
      const text = files.get(from)
      if (text === undefined) throw new Error('ENOENT')
      files.delete(from)
      files.set(to, text)
    },
    remove(p) {
      if (opts.failRemove === true && !p.endsWith('-tmp')) throw new Error('EACCES')
      files.delete(p)
    }
  }
}

function setup(fsOpts: Parameters<typeof fakeFs>[0] = {}): {
  fs: ReturnType<typeof fakeFs>
  exporter: ReturnType<typeof createGoalsFileExporter>
  logs: string[]
  orphans: number[]
} {
  const fs = fakeFs(fsOpts)
  const logs: string[] = []
  const orphans: number[] = []
  const exporter = createGoalsFileExporter({
    fs,
    log: (m) => logs.push(m),
    reportOrphan: () => orphans.push(1)
  })
  return { fs, exporter, logs, orphans }
}

const EMPTY: GoalsSnapshot = { goals: [], tasks: [] }
const fileOf = (folder: string): string => `${folder}/GOALS.md`

describe('renderGoalsFile', () => {
  it('renders goals in createdAt order with checkboxes', () => {
    const snap: GoalsSnapshot = {
      goals: [
        goal({ id: 'g2', name: 'Clean up CI', createdAt: 5 }),
        goal({ id: 'g1', name: 'Ship the billing page', createdAt: 2 })
      ],
      tasks: [
        task({ id: 't1', goalId: 'g1', title: 'Draft the invoice table' }),
        task({ id: 't2', goalId: 'g1', title: 'Add the tax column', status: 'done' })
      ]
    }
    expect(renderGoalsFile(A, snap)).toBe(
      [
        GOALS_FILE_HEADER,
        '',
        '# Goals',
        '',
        '## Ship the billing page',
        '',
        '- [ ] Draft the invoice table',
        '- [x] Add the tax column',
        '',
        '## Clean up CI',
        ''
      ].join('\n')
    )
  })

  it('renders null when no goal saves to the folder', () => {
    expect(renderGoalsFile(A, { goals: [goal({ id: 'g1', saveToFile: false })], tasks: [] })).toBe(
      null
    )
  })

  it('leaves out a goal of another folder', () => {
    const text = renderGoalsFile(A, {
      goals: [goal({ id: 'g1' }), goal({ id: 'g2', name: 'Elsewhere', defaultCwd: B })],
      tasks: []
    })
    expect(text).not.toContain('Elsewhere')
  })

  it('leaves out loose tasks and ids, dates, session ids', () => {
    const text = renderGoalsFile(A, {
      goals: [goal({ id: 'goal-id-1', name: 'Ship' })],
      tasks: [
        task({
          id: 'task-id-1',
          goalId: 'goal-id-1',
          title: 'Do',
          sessionIds: ['sess-1'],
          doneAt: 999
        }),
        task({ id: 'loose', goalId: null, title: 'Daily thing' })
      ]
    })
    expect(text).not.toContain('goal-id-1')
    expect(text).not.toContain('task-id-1')
    expect(text).not.toContain('sess-1')
    expect(text).not.toContain('999')
    expect(text).not.toContain('Daily thing')
  })
})

describe('createGoalsFileExporter', () => {
  const g1 = goal({ id: 'g1' })
  const t1 = task({ id: 't1', goalId: 'g1' })

  it('writes the file when a task title changes', () => {
    const { fs, exporter } = setup()
    const before = { goals: [g1], tasks: [t1] }
    exporter.afterChange(EMPTY, before)
    exporter.afterChange(before, { goals: [g1], tasks: [{ ...t1, title: 'Renamed' }] })
    expect(fs.files.get(fileOf(A))).toContain('- [ ] Renamed')
    expect(fs.files.has(`${fileOf(A)}.claude-watcher-tmp`)).toBe(false)
  })

  it('writes nothing when only sessionIds or doneAt changed', () => {
    const { fs, exporter } = setup()
    const before = { goals: [g1], tasks: [t1] }
    exporter.afterChange(EMPTY, before)
    fs.writes.length = 0
    exporter.afterChange(before, { goals: [g1], tasks: [{ ...t1, sessionIds: ['s1'] }] })
    expect(fs.writes).toEqual([])
  })

  it('moving a goal from A to B removes A file and writes B', () => {
    const { fs, exporter } = setup()
    const before = { goals: [g1], tasks: [t1] }
    exporter.afterChange(EMPTY, before)
    exporter.afterChange(before, { goals: [{ ...g1, defaultCwd: B }], tasks: [t1] })
    expect(fs.files.has(fileOf(A))).toBe(false)
    expect(fs.files.get(fileOf(B))).toContain('## Goal g1')
  })

  it('a goal turned off leaves the file, which goes when it was the last', () => {
    const { fs, exporter } = setup()
    const g2 = goal({ id: 'g2', createdAt: 2 })
    const both = { goals: [g1, g2], tasks: [] }
    exporter.afterChange(EMPTY, both)
    const oneOff = { goals: [{ ...g1, saveToFile: false }, g2], tasks: [] }
    exporter.afterChange(both, oneOff)
    expect(fs.files.get(fileOf(A))).not.toContain('## Goal g1')
    exporter.afterChange(oneOff, { goals: [], tasks: [] })
    expect(fs.files.has(fileOf(A))).toBe(false)
  })

  it('never writes or removes a file without the header', () => {
    const mine = '# My own goals\n'
    const { fs, exporter, orphans } = setup({ files: { [fileOf(A)]: mine } })
    const on = { goals: [g1], tasks: [] }
    exporter.afterChange(EMPTY, on)
    expect(fs.files.get(fileOf(A))).toBe(mine)
    expect(exporter.problems(on)).toEqual([{ goalId: 'g1', code: 'goals_file_not_ours' }])
    exporter.afterChange(on, { goals: [{ ...g1, saveToFile: false }], tasks: [] })
    expect(fs.files.get(fileOf(A))).toBe(mine)
    // Leaving a file it did not make is the right outcome, not a failure to report.
    expect(orphans).toEqual([])
  })

  it('a change outside the file never rewrites one that differs on disk', () => {
    const before = { goals: [g1], tasks: [t1] }
    const edited = `${GOALS_FILE_HEADER}\n\nhand edit kept by the operator\n`
    const { fs, exporter } = setup({ files: { [fileOf(A)]: edited } })
    exporter.afterChange(before, { goals: [g1], tasks: [{ ...t1, sessionIds: ['s1'], doneAt: 5 }] })
    expect(fs.writes).toEqual([])
    expect(fs.files.get(fileOf(A))).toBe(edited)
  })

  it('two workspaces on one folder share one file', () => {
    const { fs, exporter } = setup()
    exporter.afterChange(EMPTY, {
      goals: [g1, goal({ id: 'g2', workspaceId: 'w2', name: 'Other space', createdAt: 3 })],
      tasks: []
    })
    const text = fs.files.get(fileOf(A)) ?? ''
    expect(text.indexOf('## Goal g1')).toBeLessThan(text.indexOf('## Other space'))
  })

  it('missing folder is a problem and is never created', () => {
    const { fs, exporter, logs } = setup({ dirs: [] })
    const snap = { goals: [g1], tasks: [] }
    exporter.check(snap)
    expect(exporter.problems(snap)).toEqual([{ goalId: 'g1', code: 'folder_missing' }])
    exporter.afterChange(EMPTY, snap)
    expect(fs.writes).toEqual([])
    expect(logs.every((l) => !l.includes(A))).toBe(true)
  })

  it('check writes nothing even when the file is out of date', () => {
    const { fs, exporter } = setup()
    exporter.check({ goals: [g1], tasks: [t1] })
    expect(fs.writes).toEqual([])
    expect(exporter.problems({ goals: [g1], tasks: [t1] })).toEqual([])
  })

  it('a failed rename removes the temp file and reports goals_file_write_failed', () => {
    const { fs, exporter, logs } = setup({ failRename: true })
    const snap = { goals: [g1], tasks: [] }
    exporter.afterChange(EMPTY, snap)
    expect(fs.files.size).toBe(0)
    expect(exporter.problems(snap)).toEqual([{ goalId: 'g1', code: 'goals_file_write_failed' }])
    expect(logs).toContain('[claude-watcher][goals] code=goals_file_write_failed')
  })

  it('the next good write clears a problem', () => {
    const { fs, exporter } = setup({ dirs: [] })
    const snap = { goals: [g1], tasks: [] }
    exporter.afterChange(EMPTY, snap)
    fs.dirs.add(A)
    const next = { goals: [g1], tasks: [t1] }
    exporter.afterChange(snap, next)
    expect(exporter.problems(next)).toEqual([])
    expect(fs.files.get(fileOf(A))).toContain('Task t1')
  })

  it('a failed removal in a folder nobody saves to reports the orphan', () => {
    const { exporter, orphans, fs } = setup({ failRemove: true })
    const snap = { goals: [g1], tasks: [] }
    exporter.afterChange(EMPTY, snap)
    exporter.afterChange(snap, EMPTY)
    expect(fs.files.has(fileOf(A))).toBe(true)
    expect(orphans).toHaveLength(1)
    expect(exporter.problems(EMPTY)).toEqual([])
  })

  it('a folder gone with its last goal is not a failure', () => {
    const { exporter, orphans, fs } = setup()
    const snap = { goals: [g1], tasks: [] }
    exporter.afterChange(EMPTY, snap)
    fs.dirs.delete(A)
    fs.files.clear()
    exporter.afterChange(snap, EMPTY)
    expect(orphans).toEqual([])
  })

  it('rewrite re-checks a fixed problem and clears it', () => {
    const { fs, exporter } = setup({ dirs: [] })
    const snap = { goals: [g1], tasks: [] }
    exporter.check(snap)
    expect(exporter.problems(snap)).toHaveLength(1)
    fs.dirs.add(A)
    exporter.rewrite(A, snap)
    expect(exporter.problems(snap)).toEqual([])
    expect(fs.files.get(fileOf(A))).toContain('## Goal g1')
    fs.writes.length = 0
    exporter.rewrite(A, snap)
    expect(fs.writes).toEqual([])
  })

  it('a report on a task does not rewrite GOALS.md', () => {
    const { fs, exporter } = setup()
    let n = 0
    const store = createGoalsStore({
      newId: () => `id${++n}`,
      afterChange: (before, after) => exporter.afterChange(before, after)
    })
    const goalId = store.saveGoal({ workspaceId: 'w1', name: 'Ship' }, A).saved.id
    store.setSaveToFile(goalId, true)
    const task = store.saveTask({ workspaceId: 'w1', goalId, title: 'Draft' }).saved
    const writes = fs.writes.length
    expect(writes).toBeGreaterThan(0)
    expect(
      store.reportTask(task.id, {
        at: 9,
        sessionId: 's1',
        sessionName: 'fix api port',
        outcome: 'done',
        evidence: 'the table renders'
      })
    ).toBe('ok')
    expect(fs.writes).toHaveLength(writes)
  })
})
