// Shortcut expander — the PURE half. No React, no DOM, no store, no window. The box
// (components/ExpanderBox) owns the input, the highlight and the port write; this module only
// answers "given this input and these shortcuts, what text comes out (or which error)".
// `expand` and its result/error types are SHARED with the programmatic API (main), so they live
// in `src/shared/prompt/expand.ts`; this module re-exports them so the box's call sites and tests
// keep one import. Its control-char policy is split there: any control char in an arg VALUE is
// rejected (a value is untrusted and the box types the result into a pty), the RESULT is checked
// for every control char but `\n` (the API's template prompt is multi-line prose).
import type { Shortcut } from '../../../shared/schemas/shortcut'
import {
  expand,
  EXPANDED_TEXT_MAX_LENGTH,
  type ExpandError,
  type ExpandResult
} from '../../../shared/prompt/expand'

export {
  expand,
  EXPANDED_TEXT_MAX_LENGTH,
  type ExpandError,
  type ExpandResult
} from '../../../shared/prompt/expand'

/** Rows the box shows at most. */
export const EXPANDER_MAX_ROWS = 8

export interface ParsedInput {
  /** The first word, lowercased. '' when the input is blank. */
  alias: string
  /** Every later word, in order. */
  args: string[]
}

/** `"HT 1234"` → `{ alias: 'ht', args: ['1234'] }`. Whitespace-separated, never quoted. */
export function parseInput(raw: string): ParsedInput {
  const words = raw
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
  const [first, ...args] = words
  return { alias: (first ?? '').toLowerCase(), args }
}

/**
 * The rows the box lists for a query: exact alias, then alias prefix, then name prefix. Stable
 * within each band, so main's alias order carries through. An empty query lists everything.
 */
export function matchAliases(query: string, shortcuts: readonly Shortcut[]): Shortcut[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...shortcuts]
  const exact: Shortcut[] = []
  const aliasPrefix: Shortcut[] = []
  const namePrefix: Shortcut[] = []
  for (const s of shortcuts) {
    if (s.alias === q) exact.push(s)
    else if (s.alias.startsWith(q)) aliasPrefix.push(s)
    else if (s.name.toLowerCase().startsWith(q)) namePrefix.push(s)
  }
  return [...exact, ...aliasPrefix, ...namePrefix]
}

/**
 * The ONE call the box makes on Enter. `alias` (the highlighted row) overrides the typed first
 * word, so pressing Enter on a prefix match runs the row the operator is looking at.
 */
export function expandInput(
  raw: string,
  shortcuts: readonly Shortcut[],
  alias?: string
): ExpandResult {
  const parsed = parseInput(raw)
  const key = alias ?? parsed.alias
  const shortcut = shortcuts.find((s) => s.alias === key)
  if (shortcut === undefined) return { ok: false, error: { code: 'unknown_alias', alias: key } }
  return expand(shortcut.text, parsed.args)
}

/** Code → operator copy. The alias is the operator's own word shown back in the UI; nothing
 *  here is logged. */
export function expandErrorCopy(error: ExpandError): string {
  switch (error.code) {
    case 'unknown_alias':
      return `No shortcut named "${error.alias}"`
    case 'missing_arg':
      return `Missing value for $${error.index}`
    case 'too_long':
      return `Result is longer than ${EXPANDED_TEXT_MAX_LENGTH} characters`
    case 'control_char':
      return 'A value contains a control character'
  }
}
