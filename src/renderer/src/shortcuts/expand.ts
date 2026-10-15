// Shortcut expander — the PURE half. No React, no DOM, no store, no window. The box
// (components/ExpanderBox) owns the input, the highlight and the port write; this module only
// answers "given this input and these shortcuts, what text comes out (or which error)".
// `expand` and its result/error types are SHARED with the programmatic API (main), so they live
// in `src/shared/prompt/expand.ts`, which this module imports. Its control-char policy is split
// there: any control char in an arg VALUE is rejected (a value is untrusted and the box types
// the result into a pty), the RESULT is checked for every control char but `\n` (the API's
// template prompt is multi-line prose).
import { scanPlaceholders, type Shortcut } from '../../../shared/schemas/shortcut'
import {
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

/**
 * `"HT 1234"` → `{ alias: 'ht', args: ['1234'] }`. Words split on whitespace, with a small shell
 * subset so a value can hold spaces: `"…"` or `'…'` groups (the other quote kind is literal
 * inside), `\` escapes the next character anywhere, `""` is a real empty value, and quoted and bare
 * parts of one word join (`a"b c"` → `ab c`). An unclosed quote takes the rest of the line — the
 * box parses on every keystroke, so a half-typed quote is never an error.
 */
export function parseInput(raw: string): ParsedInput {
  const words: string[] = []
  let word = ''
  let inWord = false // true once the word has any part, so `""` still counts as a word
  let quote: '"' | "'" | null = null
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string
    if (ch === '\\' && i + 1 < raw.length) {
      word += raw[++i] as string
      inWord = true
    } else if (quote !== null) {
      if (ch === quote) quote = null
      else word += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      inWord = true
    } else if (/\s/.test(ch)) {
      if (inWord) words.push(word)
      word = ''
      inWord = false
    } else {
      word += ch
      inWord = true
    }
  }
  if (inWord) words.push(word)
  const [first, ...args] = words
  return { alias: (first ?? '').toLowerCase(), args }
}

/**
 * The rows the box lists for a query: exact alias, then alias prefix, then name prefix. Stable
 * within each band, so the caller's order (favorites first, then alias order) carries through.
 * An empty query lists everything.
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

/** A failure only the BOX can hit: the expansion worked, but the terminal cannot take it. A
 *  multi-line phrase goes in as a bracketed paste; a session without bracketed paste would read
 *  each newline as Enter and submit, so the box refuses instead. */
export type ExpanderError = ExpandError | { code: 'multiline_unsupported' }

/**
 * Tab in the box: the first word becomes `alias`, the values already typed stay. A trailing space
 * is added when nothing follows, so the operator types the first value next.
 */
export function completeAlias(raw: string, alias: string): string {
  const rest = raw.replace(/^\s*\S*/, '')
  return rest === '' ? `${alias} ` : `${alias}${rest}`
}

/** `dp $1 $2` — the alias, then the placeholders the phrase takes in order, `$*` last. */
export function usageFor(shortcut: Shortcut): string {
  const { numbers, rest } = scanPlaceholders(shortcut.text)
  const tokens = [...numbers].sort((a, b) => a - b).map((n) => `$${n}`)
  if (rest) tokens.push('$*')
  return [shortcut.alias, ...tokens].join(' ')
}

/** The placeholder reference shown in the Shortcuts form and the phrase editor. */
export const PLACEHOLDER_HELP: readonly { token: string; meaning: string }[] = [
  { token: '$1 $2 … $9', meaning: 'The values you type after the alias, in order.' },
  { token: '$*', meaning: 'Every value no number took, joined by spaces.' },
  { token: '$$', meaning: 'A literal $.' }
]

/** Code → operator copy. The alias is the operator's own word shown back in the UI; nothing
 *  here is logged. */
export function expandErrorCopy(error: ExpanderError): string {
  switch (error.code) {
    case 'unknown_alias':
      return `No shortcut named "${error.alias}"`
    case 'missing_arg':
      return `Missing value for $${error.index}`
    case 'too_long':
      return `Result is longer than ${EXPANDED_TEXT_MAX_LENGTH} characters`
    case 'control_char':
      return 'A value contains a control character'
    case 'multiline_unsupported':
      return 'This session cannot take a multi-line phrase'
  }
}
