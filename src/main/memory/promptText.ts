// Saved text as a model reads it, in the memory index and in the memory tools' results. Saved
// text (some of it extracted from transcripts) must never pose as a line of its own: a heading, a
// rule, or a field of a tool result. Every line break claude may see as one (CR, LF, VT, FF, NEL,
// U+2028, U+2029) ends a line here, and every other control character becomes a space.
// Pure; logs nothing (memory text is sensitive).

/** A line break as Unicode counts it: LF, VT, FF, CR, NEL, LINE and PARAGRAPH SEPARATOR. */
function isLineBreak(cp: number): boolean {
  return (cp >= 0x0a && cp <= 0x0d) || cp === 0x85 || cp === 0x2028 || cp === 0x2029
}

/** C0 and C1 controls (a tab, an escape), checked by code point like `hasControlChar`. */
function isControl(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)
}

/** The lines of `text`: CRLF is one break, every other break ends a line, and every other control
 *  character becomes a space. */
function linesOf(text: string): string[] {
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
      line += isControl(cp) ? ' ' : ch
    }
  }
  lines.push(line)
  return lines
}

/** A saved text on one line: each line break becomes a space. */
export function oneLine(text: string): string {
  return linesOf(text).join(' ')
}

/** A multi-line saved text set apart as a block: each of its lines indented by two spaces, so no
 *  line of it starts where a field (`basis:`) or a heading starts. */
export function indentedBlock(text: string): string[] {
  return linesOf(text).map((line) => `  ${line}`)
}
