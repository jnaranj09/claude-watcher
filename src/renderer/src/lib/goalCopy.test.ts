// The Goals sheet's words for a GOALS.md problem and for a goal with no folder (spec 2026-10-29).
// Codes arrive inside Electron's wrapped message, so the inputs below are wrapped like main's.
import { describe, it, expect } from 'vitest'
import {
  goalFileProblemCopy,
  goalPlanErrorCopy,
  goalStartErrorCopy,
  isFolderCancelled
} from './goalCopy'

const wrapped = (channel: string, code: string): Error =>
  new Error(`Error invoking remote method '${channel}': Error: ${code}`)

describe('goalFileProblemCopy', () => {
  it.each([
    [
      'goals_file_not_ours',
      'GOALS.md in this folder was not made by claude-watcher. Rename or move it, then try again.'
    ],
    ['folder_missing', 'Its folder no longer exists.'],
    [
      'goals_file_write_failed',
      'Could not write GOALS.md. Check free space and folder permissions, then try again.'
    ]
  ] as const)('%s has its sentence', (code, copy) => {
    expect(goalFileProblemCopy(code)).toBe(copy)
  })
})

describe('a goal with no folder', () => {
  it('Start session says to choose a folder', () => {
    expect(goalStartErrorCopy(wrapped('goals:start-sessions', 'goal_folder_missing'))).toBe(
      'No folder yet. Choose one to start sessions.'
    )
  })

  it('Plan with Claude says to choose a folder', () => {
    expect(goalPlanErrorCopy(wrapped('goals:plan', 'goal_folder_missing'))).toBe(
      'No folder yet. Choose one to start sessions.'
    )
  })
})

describe('isFolderCancelled', () => {
  it('is true only for folder_cancelled', () => {
    expect(isFolderCancelled(wrapped('goals:save-goal', 'folder_cancelled'))).toBe(true)
    expect(isFolderCancelled(wrapped('goals:save-goal', 'store_write_failed'))).toBe(false)
  })
})
