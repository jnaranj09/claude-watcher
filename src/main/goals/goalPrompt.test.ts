// Pure text for a session started from goal tasks (spec 2026-10-19 goals, Claude integration).
// The exact awareness text is the contract the worker reads; these tests pin it verbatim.
import { describe, it, expect } from 'vitest'
import {
  buildWorkerPrompt,
  buildPlannerPrompt,
  taskSessionName,
  joinSystemPrompt
} from './goalPrompt'
import { QUESTION_FORMAT_PROMPT } from '../pty/claudeBin'
import { SESSION_NAME_MAX_LENGTH } from '../../shared/schemas/launch'

// A 200-char title (TASK_TITLE_MAX) full of quotes, `$(...)` and backticks. This layer does no
// escaping: the text must reach the block unchanged (shell quoting is claudeBin's, at spawn).
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
})

describe('buildPlannerPrompt', () => {
  const tasks = [{ id: 't1', title: 'Write the parser', status: 'open' as const }]

  it('mentions the three planner tools and not mark_task_done', () => {
    const text = buildPlannerPrompt({ goalName: 'Ship v2', tasks })
    expect(text).toContain('list_tasks')
    expect(text).toContain('create_task')
    expect(text).toContain('propose_split')
    expect(text).not.toContain('mark_task_done')
  })

  it('states the goal and lists each task with its status', () => {
    const text = buildPlannerPrompt({ goalName: 'Ship v2', tasks })
    expect(text).toContain('This session plans goal "Ship v2".')
    expect(text).toContain('- [t1] Write the parser (open)')
  })

  it('says nothing starts until the operator accepts the split', () => {
    const text = buildPlannerPrompt({ goalName: 'Ship v2', tasks })
    expect(text).toContain('Nothing starts until the operator accepts the split.')
  })

  it('with no tasks, says the goal has none yet', () => {
    const text = buildPlannerPrompt({ goalName: 'Ship v2', tasks: [] })
    expect(text).toContain('The goal has no tasks yet.')
    expect(text).not.toContain('Its tasks now:')
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
