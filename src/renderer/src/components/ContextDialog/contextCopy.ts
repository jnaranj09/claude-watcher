// Context's words (spec 2026-10-18 §5 and its Copy table; the plan's [AGENT] rows for the
// unavailable reasons). Copy maps from a CODE, never from an error's text (design.md Feedback).
import {
  formatVersion,
  MIN_MEMORY_MOD_CLAUDE_VERSION,
  MIN_MOD_CLAUDE_VERSION
} from '../../../../shared/launch/claudeVersion'
import type { ContextRefusalCode, ModSkipReason } from '../../../../shared/ipc/contract'
import type { DropReason, MemoryRecallSkip } from '../../../../shared/schemas/memory'
import { CONTEXT_REFUSAL_CODES } from '../../../../shared/schemas/contextIpc'
import { BRIDGE_MOD_FAILED_COPY, STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import { CONTEXT_TERMS, HISTORY_TERMS, MEMORY_TERMS } from '../../copy/terms'

export type ContextCategoryId =
  | 'instructions'
  | 'skills'
  | 'agents'
  | 'mcp'
  | 'commands'
  | 'hooks'
  | 'plugins'
  | 'memory'

/** The rail's order; the first is where Context opens. */
export const CONTEXT_CATEGORIES: readonly { id: ContextCategoryId; label: string }[] = [
  { id: 'instructions', label: 'Instructions' },
  { id: 'skills', label: 'Skills' },
  { id: 'agents', label: 'Agents' },
  { id: 'mcp', label: 'MCP servers' },
  { id: 'commands', label: CONTEXT_TERMS.commands },
  { id: 'hooks', label: 'Hooks' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'memory', label: MEMORY_TERMS.label }
]

export const FIRST_CONTEXT_CATEGORY: ContextCategoryId = 'instructions'

export const CONTEXT_COPY = {
  waiting: 'Waiting for Claude to report its setup.',
  ended: 'This session has ended.',
  loadFailed: 'Could not load this session’s context.',
  openInEditor: 'Open in editor',
  history: HISTORY_TERMS.history,
  restore: HISTORY_TERMS.restore,
  confirmRestore: HISTORY_TERMS.confirmRestore,
  noVersions: 'No versions yet.',
  pickVersion: 'Pick a version to compare it with the file now.',
  tooLargeForHistory: 'This file is over 1 MB, so no versions are kept.',
  restored: (file: string) => `Restored ${file}.`,
  importedBy: (file: string) => `imported by ${file}`,
  tokens: (n: number) => `${n.toLocaleString('en-US')} tokens`,
  memoryLoadFailed: 'Could not load memory.',
  injected: 'Injected',
  pulled: 'Pulled',
  saved: 'Saved',
  dropped: 'Dropped',
  nothingInjected: 'Nothing injected.',
  /** How recall gave an item while the session ran (memory phase 3): with a prompt, or when claude
   *  opened a file in a folder that has saved keys. */
  withPrompt: 'With a prompt',
  withFile: 'With a file',
  nothingPulled: 'Nothing pulled.',
  nothingSaved: 'Nothing saved.',
  nothingDropped: 'Nothing dropped.',
  injectedSummary: (tokens: number, items: number) =>
    `${tokens.toLocaleString('en-US')} tokens · ${items.toLocaleString('en-US')} ${items === 1 ? 'item' : 'items'}`,
  empty: (what: string) => `Claude listed no ${what}.`
} as const

/** Why extraction dropped a candidate (memory phase 2), in plain words, in `DROP_REASONS` order. */
export const DROP_REASON_COPY: Readonly<Record<DropReason, string>> = {
  evidence_not_found: 'Not found in the transcript',
  secret: 'Held a secret',
  invalid: 'Not valid',
  operator_item: 'You wrote that item',
  tasks_off: 'Tasks are off',
  claude_only: 'Only Claude said it'
}

/** Why a session runs without recall, when the operator did not choose it (memory phase 3).
 *  `setting_off` has no sentence: the operator turned recall off and knows. */
export const MEMORY_RECALL_OFF_COPY: Record<Exclude<MemoryRecallSkip, 'setting_off'>, string> = {
  claude_too_old: `Update claude to ${formatVersion(MIN_MEMORY_MOD_CLAUDE_VERSION)} or newer for memory recall in this session.`,
  mod_not_installed: BRIDGE_MOD_FAILED_COPY
}

export const UNAVAILABLE_COPY: Record<ModSkipReason, string> = {
  claude_too_old: `Update claude to ${formatVersion(MIN_MOD_CLAUDE_VERSION)} or newer to see its context.`,
  mod_not_installed: BRIDGE_MOD_FAILED_COPY,
  listener_down: 'Status is off for this session, so Claude cannot report its context.'
}

/** The refusal's code inside Electron's wrapped rejection, or null. */
export function contextRefusal(err: unknown): ContextRefusalCode | null {
  const text = err instanceof Error ? err.message : ''
  return CONTEXT_REFUSAL_CODES.find((c) => text.includes(c)) ?? null
}

const SHARED: Partial<Record<ContextRefusalCode, string>> = {
  file_missing: 'That file no longer exists.',
  version_not_found: HISTORY_TERMS.versionGone,
  store_write_failed: STORE_WRITE_FAILED_COPY
}

/** What a refused action shows, by action; an unknown failure gets the action's own sentence. */
export function contextErrorCopy(
  action: 'open' | 'list' | 'diff' | 'restore',
  err: unknown,
  file: string
): string {
  const code = contextRefusal(err)
  if (action === 'diff' && code === 'file_too_large') return 'That file is too large to compare.'
  if (code === 'file_runnable') return `${file} can run as a program, so it is not opened.`
  const shared = code === null ? undefined : SHARED[code]
  if (shared !== undefined) return shared
  switch (action) {
    case 'open':
      return `Could not open ${file}.`
    case 'list':
      return `Could not load the history of ${file}.`
    case 'diff':
      return `Could not compare ${file}.`
    case 'restore':
      return `Could not restore ${file}.`
  }
}

/** Claude's tier word with its first letter in upper case (`project` → `Project`); a word the
 *  app does not know is shown as claude sent it. */
export function tierLabel(kind: string): string {
  const known = ['managed', 'user', 'project', 'local', 'memory']
  return known.includes(kind) ? kind.charAt(0).toUpperCase() + kind.slice(1) : kind
}

export const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** `2 KB`, rounded up; under 1 KB shows bytes. */
export function sizeLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.ceil(bytes / 1024)} KB`
}
