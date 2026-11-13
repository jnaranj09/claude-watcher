// The words the operator sees for a thing the app names in more than one place (technical-taste
// §4 "Same thing, same word"). Every control that names the thing reads it from here, so two
// controls can never drift apart, and a rename is one edit that every place follows.
// `copyTerms.guard.test.ts` fails when one of these strings is typed by hand in another file.

/** A plain `$SHELL` beside claude: the card's shell pane. */
export const SHELL_TERMS = {
  label: 'Shell',
  open: 'Open shell',
  hide: 'Hide shell',
  resize: 'Resize shell pane',
  openFailedSession: 'Could not open a shell for this session.'
} as const

/** A pinned template or shortcut: sorts first in every list (spec 2026-10-13-favorites). */
export const FAVORITE_TERMS = {
  /** The toggle's name (`Pin <name>`, `aria-pressed` says whether it is on). */
  label: 'Pin',
  /** The tooltip on a pinned row's toggle: what a click does there. */
  unpin: 'Unpin',
  /** The expander's mark on a pinned row, for assistive tech. */
  marker: 'Pinned',
  updateFailed: 'Could not update pin.'
} as const

/** What a session's claude loaded, per its bridge mod (spec 2026-10-18 §5): the focused header's
 *  button, the dialog's title, and its page of the slash commands claude loaded (its own owner:
 *  Memory's `Commands`, shell commands that worked, is a different thing that shares the word). */
export const CONTEXT_TERMS = {
  label: 'Context',
  open: 'See what Claude loaded for this session',
  commands: 'Commands'
} as const

/** Goals and tasks, planned in the header's Goals sheet (spec 2026-10-19-goals). */
export const GOAL_TERMS = {
  label: 'Goals',
  /** The filter bar's type row and the pill's first word. */
  filterLabel: 'Goal',
  newGoal: '+ New goal',
  newTask: '+ New task',
  /** The tasks with no goal (the code calls them loose): the sheet's first rail row, open on
   *  every open of the sheet, and their group in the focused view's task panel. */
  daily: 'Daily tasks',
  saveGoalFailed: 'Could not save goal.',
  saveTaskFailed: 'Could not save task.',
  /** A goal's `GOALS.md` (spec 2026-10-29): the switch, its hint, its problem's retry, and the
   *  toast when a change left the file behind. */
  saveToFile: 'Save to GOALS.md',
  saveToFileHint: 'Keeps this goal and its tasks in GOALS.md in its folder, for source control.',
  tryAgain: 'Try again',
  fileNotUpdated: (reason: string): string => `Saved, but GOALS.md was not updated. ${reason}`,
  /** A goal made before folders were required: it starts nothing until it has one. */
  noFolderYet: 'No folder yet. Choose one to start sessions.',
  /** The Goals sheet's task row: its ▸ / ▾ toggle (with the title after it) and its edit field. */
  showFullText: 'Show full text',
  hideFullText: 'Hide full text',
  taskTitle: 'Task title',
  /** The focused view's task panel: its bar toggle and the menu that links a task to the session. */
  tasks: 'Tasks',
  resizeTasks: 'Resize task panel',
  linkTask: 'Link task',
  linkTaskFailed: 'Could not link task.',
  unlinkTaskFailed: 'Could not unlink task.',
  nothingToLink: 'No open tasks to link.',
  /** The Goals sheet's side of the same link: an open task picks a live session. */
  linkSession: 'Link session',
  noSessionsToLink: 'No live sessions to link.',
  noneLinked: 'No tasks linked to this session.',
  /** Starting sessions from tasks: the button, its one switch, and its refusal line. */
  startSession: 'Start session',
  markDone: 'Claude can mark tasks done',
  startFailed: 'Could not start sessions.',
  sessionStarted: 'Session started.',
  sessionsStarted: 'Sessions started.',
  /** "Plan with Claude": the button, its success line and its refusals. */
  planWithClaude: 'Plan with Claude',
  plannerStarted: 'Planner started.',
  planFailed: 'Could not plan with Claude.',
  planNeedsStatus: 'Could not plan with Claude: session status is off.',
  /** A planner's proposal under the goal's tasks: one row per session. */
  proposal: 'Proposed sessions',
  proposalRow: (n: number): string => `Session ${n}`,
  moveTask: (title: string): string => `Move ${title}`,
  removeRow: (n: number): string => `Remove session ${n}`,
  accept: 'Accept',
  reject: 'Reject',
  rejectFailed: 'Could not reject the proposal.'
} as const

/** A default folder on a workspace or a goal: the field's label and its controls (a goal's folder
 *  is never cleared, so only a workspace offers `Clear`). */
export const FOLDER_TERMS = {
  label: 'Default folder',
  choose: 'Choose…',
  clear: 'Clear'
} as const

/** Rows checked for a bulk action: the Active sessions page's bulk bar and the Goals sheet's
 *  start bar. */
export const SELECTION_TERMS = {
  count: (n: number): string => `${n} selected`
} as const

/** Memory (spec 2026-11-11 memory §8, phase 2 addendum): the ☰ row and the dialog's title, its
 *  pages, the header's stale switch, the marker (and filter) on an item whose session was deleted,
 *  and the three Settings rows that say when and with which model a session's memory is saved. */
export const MEMORY_TERMS = {
  label: 'Memory',
  specifics: 'Specifics',
  facts: 'Facts',
  episodes: 'Episodes',
  commands: 'Commands',
  showStale: 'Show stale',
  sessionDeleted: 'Session deleted',
  checkpoint: 'Memory checkpoint',
  saveTasks: 'Save open work as tasks',
  model: 'Memory model'
} as const

/** A thing's earlier versions and the way back to one: Context's instruction files and Memory's
 *  items. */
export const HISTORY_TERMS = {
  history: 'History',
  restore: 'Restore this version',
  confirmRestore: 'Confirm restore',
  versionGone: 'That version is no longer in the history.'
} as const
