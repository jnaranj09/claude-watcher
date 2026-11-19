// The name of a session's memory goal: the goal memory makes for a session when its first task is
// written (`goals.ts` `addTaskFromExtraction`). Session names and folders are SENSITIVE (operator
// text, paths) and are never logged. Pure; always returns a name `GoalNameSchema` accepts.
import { posix } from 'node:path'
import { GOAL_NAME_MAX } from '../../shared/schemas/goal'
import { cutToUnits, toSafeLine } from '../../shared/textCut'
import { formatDay } from './formatDay'

/** The session's name, cleaned to one line and cut to `GOAL_NAME_MAX`. With no name: the folder's
 *  base name and the day of `at` (`proj 2026-11-18`); with no folder either: `Session <day>`. */
export function sessionGoalName(
  sessionName: string | null,
  folder: string | null,
  at: number
): string {
  const name = cutToUnits(toSafeLine(sessionName ?? ''), GOAL_NAME_MAX).trimEnd()
  if (name !== '') return name
  const day = formatDay(at)
  const base = folder === null ? '' : toSafeLine(posix.basename(folder))
  const room = GOAL_NAME_MAX - day.length - 1
  const cut = cutToUnits(base, room).trimEnd()
  return cut === '' ? `Session ${day}` : `${cut} ${day}`
}
