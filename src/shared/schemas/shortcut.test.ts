import { describe, it, expect } from 'vitest'
import {
  ShortcutSchema,
  ShortcutSaveSchema,
  ShortcutDeleteSchema,
  ShortcutsFileSchema,
  shortcutKeysId,
  SHORTCUT_SEQUENCE_MAX_CHORDS,
  SHORTCUT_TEXT_MAX_LENGTH
} from './shortcut'

const VALID = {
  id: 'sc-1',
  name: 'approve',
  keys: ['Ctrl+Alt+A'],
  text: 'I explicitly approve'
}

describe('ShortcutSchema — fail-closed (our shape, no passthrough)', () => {
  it('accepts a full shortcut', () => {
    expect(ShortcutSchema.parse(VALID)).toEqual(VALID)
  })

  // Same convention as TemplateSchema: unknown keys are STRIPPED, not passed through. A future
  // `submit` flag therefore cannot sneak in through a hand-edited file (spec S-1), and an
  // additive field from a newer build does not fail the whole file closed on a downgrade.
  it('strips an unknown extra key (no passthrough)', () => {
    expect(ShortcutSchema.parse({ ...VALID, submit: true })).toEqual(VALID)
  })

  // --- text: the S-1 guard. A phrase can never carry a submit or an escape. ---
  it.each([
    ['newline', 'yes\n'],
    ['carriage return', 'yes\r'],
    ['ANSI escape', 'yes\u001b[A'],
    ['NUL', 'yes\u0000'],
    ['empty', ''],
    ['whitespace only', '   ']
  ])('rejects text containing %s', (_label, text) => {
    expect(ShortcutSchema.safeParse({ ...VALID, text }).success).toBe(false)
  })

  it('rejects text longer than the cap', () => {
    const text = 'a'.repeat(SHORTCUT_TEXT_MAX_LENGTH + 1)
    expect(ShortcutSchema.safeParse({ ...VALID, text }).success).toBe(false)
  })

  it('accepts a trailing space and PRESERVES it (no trim transform)', () => {
    const parsed = ShortcutSchema.parse({ ...VALID, text: 'run the tests and ' })
    expect(parsed.text).toBe('run the tests and ')
  })

  // --- name ---
  it('rejects a blank name and a name with control characters', () => {
    expect(ShortcutSchema.safeParse({ ...VALID, name: '   ' }).success).toBe(false)
    expect(ShortcutSchema.safeParse({ ...VALID, name: 'bad\nname' }).success).toBe(false)
  })
})

describe('ShortcutKeysSchema — a 1..3 chord sequence in the Ctrl+Alt namespace', () => {
  it.each([
    ['one chord', ['Ctrl+Alt+A']],
    ['two chords', ['Ctrl+Alt+O', 'Ctrl+Alt+A']],
    ['three chords', ['Ctrl+Alt+O', 'Ctrl+Alt+A', 'Ctrl+Alt+Z']],
    ['a repeated chord', ['Ctrl+Alt+A', 'Ctrl+Alt+A']]
  ])('accepts %s', (_label, keys) => {
    expect(ShortcutSchema.safeParse({ ...VALID, keys }).success).toBe(true)
  })

  // The reserved list is GONE — every letter is assignable (design §6). Restoring the
  // isReservedShortcutLetter refine must turn this red.
  it.each([['N'], ['Q'], ['W'], ['I'], ['J'], ['C'], ['R']])(
    'accepts the formerly reserved letter %s',
    (letter) => {
      expect(ShortcutSchema.safeParse({ ...VALID, keys: [`Ctrl+Alt+${letter}`] }).success).toBe(
        true
      )
    }
  )

  it.each([
    ['an empty sequence', []],
    ['four chords', ['Ctrl+Alt+A', 'Ctrl+Alt+B', 'Ctrl+Alt+C', 'Ctrl+Alt+D']],
    ['the old Ctrl+Shift namespace', ['Ctrl+Shift+A']],
    ['plain Ctrl', ['Ctrl+A']],
    ['a bare letter', ['A']],
    ['lower case', ['ctrl+alt+a']],
    ['a digit', ['Ctrl+Alt+1']],
    ['two letters', ['Ctrl+Alt+AB']],
    ['reversed order', ['Alt+Ctrl+A']],
    ['an extra modifier', ['Ctrl+Alt+Shift+A']],
    ['a trailing space', ['Ctrl+Alt+A ']],
    ['an empty chord', ['']],
    ['a mixed-in bad chord', ['Ctrl+Alt+A', 'Ctrl+Shift+B']]
  ])('rejects %s', (_label, keys) => {
    expect(ShortcutSchema.safeParse({ ...VALID, keys }).success).toBe(false)
  })

  it('rejects a bare string (keys is an array now)', () => {
    expect(ShortcutSchema.safeParse({ ...VALID, keys: 'Ctrl+Alt+A' }).success).toBe(false)
  })

  // The fail-closed log is PATH + CODE only, so the path has to stay informative: a per-element
  // schema names the offending CHORD INDEX. A delimited string would collapse to one opaque
  // issue on `keys`.
  it('reports the failing CHORD INDEX in the issue path', () => {
    const parsed = ShortcutSchema.safeParse({ ...VALID, keys: ['Ctrl+Alt+A', 'nope'] })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0]?.path).toEqual(['keys', 1])
  })

  it('caps the sequence at SHORTCUT_SEQUENCE_MAX_CHORDS', () => {
    expect(SHORTCUT_SEQUENCE_MAX_CHORDS).toBe(3)
  })
})

describe('shortcutKeysId', () => {
  it('joins chords with a single space', () => {
    expect(shortcutKeysId(['Ctrl+Alt+O', 'Ctrl+Alt+A'])).toBe('Ctrl+Alt+O Ctrl+Alt+A')
  })

  it('is the chord itself for a single-chord sequence', () => {
    expect(shortcutKeysId(['Ctrl+Alt+O'])).toBe('Ctrl+Alt+O')
  })

  it('is the empty string for an empty sequence', () => {
    expect(shortcutKeysId([])).toBe('')
  })
})

describe('ShortcutSaveSchema / ShortcutDeleteSchema', () => {
  it('makes id optional on save (no id ⇒ create)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...noId } = VALID
    expect(ShortcutSaveSchema.parse(noId)).toEqual(noId)
    expect(ShortcutSaveSchema.parse(VALID).id).toBe('sc-1')
  })

  it('requires a non-empty id on delete', () => {
    expect(ShortcutDeleteSchema.parse({ id: 'sc-1' })).toEqual({ id: 'sc-1' })
    expect(ShortcutDeleteSchema.safeParse({ id: '' }).success).toBe(false)
  })
})

describe('ShortcutsFileSchema', () => {
  it('accepts version 2 with rows and rejects any other version', () => {
    expect(ShortcutsFileSchema.parse({ version: 2, shortcuts: [VALID] }).shortcuts).toHaveLength(1)
    expect(ShortcutsFileSchema.safeParse({ version: 3, shortcuts: [] }).success).toBe(false)
  })

  // A stale v1 file fails on ONE path (`version`) and the store's EXISTING corrupt path backs it
  // up beside itself + starts empty. That is the migration (design §7) — no migration code.
  it('rejects a stale version 1 file', () => {
    expect(
      ShortcutsFileSchema.safeParse({
        version: 1,
        shortcuts: [{ ...VALID, keys: 'Ctrl+Shift+A' }]
      }).success
    ).toBe(false)
  })

  it('fails the WHOLE file closed when any row is bad', () => {
    const bad = { version: 2, shortcuts: [VALID, { ...VALID, id: 'sc-2', keys: ['Ctrl+A'] }] }
    expect(ShortcutsFileSchema.safeParse(bad).success).toBe(false)
  })
})
