// Text cleaning and cutting for one-line names (a memory goal's name, a session name in a prompt)
// and for cut text in general. Pure; logs nothing (the text is operator or model text).
import { isLineUnsafe } from './schemas/launch'

/** `text` as one clean line: each control character and each Unicode line or paragraph separator
 *  (`isLineUnsafe`) becomes a space, then the ends are trimmed. */
export function toSafeLine(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    out += cp !== undefined && isLineUnsafe(cp) ? ' ' : ch
  }
  return out.trim()
}

/** `text` cut to at most `max` UTF-16 units, with no ellipsis; never half of a surrogate pair (a
 *  pair at the cut is dropped whole). */
export function cutToUnits(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const last = head.charCodeAt(head.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head
}
