// Tags — the Tags dialog's copy. A .ts file: react-refresh allows only component exports in a .tsx.
import type { TagColor } from '../../../../shared/schemas/tag'

export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  slate: 'Slate',
  blue: 'Blue',
  green: 'Green',
  amber: 'Amber',
  violet: 'Violet',
  rose: 'Rose'
}

const ERROR_COPY: Record<string, string> = {
  tag_name_taken: 'A tag with that name already exists where this one would show.',
  tag_in_use: 'A rule uses this tag. Change or delete that rule first.',
  tag_not_found: 'That tag no longer exists.'
}
const FALLBACK_ERROR = 'Something went wrong. Try again.'

/** Electron wraps a thrown handler error as "Error invoking remote method '…': Error: <code>", so
 *  the code is matched as a substring (the same verified behaviour as templateErrorMessage). NEVER
 *  render the raw message. */
export function tagErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : ''
  for (const [code, copy] of Object.entries(ERROR_COPY)) if (text.includes(code)) return copy
  return FALLBACK_ERROR
}
