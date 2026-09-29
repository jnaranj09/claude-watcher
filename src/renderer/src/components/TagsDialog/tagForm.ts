// Tags — the Tags dialog's copy. A .ts file: react-refresh allows only component exports in a .tsx.
import { STORE_WRITE_FAILED } from '../../../../shared/schemas/storageHealth'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import type { TagColor } from '../../../../shared/schemas/tag'
import { usedByRulesCopy } from '../../stores/rulesStore'

export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  slate: 'Slate',
  blue: 'Blue',
  green: 'Green',
  amber: 'Amber',
  violet: 'Violet',
  rose: 'Rose',
  red: 'Red',
  lime: 'Lime',
  teal: 'Teal',
  cyan: 'Cyan',
  indigo: 'Indigo',
  pink: 'Pink'
}

const ERROR_COPY: Record<string, string> = {
  tag_name_taken: 'A tag with that name already exists where this one would show.',
  tag_in_use: 'A rule uses this tag. Change or delete that rule first.',
  tag_not_found: 'That tag no longer exists.',
  [STORE_WRITE_FAILED]: STORE_WRITE_FAILED_COPY
}
const FALLBACK_ERROR = 'Something went wrong. Try again.'

/** Electron wraps a thrown handler error as "Error invoking remote method '…': Error: <code>", so
 *  the code is matched as a substring (the same verified behaviour as templateErrorMessage). NEVER
 *  render the raw message.
 *
 *  `ruleCount` is how many rules use the tag (the caller counts them in the rules projection):
 *  main's `tag_in_use` carries only the code. */
export function tagErrorMessage(err: unknown, ruleCount = 0): string {
  const text = err instanceof Error ? err.message : ''
  if (text.includes('tag_in_use') && ruleCount > 0) return usedByRulesCopy(ruleCount)
  for (const [code, copy] of Object.entries(ERROR_COPY)) if (text.includes(code)) return copy
  return FALLBACK_ERROR
}
