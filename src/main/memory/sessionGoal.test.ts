import { describe, expect, it } from 'vitest'
import { GOAL_NAME_MAX, GoalNameSchema } from '../../shared/schemas/goal'
import { formatDay } from './formatDay'
import { sessionGoalName } from './sessionGoal'

const AT = new Date(2026, 10, 18, 12).getTime()
const DAY = formatDay(AT)

const CASES: [string, string | null, string | null][] = [
  ['control characters', 'Fix\tlogin now\u0007', '/home/u/proj'],
  ['one over the cap', 'a'.repeat(GOAL_NAME_MAX + 1), null],
  ['emoji at the cut', `${'a'.repeat(GOAL_NAME_MAX - 1)}😀`, null],
  ['empty name', '', '/home/u/proj'],
  ['blank name', '  \n ', '/home/u/proj'],
  ['trailing slash', null, '/home/u/proj/'],
  ['long base name', null, `/home/u/${'b'.repeat(200)}`],
  ['base name with a control character', null, '/home/u/pr\u0007oj'],
  ['no folder', null, null],
  ['root folder', null, '/']
]

describe('sessionGoalName', () => {
  it('turns control characters and line separators into spaces', () => {
    expect(sessionGoalName('Fix\tlogin now\u0007', '/p', AT)).toBe('Fix login now')
  })

  it('cuts a name one over GOAL_NAME_MAX to the cap, with no ellipsis', () => {
    expect(sessionGoalName('a'.repeat(GOAL_NAME_MAX + 1), null, AT)).toBe('a'.repeat(GOAL_NAME_MAX))
  })

  it('drops an emoji at the cut whole', () => {
    const name = sessionGoalName(`${'a'.repeat(GOAL_NAME_MAX - 1)}😀`, null, AT)
    expect(name.length).toBeLessThanOrEqual(GOAL_NAME_MAX)
    expect(name).toBe('a'.repeat(GOAL_NAME_MAX - 1))
  })

  it('keeps an emoji that fits whole', () => {
    const name = sessionGoalName(`${'a'.repeat(GOAL_NAME_MAX - 2)}😀b`, null, AT)
    expect(name).toBe(`${'a'.repeat(GOAL_NAME_MAX - 2)}😀`)
  })

  it('an empty name gives the base name of the folder and the day', () => {
    expect(sessionGoalName('', '/home/u/proj', AT)).toBe(`proj ${DAY}`)
    expect(sessionGoalName(null, '/home/u/proj', AT)).toBe(`proj ${DAY}`)
  })

  it('a folder with a trailing / gives its base name', () => {
    expect(sessionGoalName(null, '/home/u/proj/', AT)).toBe(`proj ${DAY}`)
  })

  it('a long base name is cut so the whole name fits', () => {
    const name = sessionGoalName(null, `/home/u/${'b'.repeat(200)}`, AT)
    expect(name.length).toBe(GOAL_NAME_MAX)
    expect(name.endsWith(` ${DAY}`)).toBe(true)
  })

  it('a base name with a control character is cleaned the same way', () => {
    expect(sessionGoalName(null, '/home/u/pr\u0007oj', AT)).toBe(`pr oj ${DAY}`)
  })

  it('no folder, or an empty base name, gives Session and the day', () => {
    expect(sessionGoalName(null, null, AT)).toBe(`Session ${DAY}`)
    expect(sessionGoalName(null, '/', AT)).toBe(`Session ${DAY}`)
  })

  it('every output is a valid goal name', () => {
    for (const [label, name, folder] of CASES) {
      const out = sessionGoalName(name, folder, AT)
      expect(GoalNameSchema.safeParse(out).success, label).toBe(true)
      expect(GoalNameSchema.parse(out), label).toBe(out)
    }
  })
})
