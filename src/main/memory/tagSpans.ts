// The one tag reader and span cutter for memory's text: the slice cleaner cuts `system-reminder`
// spans with it, and `privateSpans.ts` the private tag. Pure, no I/O, no log (the text is the operator's conversation).

/** A `<name>` tag, opening or closing (a `/` among the spaces after `<`, capture group 1), in any
 *  case, with or without its `>`: the name is not followed by a name character, so `<names` is no
 *  tag, while a cut-off `<name` or one with attributes is. Only spaces and `/` are taken after the
 *  name, so the tag never takes the text after it. Linear on any input: every try starts at a `<`
 *  and scans one run of spaces and `/` on each side of the name.
 *  `name` holds letters and `-` only (it goes into the pattern as written). */
export function spanTag(name: string): RegExp {
  return new RegExp(`<([\\s/]*)${name}(?![\\p{L}\\p{N}_-])[\\s/]*>?`, 'giu')
}

/** Every span between an opening and its closing `tag` cut out, nested ones whole (P3-R2 for
 *  `system-reminder`); `put` is written once where each outermost span opened. An opening tag that
 *  never closes cuts to the end (its `put` stays), and a closing tag with no opening one is cut
 *  alone (no `put`). */
export function cutSpans(text: string, tag: RegExp, put: string): string {
  let kept = ''
  let depth = 0
  let from = 0
  for (const found of text.matchAll(tag)) {
    const closing = (found[1] ?? '').includes('/')
    if (depth === 0) kept += text.slice(from, found.index) + (closing ? '' : put)
    depth = closing ? Math.max(0, depth - 1) : depth + 1
    from = found.index + found[0].length
  }
  return depth === 0 ? kept + text.slice(from) : kept
}
