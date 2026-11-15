// The one line a memory key gets wherever it is listed: the index's groups and at use (spec
// 2026-11-14 memory context index §2). A specific shows its value whole up to
// `MEMORY_LIMITS.inlineValueChars` characters, cut with `…` and its length after that, or not at
// all when it looks like a secret (`valueHidden`); a fact shows its title and the length of its
// body, never the body. Then the day it was last seen, its basis, `check` and `session deleted`
// marks, and the first `MEMORY_LIMITS.shortIdChars` characters of its id (the whole id when
// another item in scope starts the same way). Key, title and value go through `oneLine` first; the
// composed line through `wrapperSafe` (P3-C15). Characters are code points, so a cut never splits
// a pair. Memory text is sensitive: this module logs nothing.
import { MEMORY_LIMITS } from '../../shared/schemas/memory'
import { hasSecret, namesSecret } from './extract/secretScan'
import { formatDay } from './formatDay'
import type { KeyRow } from './memoryRows'
import { holdsPrivate } from './privateSpans'
import { oneLine, wrapperSafe } from './promptText'

function shortIdOf(id: string): string {
  return id.slice(0, MEMORY_LIMITS.shortIdChars)
}

/** A value the line does not show: a secret pattern in the value or in `<key> = <value>`, a
 *  secret name in the key, or a `<private>` tag in either. */
function valueHidden(key: string, value: string): boolean {
  return (
    hasSecret(value) ||
    hasSecret(`${key} = ${value}`) ||
    namesSecret(key) ||
    holdsPrivate(key) ||
    holdsPrivate(value)
  )
}

/** `whole`: a specific whose whole value the line shows and that has no check. */
export function keyLine(
  row: KeyRow,
  clashes: ReadonlySet<string>
): { text: string; whole: boolean } {
  const short = shortIdOf(row.id)
  const id = clashes.has(short) ? row.id : short
  const marks = `${row.hasCheck ? ' · check' : ''}${row.originDeletedAt === null ? '' : ' · session deleted'}`
  const head = oneLine(row.head)
  const text = oneLine(row.body)
  const chars = [...text]
  const seen = `seen ${formatDay(row.lastSeenAt)}, ${row.basis}`
  const line = (middle: string): string => wrapperSafe(`- ${middle}${marks} id=${id}`)
  if (row.kind === 'fact') {
    return { text: line(`${head} (fact, ${chars.length} chars, ${seen})`), whole: false }
  }
  if (valueHidden(head, text)) {
    return {
      text: line(`${head} (value not shown, ${chars.length} chars, ${seen})`),
      whole: false
    }
  }
  if (chars.length <= MEMORY_LIMITS.inlineValueChars) {
    return { text: line(`${head} = ${text} (${seen})`), whole: !row.hasCheck }
  }
  const cut = chars.slice(0, MEMORY_LIMITS.inlineValueChars).join('')
  return { text: line(`${head} = ${cut}… (${chars.length} chars, ${seen})`), whole: false }
}
