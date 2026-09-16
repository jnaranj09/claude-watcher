// The placeholder expander — the PURE half, shared by the renderer's shortcut box and the
// programmatic API's create-from-template command. No React, no DOM, no store, no window.
import { PLACEHOLDER_RE, scanPlaceholders } from '../schemas/shortcut'

/** The expanded text cap. Larger than the 500-char phrase cap on purpose: values are appended. */
export const EXPANDED_TEXT_MAX_LENGTH = 2000

export type ExpandError =
  | { code: 'unknown_alias'; alias: string }
  | { code: 'missing_arg'; index: number }
  | { code: 'too_long' }
  | { code: 'control_char' }

export type ExpandResult = { ok: true; value: string } | { ok: false; error: ExpandError }

/** Fill `$1..$9`, `$*` and `$$` in `text` from `args`. Fails closed on a missing value. */
export function expand(text: string, args: readonly string[]): ExpandResult {
  // TWO control-character policies, because the two inputs are not equally trusted. This ONE
  // function serves the renderer's pty phrase and the API's multi-line template prompt: an ARG
  // VALUE is untrusted (typed into the expander box, or POSTed to the API) and is rejected for
  // ANY control char, `\n` included — the renderer types the result into a pty, where a newline
  // SUBMITS. The TEXT is app-authored, and the prompt's own schema (InitialPromptSchema) already
  // bans every control char except `\n`, so the RESULT is checked for every one but `\n`.
  for (const value of args) {
    if (/\p{Cc}/u.test(value)) return { ok: false, error: { code: 'control_char' } }
  }
  const { numbers } = scanPlaceholders(text)
  for (const n of [...numbers].sort((a, b) => a - b)) {
    if (args[n - 1] === undefined) return { ok: false, error: { code: 'missing_arg', index: n } }
  }
  const rest = args.filter((_, i) => !numbers.has(i + 1)).join(' ')
  const value = text.replace(PLACEHOLDER_RE, (_m, tok: string) => {
    if (tok === '$') return '$'
    if (tok === '*') return rest
    return args[Number(tok) - 1] ?? ''
  })
  if (/(?!\n)\p{Cc}/u.test(value)) return { ok: false, error: { code: 'control_char' } }
  if (value.length > EXPANDED_TEXT_MAX_LENGTH) return { ok: false, error: { code: 'too_long' } }
  return { ok: true, value }
}
