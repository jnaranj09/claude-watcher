// Memory — the dialog's words (spec 2026-11-11 memory, `## Copy`; the lines the spec has no row
// for are this dialog's own, in the app's voice). Copy maps from a CODE inside Electron's wrapped
// rejection, never from its text (design.md Feedback). A .ts file: react-refresh allows only
// component exports in a .tsx.
import { MEMORY_ERROR, MEMORY_LIMITS, type MemoryWriter } from '../../../../shared/schemas/memory'
import { STORE_WRITE_FAILED } from '../../../../shared/schemas/storageHealth'
import { HISTORY_TERMS, MEMORY_TERMS } from '../../copy/terms'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'

export const MEMORY_COPY = {
  saved: 'Memory saved.',
  deleted: 'Memory deleted.',
  restored: 'Restored.',
  saveFailed: 'Could not save memory.',
  deleteFailed: 'Could not delete memory.',
  restoreFailed: 'Could not restore memory.',
  loadFailed: 'Could not load memory.',
  empty: 'Nothing saved yet. Memory fills as sessions run.',
  noMatches: 'No matches',
  onlyStale: 'Every item here is stale. Turn on Show stale to see them.',
  placeholder: 'Select an item on the left, or create a new one.',
  // Episodes and Commands have no `+ New` (design.md: then the sentence drops "or create…").
  episodePlaceholder: 'Select an episode on the left.',
  commandPlaceholder: 'Select a command on the left.',
  episodesEmpty: 'No episodes yet. A session leaves one when it ends.',
  commandsEmpty: 'No commands yet. Commands that worked in a session are listed here.',
  searchCommands: 'Search commands',
  commandDeleted: 'Command deleted.',
  commandDeleteFailed: 'Could not delete command.',
  /** An episode's end (the Past page's `Ended`). */
  ended: 'Ended',
  lastRun: 'Last run',
  openSource: 'Open source',
  loading: 'Loading…',
  offTitle: 'Memory is off.',
  // Names the Settings category and its row by their own word (`MEMORY_TERMS.label`, both).
  offDetail: `Sessions start without it and save nothing. Turn it on in Settings, under ${MEMORY_TERMS.label}.`,
  showMore: 'Show more',
  search: 'Search',
  key: 'Key',
  value: 'Value',
  title: 'Title',
  body: 'Body',
  check: 'Check',
  checkPlaceholder: 'How to see it again',
  global: 'Global',
  basis: 'Basis',
  lastSeen: 'Last seen',
  originSession: 'Origin session',
  folder: 'Folder',
  tags: 'Tags',
  workspace: 'Workspace',
  markStale: 'Mark stale',
  markActive: 'Mark active',
  /** Mark stale / Mark active took: the button says so in place (its label then flips). */
  marked: '✓ Saved',
  stale: 'Stale',
  /** The row marker of a specific that holds the same value as another one. */
  sameValue: 'Same value',
  /** The form's label over the other items that hold the same value. */
  sameValueAs: 'Same value as',
  /** The hint under them. */
  sameValueHint: 'If one of them is out of date, mark it stale.',
  pickVersion: 'Pick a version to compare it with the text now.',
  currentVersion: 'This is the text now.',
  reason: (why: string): string => `Reason: ${why}`,
  /** Twins past the five the form names: `2 more`. */
  moreTwins: (n: number): string => `${n} more`,
  /** A twin button's tooltip: what a click does, and the key in full. */
  openTwin: (key: string): string => `Open ${key}`,
  /** How many times a command ran: `1 run`, `3 runs`. */
  runs: (n: number): string => (n === 1 ? '1 run' : `${n} runs`),
  /** A History version's age and who wrote it: `2 d ago, by Claude`. */
  versionWhen: (age: string, by: MemoryWriter): string => `${age}, by ${WRITER_WORD[by]}`
} as const

/** Who wrote a version, in plain words: a session's claude, the end-of-session save, the operator. */
const WRITER_WORD: Readonly<Record<MemoryWriter, string>> = {
  agent: 'Claude',
  extract: 'Claude at session end',
  operator: 'you'
}

const ERROR_COPY: Readonly<Record<string, string>> = {
  [MEMORY_ERROR.notFound]: 'That memory no longer exists.',
  [MEMORY_ERROR.versionNotFound]: HISTORY_TERMS.versionGone,
  [MEMORY_ERROR.unavailable]: 'Memory is not available. Reopen the app to try again.',
  [MEMORY_ERROR.readFailed]: MEMORY_COPY.loadFailed,
  [STORE_WRITE_FAILED]: STORE_WRITE_FAILED_COPY
}

/** What a refused memory call shows: the code's sentence, else `fallback` (the action's own
 *  `Could not … memory.`). Electron wraps a handler's throw as "Error invoking remote method '…':
 *  Error: <code>", so the code is matched as a substring. NEVER the raw message. */
export function memoryErrorCopy(err: unknown, fallback: string): string {
  const text = err instanceof Error ? err.message : ''
  for (const [code, copy] of Object.entries(ERROR_COPY)) if (text.includes(code)) return copy
  return fallback
}

/** Why Save is greyed, by the first Zod issue's field (the draft's PATH, never the message). */
export const FIELD_HINT: Readonly<Record<string, string>> = {
  key: `Key must be 1–${MEMORY_LIMITS.specificKey} characters on one line.`,
  value: `Value must be 1–${MEMORY_LIMITS.specificValue} characters on one line.`,
  title: `Title must be 1–${MEMORY_LIMITS.factTitle} characters on one line.`,
  body: `Body must be 1–${MEMORY_LIMITS.factBody.toLocaleString('en-US')} characters.`,
  check: `Check must be at most ${MEMORY_LIMITS.check} characters on one line.`
}
