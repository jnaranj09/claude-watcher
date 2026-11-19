// Pure text for a session started from goal tasks (spec 2026-10-19 goals, Claude integration).
// The exact awareness text is the contract the worker reads; these tests pin it verbatim.
import { describe, it, expect } from 'vitest'
import {
  buildWorkerPrompt,
  buildPlannerPrompt,
  taskSessionName,
  joinSystemPrompt,
  PLANNER_LIST_BUDGET_BYTES,
  PLANNER_SESSION_IDS_SHOWN,
  PLANNER_SESSIONS_SHOWN
} from './goalPrompt'
import type { TaskStatus } from '../../shared/schemas/goal'
import { QUESTION_FORMAT_PROMPT, shellQuote } from '../pty/claudeBin'
import { SESSION_NAME_MAX_LENGTH } from '../../shared/schemas/launch'

// A 200-char title (TASK_TITLE_MAX) full of quotes, `$(...)` and backticks. This layer does no
// shell escaping (that is claudeBin's, at spawn; the planner budget only measures with
// `shellQuote`), and only names are cleaned (`promptSafeName`): a title reaches the block unchanged.
const HOSTILE_TITLE = '"$(touch pwned) `id` \' '.repeat(9).slice(0, 200)

describe('buildWorkerPrompt', () => {
  const tasks = [
    { id: 't1', title: 'Write the parser' },
    { id: 't2', title: 'Add the test' }
  ]

  it('names the goal, lists each task with its id, and ends with the mark-done line', () => {
    expect(buildWorkerPrompt({ goalName: 'Ship v2', tasks, markDone: true })).toBe(
      [
        'This session works on goal "Ship v2". Its tasks:',
        '- [t1] Write the parser',
        '- [t2] Add the test',
        'When you finish a task, call the mark_task_done tool with its id.'
      ].join('\n')
    )
  })

  it('with no goal, opens with the tasks-only line', () => {
    expect(buildWorkerPrompt({ goalName: null, tasks, markDone: true })).toBe(
      [
        'This session works on these tasks:',
        '- [t1] Write the parser',
        '- [t2] Add the test',
        'When you finish a task, call the mark_task_done tool with its id.'
      ].join('\n')
    )
  })

  it('a 200-char title with quotes, $(…) and backticks reaches the block byte for byte', () => {
    expect(HOSTILE_TITLE).toHaveLength(200)
    const text = buildWorkerPrompt({
      goalName: 'Ship v2',
      tasks: [{ id: 't1', title: HOSTILE_TITLE }],
      markDone: true
    })
    expect(text).toBe(
      [
        'This session works on goal "Ship v2". Its tasks:',
        `- [t1] ${HOSTILE_TITLE}`,
        'When you finish a task, call the mark_task_done tool with its id.'
      ].join('\n')
    )
  })

  it('with markDone false, has no last line', () => {
    expect(buildWorkerPrompt({ goalName: 'Ship v2', tasks, markDone: false })).toBe(
      [
        'This session works on goal "Ship v2". Its tasks:',
        '- [t1] Write the parser',
        '- [t2] Add the test'
      ].join('\n')
    )
  })

  it('a `"`, `[` or `]` in the goal name becomes `’`, `(` or `)`', () => {
    expect(buildWorkerPrompt({ goalName: 'Fix "a" [x]', tasks, markDone: false })).toBe(
      [
        'This session works on goal "Fix ’a’ (x)". Its tasks:',
        '- [t1] Write the parser',
        '- [t2] Add the test'
      ].join('\n')
    )
  })

  it('a U+2028 or U+2029 in the goal name (operator or memory goal) becomes a space', () => {
    const text = buildWorkerPrompt({ goalName: 'a\u2028b\u2029c', tasks, markDone: false })
    expect(text.split('\n')[0]).toBe('This session works on goal "a b c". Its tasks:')
  })
})

describe('buildPlannerPrompt', () => {
  const tasks = [{ id: 't1', title: 'Write the parser', status: 'open' as const }]

  it('mentions the three planner tools and not mark_task_done', () => {
    const text = buildPlannerPrompt({ goalName: 'Ship v2', tasks, sessions: [] }).text
    expect(text).toContain('list_tasks')
    expect(text).toContain('create_task')
    expect(text).toContain('propose_split')
    expect(text).not.toContain('mark_task_done')
  })

  it('states the goal and lists each task with its status', () => {
    const text = buildPlannerPrompt({ goalName: 'Ship v2', tasks, sessions: [] }).text
    expect(text).toContain('This session plans goal "Ship v2".')
    expect(text).toContain('- [t1] Write the parser (open)')
  })

  it('says nothing starts until the operator accepts the split', () => {
    const text = buildPlannerPrompt({ goalName: 'Ship v2', tasks, sessions: [] }).text
    expect(text).toContain('Nothing starts until the operator accepts the split.')
  })

  it('with no tasks, says the goal has none yet', () => {
    const text = buildPlannerPrompt({ goalName: 'Ship v2', tasks: [], sessions: [] }).text
    expect(text).toContain('The goal has no tasks yet.')
    expect(text).not.toContain('Its tasks now:')
  })
})

type PlannerTask = { id: string; title: string; status: TaskStatus }
type PlannerSession = { name: string | null; id: string; taskIds: string[] }

const plan = (
  tasks: readonly PlannerTask[],
  sessions: readonly PlannerSession[] = [],
  goalName = 'Ship v2'
): { text: string; taskIds: string[]; lines: string[] } => {
  const out = buildPlannerPrompt({ goalName, tasks, sessions })
  return { ...out, lines: out.text.split('\n') }
}

/** The lines between the task header and the fixed text: task lines, then the session list. */
const listLines = (lines: readonly string[]): string[] =>
  lines.slice(
    lines.indexOf('Its tasks now:') + 1,
    lines.indexOf('Use list_tasks to see the tasks again when they change.')
  )

describe('buildPlannerPrompt: sessions that worked on the tasks', () => {
  const tasks: PlannerTask[] = [
    { id: 't1', title: 'Write the parser', status: 'open' },
    { id: 't2', title: 'Add the test', status: 'done' }
  ]

  it('lists each session after the task lines: quoted name, id, task ids joined by ", "', () => {
    const { text, taskIds } = plan(tasks, [
      { name: 'build', id: 's-new', taskIds: ['t2', 't1'] },
      { name: 'docs', id: 's-old', taskIds: ['t1'] }
    ])
    expect(text).toBe(
      [
        'This session plans goal "Ship v2".',
        'Its tasks now:',
        '- [t1] Write the parser (open)',
        '- [t2] Add the test (done)',
        'Sessions that worked on these tasks:',
        '- "build" [s-new]: t2, t1',
        '- "docs" [s-old]: t1',
        'Use list_tasks to see the tasks again when they change.',
        'Help the operator write the tasks with create_task. When the operator is ready, call propose_split with groups of task ids. One group becomes one session: group small related tasks together, and give each big task its own group.',
        'Nothing starts until the operator accepts the split.'
      ].join('\n')
    )
    expect(taskIds).toEqual(['t1', 't2'])
  })

  it("keeps the order it is given (goalSessionOrder's)", () => {
    const { lines } = plan(tasks, [
      { name: 'z', id: 's-z', taskIds: ['t1'] },
      { name: 'a', id: 's-a', taskIds: ['t2'] }
    ])
    expect(listLines(lines).slice(3)).toEqual(['- "z" [s-z]: t1', '- "a" [s-a]: t2'])
  })

  it('a session with no name gets the no-longer-listed line', () => {
    const { lines } = plan(tasks, [{ name: null, id: 's1', taskIds: ['t1'] }])
    expect(lines).toContain('- (no longer listed) [s1]: t1')
  })

  it('a `"`, `[` or `]` in a session name or the goal name becomes `’`, `(` or `)`', () => {
    const { lines } = plan(
      tasks,
      [{ name: 'say "hi" [s2]', id: 's1', taskIds: ['t1'] }],
      'Fix "a" [x]'
    )
    expect(lines[0]).toBe('This session plans goal "Fix ’a’ (x)".')
    expect(lines).toContain('- "say ’hi’ (s2)" [s1]: t1')
  })

  it('a U+2028 or U+2029 in a session name or the goal name becomes a space', () => {
    const { lines } = plan(
      tasks,
      [{ name: 'a\u2028b\u2029c', id: 's1', taskIds: ['t1'] }],
      'g\u2029h'
    )
    expect(lines[0]).toBe('This session plans goal "g h".')
    expect(lines).toContain('- "a b c" [s1]: t1')
  })

  it(`lists at most ${PLANNER_SESSIONS_SHOWN} sessions, the first ones`, () => {
    const sessions = Array.from({ length: PLANNER_SESSIONS_SHOWN + 5 }, (_, i) => ({
      name: `s${i}`,
      id: `id${i}`,
      taskIds: ['t1']
    }))
    const shown = listLines(plan(tasks, sessions).lines).slice(3)
    expect(shown).toHaveLength(PLANNER_SESSIONS_SHOWN)
    expect(shown[0]).toBe('- "s0" [id0]: t1')
    expect(shown.at(-1)).toBe(
      `- "s${PLANNER_SESSIONS_SHOWN - 1}" [id${PLANNER_SESSIONS_SHOWN - 1}]: t1`
    )
  })

  it(`names at most ${PLANNER_SESSION_IDS_SHOWN} task ids on one line, the first ones`, () => {
    const many: PlannerTask[] = Array.from({ length: PLANNER_SESSION_IDS_SHOWN + 5 }, (_, i) => ({
      id: `t${i}`,
      title: 'x',
      status: 'open'
    }))
    const ids = many.map((t) => t.id)
    const { lines } = plan(many, [{ name: 'build', id: 's1', taskIds: ids }])
    expect(lines).toContain(`- "build" [s1]: ${ids.slice(0, PLANNER_SESSION_IDS_SHOWN).join(', ')}`)
  })

  it('no list when no session worked on the tasks, or none on a listed task', () => {
    expect(plan(tasks).text).not.toContain('Sessions that worked on these tasks:')
    const other = plan(tasks, [{ name: 'x', id: 's1', taskIds: ['gone'] }]).text
    expect(other).not.toContain('Sessions that worked on these tasks:')
    expect(other).not.toContain('[s1]')
  })
})

// The budget is measured as the spec says: each line quoted by `shellQuote`, in UTF-8, plus its
// newline. All-apostrophe titles cost 4 bytes per character quoted and `€` 3 bytes.
const cost = (line: string): number => Buffer.byteLength(shellQuote(line)) + 1
const taskLine = (t: PlannerTask): string => `- [${t.id}] ${t.title} (${t.status})`
const APOSTROPHES = "'".repeat(200)
const WIDE = '€'.repeat(200)

/** Open tasks whose lines cost exactly `bytes` together: all-apostrophe and 3-byte titles, then
 *  one filler of `€` and `a` that takes the rest. */
function tasksCosting(bytes: number): PlannerTask[] {
  const out: PlannerTask[] = []
  let left = bytes
  for (let i = 0; ; i++) {
    const id = `t${String(i).padStart(3, '0')}`
    const full: PlannerTask = { id, title: i % 2 === 0 ? APOSTROPHES : WIDE, status: 'open' }
    if (left >= cost(taskLine(full)) + 1000) {
      out.push(full)
      left -= cost(taskLine(full))
      continue
    }
    const rest = left - cost(taskLine({ id, title: '', status: 'open' }))
    const title = '€'.repeat(Math.floor(rest / 3)) + 'a'.repeat(rest % 3)
    out.push({ id, title, status: 'open' })
    return out
  }
}

const totalCost = (lines: readonly string[]): number => lines.reduce((a, l) => a + cost(l), 0)

describe('buildPlannerPrompt: the list budget', () => {
  it('task lines that fill the budget exactly are all kept, with no more-tasks line', () => {
    const tasks = tasksCosting(PLANNER_LIST_BUDGET_BYTES)
    expect(totalCost(tasks.map(taskLine))).toBe(PLANNER_LIST_BUDGET_BYTES)
    const { lines, taskIds } = plan(tasks)
    expect(listLines(lines)).toEqual(tasks.map(taskLine))
    expect(taskIds).toEqual(tasks.map((t) => t.id))
  })

  it('one byte over: the last task is dropped and the more-tasks line follows the kept ones', () => {
    const tasks = tasksCosting(PLANNER_LIST_BUDGET_BYTES + 1)
    const { lines, taskIds } = plan(tasks)
    const kept = tasks.slice(0, -1)
    expect(listLines(lines)).toEqual([...kept.map(taskLine), '- 1 more tasks: call list_tasks.'])
    expect(totalCost(listLines(lines))).toBeLessThanOrEqual(PLANNER_LIST_BUDGET_BYTES)
    expect(taskIds).toEqual(kept.map((t) => t.id))
  })

  it('done tasks are dropped first, the last one first, and the rest stay in array order', () => {
    const tasks = tasksCosting(PLANNER_LIST_BUDGET_BYTES + 1).map((t, i) =>
      i === 1 || i === 3 ? { ...t, status: 'done' as const } : t
    )
    const { lines, taskIds } = plan(tasks)
    const kept = tasks.filter((_, i) => i !== 3)
    expect(listLines(lines)).toEqual([...kept.map(taskLine), '- 1 more tasks: call list_tasks.'])
    expect(taskIds).toEqual(kept.map((t) => t.id))
  })

  it('the more-tasks line is counted: a drop that frees less than it costs drops one more', () => {
    const tiny: PlannerTask = { id: 'tz', title: 'x', status: 'open' }
    expect(cost(taskLine(tiny))).toBeLessThan(cost('- 1 more tasks: call list_tasks.'))
    const tasks = [...tasksCosting(PLANNER_LIST_BUDGET_BYTES + 1 - cost(taskLine(tiny))), tiny]
    const { lines, taskIds } = plan(tasks)
    const kept = tasks.slice(0, -2)
    expect(listLines(lines)).toEqual([...kept.map(taskLine), '- 2 more tasks: call list_tasks.'])
    expect(taskIds).toEqual(kept.map((t) => t.id))
  })

  it('session lines go before task lines: a full budget lists every task and no session', () => {
    const tasks = tasksCosting(PLANNER_LIST_BUDGET_BYTES)
    const { lines, taskIds } = plan(tasks, [{ name: "it's", id: 's1', taskIds: ['t000'] }])
    expect(listLines(lines)).toEqual(tasks.map(taskLine))
    expect(lines).not.toContain('Sessions that worked on these tasks:')
    expect(taskIds).toEqual(tasks.map((t) => t.id))
  })

  it('a session line that does not fit is skipped and the next one is tried', () => {
    const long = `- "${"'".repeat(60)}" [s-long]: t000`
    const short = '- "€€" [s-short]: t000'
    const tasks = tasksCosting(PLANNER_LIST_BUDGET_BYTES - cost(short))
    const { lines } = plan(tasks, [
      { name: "'".repeat(60), id: 's-long', taskIds: ['t000'] },
      { name: '€€', id: 's-short', taskIds: ['t000'] }
    ])
    expect(cost(long)).toBeGreaterThan(cost(short))
    expect(listLines(lines)).toEqual([
      ...tasks.map(taskLine),
      'Sessions that worked on these tasks:',
      short
    ])
  })

  it('a session whose tasks were all cut is dropped; another names only the kept ids', () => {
    const tasks = tasksCosting(PLANNER_LIST_BUDGET_BYTES + 1)
    const cut = tasks.at(-1)?.id ?? ''
    const { lines, taskIds } = plan(tasks, [
      { name: 'only-cut', id: 's-cut', taskIds: [cut] },
      { name: 'both', id: 's-both', taskIds: [cut, 't000'] }
    ])
    expect(taskIds).not.toContain(cut)
    expect(lines.join('\n')).not.toContain('[s-cut]')
    expect(lines).toContain('- "both" [s-both]: t000')
  })
})

describe('taskSessionName', () => {
  it('a single task is its own title', () => {
    expect(taskSessionName(['Write the parser'])).toBe('Write the parser')
  })

  it('several tasks: the first title plus " +<the rest>"', () => {
    expect(taskSessionName(['Write the parser', 'Add the test', 'Docs'])).toBe(
      'Write the parser +2'
    )
  })

  it('cuts a long first title with … so the name is exactly the max length', () => {
    const name = taskSessionName(['a'.repeat(70), 'b'])
    expect(name).toHaveLength(SESSION_NAME_MAX_LENGTH)
    expect(name).toBe('a'.repeat(56) + '… +1')
    expect(name.endsWith('… +1')).toBe(true)
  })

  it('a title that fits, with its suffix, is not cut', () => {
    const title = 'a'.repeat(SESSION_NAME_MAX_LENGTH - ' +1'.length)
    expect(taskSessionName([title, 'b'])).toBe(title + ' +1')
  })

  it('a 200-char title, alone or with a suffix, fits the max length and ends with …', () => {
    expect(HOSTILE_TITLE).toHaveLength(200)
    const alone = taskSessionName([HOSTILE_TITLE])
    expect(alone.length).toBeLessThanOrEqual(SESSION_NAME_MAX_LENGTH)
    expect(alone.endsWith('…')).toBe(true)
    const counted = taskSessionName([HOSTILE_TITLE, 'b'])
    expect(counted.length).toBeLessThanOrEqual(SESSION_NAME_MAX_LENGTH)
    expect(counted.endsWith('… +1')).toBe(true)
  })

  it('does not put a space before the … when the cut lands after a word', () => {
    // Index 55 is a space and the cut keeps it; trimEnd drops it, so the name reads "aaa… +1".
    const title = 'a'.repeat(55) + ' ' + 'b'.repeat(10)
    expect(taskSessionName([title, 'x'])).toBe('a'.repeat(55) + '… +1')
  })

  it('does not leave half of a surrogate pair at the cut', () => {
    // The emoji starts at index 55; a plain cut at 56 would keep its high surrogate alone.
    const title = 'a'.repeat(55) + '\u{1F600}' + 'b'.repeat(10)
    expect(taskSessionName([title, 'x'])).toBe('a'.repeat(55) + '… +1')
  })

  it('no titles gives an empty name', () => {
    expect(taskSessionName([])).toBe('')
  })
})

describe('joinSystemPrompt', () => {
  it('joins the non-empty parts with a blank line', () => {
    expect(joinSystemPrompt('first', 'second')).toBe('first\n\nsecond')
  })

  it('a null part is dropped: the question prompt alone', () => {
    expect(joinSystemPrompt(QUESTION_FORMAT_PROMPT, null)).toBe(QUESTION_FORMAT_PROMPT)
  })

  it('drops blank and whitespace-only parts', () => {
    expect(joinSystemPrompt('a', '', '   ', 'b')).toBe('a\n\nb')
  })

  it('all parts empty gives null', () => {
    expect(joinSystemPrompt()).toBeNull()
    expect(joinSystemPrompt(null, '', ' ')).toBeNull()
  })
})
