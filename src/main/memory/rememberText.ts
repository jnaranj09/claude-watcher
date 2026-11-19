// A `/remember` line as the operator typed it, turned into a memory text (addendum §5). One line
// with a spaced ` = ` after its first character is a specific (key = value) when both parts fit;
// anything else is a fact whose title is its first line. A secret-like text is refused before it
// is split (the phase 2 scan, `extract/secretScan.ts`), and so is a text that holds a private tag
// (`privateSpans.ts`), with the secret's code (the mod's sentence for it is not changed). `\r\n` and
// a lone `\r` become `\n` first (P3-C14). Pure; logs nothing (the text is sensitive).
import { MEMORY_LIMITS, MemoryTextSchema, type MemoryText } from '../../shared/schemas/memory'
import { cutToUnits } from '../../shared/textCut'
import type { RememberRefusal } from '../../shared/schemas/modMemory'
import { hasSecret } from './extract/secretScan'
import { holdsPrivate } from './privateSpans'
import { linesOf } from './promptText'

const SPLIT = ' = '
const ELLIPSIS = '…'

type RememberCode = Extract<
  RememberRefusal,
  'remember_empty' | 'remember_too_long' | 'remember_invalid' | 'remember_secret'
>

/** `text` cut to `max` characters, the last one an ellipsis; never half of a surrogate pair. Also
 *  cuts a recall line (`memoryRecall.ts`). */
export function capped(text: string, max: number): string {
  return text.length <= max ? text : cutToUnits(text, max - ELLIPSIS.length) + ELLIPSIS
}

/** A specific when the one line splits into a key and a value that both fit; else null. The text
 *  is trimmed, so it never starts or ends with the spaces of SPLIT: a SPLIT it holds is above
 *  index 0 and leaves a key and a value of at least one character. */
function asSpecific(text: string): MemoryText | null {
  const at = text.indexOf(SPLIT)
  if (linesOf(text).length !== 1 || at === -1) return null
  const key = text.slice(0, at).trim()
  const value = text.slice(at + SPLIT.length).trim()
  return key.length <= MEMORY_LIMITS.specificKey && value.length <= MEMORY_LIMITS.specificValue
    ? { kind: 'specific', key, value }
    : null
}

export function parseRemember(
  text: string
): { ok: true; text: MemoryText } | { ok: false; code: RememberCode } {
  // P3-C14: Windows line ends (`\r\n`) and a lone `\r` are line breaks; the saved text holds `\n`.
  const trimmed = text.replace(/\r\n?/g, '\n').trim()
  if (trimmed === '') return { ok: false, code: 'remember_empty' }
  if (hasSecret(trimmed) || holdsPrivate(trimmed)) return { ok: false, code: 'remember_secret' }
  let memoryText = asSpecific(trimmed)
  if (memoryText === null) {
    if (trimmed.length > MEMORY_LIMITS.factBody) return { ok: false, code: 'remember_too_long' }
    const title = capped((linesOf(trimmed)[0] ?? '').trim(), MEMORY_LIMITS.factTitle)
    memoryText = { kind: 'fact', title, body: trimmed }
  }
  const parsed = MemoryTextSchema.safeParse(memoryText)
  return parsed.success ? { ok: true, text: parsed.data } : { ok: false, code: 'remember_invalid' }
}
