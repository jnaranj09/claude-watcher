import { describe, it, expect } from 'vitest'
import {
  ShortcutSchema,
  ShortcutSaveSchema,
  ShortcutDeleteSchema,
  ShortcutsFileSchema,
  RESERVED_SHORTCUT_LETTERS,
  SHORTCUT_TEXT_MAX_LENGTH
} from './shortcut'

const VALID = {
  id: 'sc-1',
  name: 'approve',
  keys: 'Ctrl+Shift+A',
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

  // --- keys: the S-2 guard. ---
  it.each([
    ['a bare letter', 'A'],
    ['no shift', 'Ctrl+A'],
    ['lowercase', 'ctrl+shift+a'],
    ['a digit', 'Ctrl+Shift+1'],
    ['an extra modifier', 'Ctrl+Shift+Alt+A'],
    ['two letters', 'Ctrl+Shift+AB'],
    ['reversed order', 'Shift+Ctrl+A'],
    ['trailing space', 'Ctrl+Shift+A ']
  ])('rejects keys that are %s', (_label, keys) => {
    expect(ShortcutSchema.safeParse({ ...VALID, keys }).success).toBe(false)
  })

  it.each(RESERVED_SHORTCUT_LETTERS)('rejects the reserved letter %s', (letter) => {
    expect(ShortcutSchema.safeParse({ ...VALID, keys: `Ctrl+Shift+${letter}` }).success).toBe(false)
  })

  it('accepts a non-reserved letter', () => {
    expect(ShortcutSchema.safeParse({ ...VALID, keys: 'Ctrl+Shift+Z' }).success).toBe(true)
  })

  // --- name ---
  it('rejects a blank name and a name with control characters', () => {
    expect(ShortcutSchema.safeParse({ ...VALID, name: '   ' }).success).toBe(false)
    expect(ShortcutSchema.safeParse({ ...VALID, name: 'bad\nname' }).success).toBe(false)
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
  it('accepts version 1 with rows and rejects any other version', () => {
    expect(ShortcutsFileSchema.parse({ version: 1, shortcuts: [VALID] }).shortcuts).toHaveLength(1)
    expect(ShortcutsFileSchema.safeParse({ version: 2, shortcuts: [] }).success).toBe(false)
  })

  it('fails the WHOLE file closed when any row is bad', () => {
    const bad = { version: 1, shortcuts: [VALID, { ...VALID, id: 'sc-2', keys: 'Ctrl+A' }] }
    expect(ShortcutsFileSchema.safeParse(bad).success).toBe(false)
  })
})
