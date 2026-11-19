// Saved text as a model reads it, in the memory index and in the memory tools' results. Saved
// text (some of it extracted from transcripts) must never pose as a line of its own: a heading, a
// rule, or a field of a tool result. Every line break claude may see as one (CR, LF, VT, FF, NEL,
// U+2028, U+2029) ends a line here, and every other control character becomes a space. Nor can it
// open or close a wrapper claude puts around it, or forge the start of a memory block
// (`wrapperSafe`, P3-C1): both helpers below end in it.
// Pure; logs nothing (memory text is sensitive).
import { isControlCodePoint } from '../../shared/schemas/launch'

/** The first words of every block memory adds beside a prompt or after a tool result (phase 3).
 *  Read by a model, and by the slice cleaner, which never lets such a block be evidence. */
export const MEMORY_BLOCK_MARKER = 'Memory (Claude Watcher):'

/** A line break as Unicode counts it: LF, VT, FF, CR, NEL, LINE and PARAGRAPH SEPARATOR. */
function isLineBreak(cp: number): boolean {
  return (cp >= 0x0a && cp <= 0x0d) || cp === 0x85 || cp === 0x2028 || cp === 0x2029
}

/** The lines of `text`: CRLF is one break, every other break ends a line, and every other control
 *  character becomes a space. */
export function linesOf(text: string): string[] {
  const lines: string[] = []
  let line = ''
  let afterCr = false
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    const crlf = afterCr && cp === 0x0a
    afterCr = cp === 0x0d
    if (crlf) continue
    if (isLineBreak(cp)) {
      lines.push(line)
      line = ''
    } else {
      line += isControlCodePoint(cp) ? ' ' : ch
    }
  }
  lines.push(line)
  return lines
}

/** A regular-expression source that matches `text` literally (with the `u` flag). */
const literal = (text: string): string => text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')

/** `system-reminder` with any format character (a zero-width space, a word joiner) between its
 *  letters: a model may still read it as the name. */
const REMINDER_NAME = [...'system-reminder'].map(literal).join('\\p{Cf}*')

/** The `<` of a system-reminder tag, opening or closing: `<`, any run of white space, format
 *  characters and `/`, then the name, in any case. Wider than the slice cleaner's tag (P3-C7 keeps
 *  operator text such as `<system-reminders` as it is there; here a `‹` costs nothing), so every
 *  tag the cleaner cuts is neutralised too. Linear: every try starts at a `<` and scans one run. */
const REMINDER_TAG_OPEN = new RegExp(`<(?=[\\s\\p{Cf}/]*${REMINDER_NAME})`, 'giu')

/** MEMORY_BLOCK_MARKER folded as the slice cleaner folds it: any case, any run of white space or
 *  format characters between its characters (P3-C9). Linear: no character of the marker is white
 *  space or a format character, so each run is scanned once. */
const MARKER = new RegExp(
  [...MEMORY_BLOCK_MARKER]
    .filter((ch) => !/\s/.test(ch))
    .map(literal)
    .join('[\\s\\p{Cf}]*'),
  'giu'
)

/** Saved text a model reads can neither open nor close a wrapper claude puts around it (a recall
 *  block rides inside claude's own `<system-reminder>` text), nor forge the start of a memory block
 *  (P3-C1). The `<` of every system-reminder tag (`REMINDER_TAG_OPEN`) becomes `‹` (U+2039); the
 *  `:` of every MEMORY_BLOCK_MARKER (`MARKER`) becomes `꞉` (U+A789). No other character changes:
 *  `Array<string>` and `<div>` stay as they are, because exact values are the point of memory. */
export function wrapperSafe(text: string): string {
  return text
    .replace(REMINDER_TAG_OPEN, '\u2039')
    .replace(MARKER, (marker) => `${marker.slice(0, -1)}\uA789`)
}

/** A saved text on one line: each line break becomes a space, then `wrapperSafe` (after the join,
 *  so a tag split by a line break is caught). */
export function oneLine(text: string): string {
  return wrapperSafe(linesOf(text).join(' '))
}

/** A multi-line saved text set apart as a block: its lines joined by `\n` through `wrapperSafe`
 *  (P3-C15: a tag or a marker split over two lines is caught), then split again and each indented
 *  by two spaces, so no line of it starts where a field (`basis:`) or a heading starts.
 *  `wrapperSafe` never adds or removes a `\n`, and the indent adds only spaces its patterns span. */
export function indentedBlock(text: string): string[] {
  return wrapperSafe(linesOf(text).join('\n'))
    .split('\n')
    .map((line) => `  ${line}`)
}
