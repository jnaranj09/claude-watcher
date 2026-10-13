import { describe, it, expect } from 'vitest'
import {
  ShortcutSchema,
  ShortcutSaveSchema,
  ShortcutDeleteSchema,
  ShortcutsFileSchema,
  parseShortcutsFile,
  aliasFromChords,
  scanPlaceholders,
  SHORTCUT_ALIAS_MAX_LENGTH,
  SHORTCUT_TEXT_MAX_LENGTH,
  SHORTCUTS_FILE_VERSION
} from './shortcut'

const VALID = {
  id: 'sc-1',
  name: 'help desk',
  alias: 'ht',
  text: 'work on help desk ticket $1',
  workspaceId: null,
  favorite: false
}

describe('ShortcutSchema — fail-closed (our shape, no passthrough)', () => {
  it('accepts a full shortcut', () => {
    expect(ShortcutSchema.parse(VALID)).toEqual(VALID)
  })

  it('strips an unknown extra key (no passthrough)', () => {
    expect(ShortcutSchema.parse({ ...VALID, submit: true })).toEqual(VALID)
  })

  it('workspaceId defaults to null (GLOBAL) when absent — protects a pre-workspaces row from failing closed', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { workspaceId: _w, ...noWorkspace } = VALID
    expect(ShortcutSchema.parse(noWorkspace).workspaceId).toBe(null)
  })

  it('rejects the retired keys field shape (keys without alias)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { alias: _a, ...noAlias } = VALID
    expect(ShortcutSchema.safeParse({ ...noAlias, keys: ['Ctrl+Alt+A'] }).success).toBe(false)
  })

  // --- text: the S-1 guard. A phrase can never carry a submit or an escape. A newline is the one
  // control char allowed: the terminal types a multi-line phrase as a bracketed paste. ---
  it('accepts a multi-line phrase and keeps its newlines', () => {
    expect(ShortcutSchema.parse({ ...VALID, text: 'first\nsecond\n' }).text).toBe('first\nsecond\n')
  })

  it.each([
    ['carriage return', 'yes\r'],
    ['CRLF', 'yes\r\nno'],
    ['tab', 'yes\tno'],
    ['only newlines', '\n\n'],
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

  it('rejects a blank name and a name with control characters', () => {
    expect(ShortcutSchema.safeParse({ ...VALID, name: '   ' }).success).toBe(false)
    expect(ShortcutSchema.safeParse({ ...VALID, name: 'bad\nname' }).success).toBe(false)
  })
})

describe('ShortcutAliasSchema — the word the operator types first', () => {
  it.each([['ht'], ['a'], ['dp2'], ['x'.repeat(SHORTCUT_ALIAS_MAX_LENGTH)]])(
    'accepts %s',
    (alias) => {
      expect(ShortcutSchema.parse({ ...VALID, alias }).alias).toBe(alias)
    }
  )

  it('lowercases and trims', () => {
    expect(ShortcutSchema.parse({ ...VALID, alias: '  HT ' }).alias).toBe('ht')
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['a space inside', 'h t'],
    ['punctuation', 'h-t'],
    ['too long', 'x'.repeat(SHORTCUT_ALIAS_MAX_LENGTH + 1)],
    ['a control character', 'h\u0000t']
  ])('rejects %s', (_label, alias) => {
    expect(ShortcutSchema.safeParse({ ...VALID, alias }).success).toBe(false)
  })
})

describe('placeholders in text', () => {
  it('scanPlaceholders reports the numbers used and whether $* appears', () => {
    expect(scanPlaceholders('deploy $1 to $2 $*')).toEqual({
      numbers: new Set([1, 2]),
      rest: true
    })
    expect(scanPlaceholders('plain')).toEqual({ numbers: new Set(), rest: false })
  })

  it('scanPlaceholders does not count an escaped $$1', () => {
    expect(scanPlaceholders('cost $$1')).toEqual({ numbers: new Set(), rest: false })
  })

  it.each([['$1'], ['$1 and $2'], ['$* only'], ['$$ literal'], ['$1 $1 twice'], ['$0 is text']])(
    'accepts text %s',
    (text) => {
      expect(ShortcutSchema.safeParse({ ...VALID, text }).success).toBe(true)
    }
  )

  it.each([['$2'], ['$1 and $3']])('rejects a gap: %s', (text) => {
    expect(ShortcutSchema.safeParse({ ...VALID, text }).success).toBe(false)
  })
})

describe('ShortcutSaveSchema / ShortcutDeleteSchema', () => {
  it('save without id ⇒ create; with id ⇒ update', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, favorite: _favorite, ...create } = VALID
    expect(ShortcutSaveSchema.parse(create)).toEqual(create)
    expect(ShortcutSaveSchema.parse({ ...create, id: 'sc-1' })).toEqual({ ...create, id: 'sc-1' })
  })

  it('delete needs a non-empty id', () => {
    expect(ShortcutDeleteSchema.safeParse({ id: '' }).success).toBe(false)
    expect(ShortcutDeleteSchema.parse({ id: 'sc-1' })).toEqual({ id: 'sc-1' })
  })
})

describe('ShortcutsFileSchema v3', () => {
  it('the version is 3', () => {
    expect(SHORTCUTS_FILE_VERSION).toBe(3)
  })

  it('accepts a v3 file', () => {
    const file = { version: 3, shortcuts: [VALID] }
    expect(ShortcutsFileSchema.parse(file)).toEqual(file)
  })

  it('rejects a v2 file (the plain schema has no migration)', () => {
    expect(ShortcutsFileSchema.safeParse({ version: 2, shortcuts: [] }).success).toBe(false)
  })
})

describe('parseShortcutsFile — v3, or a migrated v2, or a throw', () => {
  const V2_ROW = {
    id: 'sc-2',
    name: 'approve',
    keys: ['Ctrl+Alt+O', 'Ctrl+Alt+A'],
    text: 'I explicitly approve',
    workspaceId: 'w1'
  }

  it('returns a v3 file unchanged', () => {
    const file = { version: 3, shortcuts: [VALID] }
    expect(parseShortcutsFile(file)).toEqual(file)
  })

  it('migrates a v2 file: alias from the chord letters, keys dropped, version 3', () => {
    const migrated = parseShortcutsFile({ version: 2, shortcuts: [V2_ROW] })
    expect(migrated).toEqual({
      version: 3,
      shortcuts: [
        {
          id: 'sc-2',
          name: 'approve',
          alias: 'oa',
          text: 'I explicitly approve',
          workspaceId: 'w1',
          favorite: false
        }
      ]
    })
  })

  it('migrates a v2 phrase containing a literal $: doubled to $$, so it stays literal under v3', () => {
    const row = { ...V2_ROW, text: 'explain what $1 costs' }
    const migrated = parseShortcutsFile({ version: 2, shortcuts: [row] })
    expect(migrated.shortcuts[0]?.text).toBe('explain what $$1 costs')
  })

  it('migrates a v2 row missing workspaceId to GLOBAL', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { workspaceId: _w, ...row } = V2_ROW
    expect(parseShortcutsFile({ version: 2, shortcuts: [row] }).shortcuts[0]?.workspaceId).toBe(
      null
    )
  })

  it('throws on a v2 file with a malformed chord (no half migration)', () => {
    expect(() =>
      parseShortcutsFile({ version: 2, shortcuts: [{ ...V2_ROW, keys: ['Ctrl+A'] }] })
    ).toThrow()
  })

  it.each([
    ['a v1 file', { version: 1, shortcuts: [] }],
    ['a non-object', 'nope'],
    ['a v3 file with a bad row', { version: 3, shortcuts: [{ ...VALID, alias: '' }] }]
  ])('throws on %s', (_label, raw) => {
    expect(() => parseShortcutsFile(raw)).toThrow()
  })
})

describe('aliasFromChords', () => {
  it('joins the lowercased letters', () => {
    expect(aliasFromChords(['Ctrl+Alt+O', 'Ctrl+Alt+A'])).toBe('oa')
    expect(aliasFromChords(['Ctrl+Alt+Z'])).toBe('z')
  })
})

describe('favorite', () => {
  it('an old v3 row without favorite loads as false', () => {
    const file = parseShortcutsFile({
      version: 3,
      shortcuts: [{ id: 's1', name: 'a', alias: 'ap', text: 'x', workspaceId: null }]
    })
    expect(file.shortcuts[0]?.favorite).toBe(false)
  })
  it('a v2 file migrates with favorite false', () => {
    const file = parseShortcutsFile({
      version: 2,
      shortcuts: [{ id: 's1', name: 'a', keys: ['Ctrl+Alt+A'], text: 'x' }]
    })
    expect(file.shortcuts[0]?.favorite).toBe(false)
  })
  it('the save schema does not carry favorite', () => {
    const parsed = ShortcutSaveSchema.parse({
      name: 'a',
      alias: 'ap',
      text: 'x',
      workspaceId: null,
      favorite: true
    })
    expect('favorite' in parsed).toBe(false)
  })
})
