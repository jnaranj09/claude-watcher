// Memory — the dialog's words (spec 2026-11-11 memory, `## Copy`; the lines the spec has no row
// for are this dialog's own, in the app's voice). Copy maps from a CODE inside Electron's wrapped
// rejection, never from its text (design.md Feedback). A .ts file: react-refresh allows only
// component exports in a .tsx.
import { MEMORY_ERROR, MEMORY_LIMITS } from '../../../../shared/schemas/memory'
import { STORE_WRITE_FAILED } from '../../../../shared/schemas/storageHealth'
import { HISTORY_TERMS } from '../../copy/terms'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'

/** Main's refusal while it has no memory store (`MEMORY_UNAVAILABLE`, src/main/memory/memoryIpc.ts;
 *  `memoryCopy.test.ts` reads that file and pins the pair). */
export const MEMORY_UNAVAILABLE = 'memory_unavailable'

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
  loading: 'Loading…',
  offTitle: 'Memory is off.',
  offDetail: 'Sessions start without it and save nothing. Turn it on in Settings, under Memory.',
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
  pickVersion: 'Pick a version to compare it with the text now.',
  currentVersion: 'This is the text now.',
  reason: (why: string): string => `Reason: ${why}`
} as const

const ERROR_COPY: Readonly<Record<string, string>> = {
  [MEMORY_ERROR.notFound]: 'That memory no longer exists.',
  [MEMORY_ERROR.versionNotFound]: HISTORY_TERMS.versionGone,
  [MEMORY_UNAVAILABLE]: 'Memory is not available. Reopen the app to try again.',
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
