// Storage health copy (UX-06, UX-07). One sentence per problem, naming the store and what the
// operator has now — never a path (main does not send one) and never a raw code.

import type { StorageProblem, StoreName } from '../../../shared/ipc/contract'

const STORE_LABEL: Record<StoreName, string> = {
  settings: 'settings',
  templates: 'templates',
  shortcuts: 'shortcuts',
  tags: 'tags',
  workspaces: 'workspaces',
  rules: 'rules',
  goals: 'goals',
  past_sessions: 'past sessions',
  bridge_mod: 'Claude mod',
  file_history: 'file history',
  goals_file: 'GOALS.md'
}

/** The bridge mod's install failed (spec 2026-10-18 §1.2): new sessions launch without it, and
 *  Context says the same words for a session that has no report because of it. */
export const BRIDGE_MOD_FAILED_COPY =
  'The app could not set up its Claude mod. Reopen the app to try again.'

/** A goal's `GOALS.md` did not follow a change and no goal is left to show why (its last goal was
 *  deleted, moved or turned off). Not a store file: the sentences below would say the wrong thing. */
export const GOALS_FILE_FAILED_COPY =
  "The app could not update GOALS.md in a goal's folder. Open the goal on the Goals sheet to see why."

export function storageProblemMessage(problem: StorageProblem): string {
  // Not a file of the operator's data: the store-file sentences below would say the wrong thing.
  if (problem.store === 'bridge_mod') return BRIDGE_MOD_FAILED_COPY
  if (problem.store === 'goals_file') return GOALS_FILE_FAILED_COPY
  const what = STORE_LABEL[problem.store]
  switch (problem.code) {
    case 'corrupt_reset':
      return `The ${what} file was damaged, so ${what} started empty. The old file was kept beside it in the data folder, renamed with .corrupt.`
    case 'read_failed':
      return `The ${what} file could not be opened, so ${what} started empty for this run.`
    case 'backup_failed':
      return `The damaged ${what} file could not be backed up before ${what} started empty.`
    case 'write_failed':
      return `Changes to ${what} could not be saved to disk. They last only until Claude Watcher closes.`
  }
}

/** The error-line copy every Manage dialog shows for STORE_WRITE_FAILED (UX-06): the Save or
 *  Delete was undone, so the dialog still shows what is on disk. */
export const STORE_WRITE_FAILED_COPY =
  'Could not save to disk, so nothing changed. Check free space and folder permissions, then try again.'
