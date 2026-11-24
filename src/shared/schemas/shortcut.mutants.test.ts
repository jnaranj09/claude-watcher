// Shortcut schema rules the mutation run (StrykerJS) showed no test pinned: a save never carries
// `favorite`, the v2 chord is anchored, and an unreadable file throws the v3 parse error.
import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { ShortcutSaveSchema, parseShortcutsFile } from './shortcut'

describe('ShortcutSaveSchema', () => {
  it('a parsed save carries no favorite key, so a form Save never resets a pin', () => {
    const save = { name: 'tests', alias: 'ts', text: 'run the tests', workspaceId: null }
    expect(Object.keys(ShortcutSaveSchema.parse(save))).not.toContain('favorite')
  })
})

describe('parseShortcutsFile — v2 chords', () => {
  it.each([
    ['text before the chord', 'xCtrl+Alt+A'],
    ['text after the chord', 'Ctrl+Alt+AB']
  ])('refuses a v2 chord with %s', (_case, chord) => {
    const v2 = {
      version: 2,
      shortcuts: [{ id: 's1', name: 'tests', keys: [chord], text: 'run the tests' }]
    }
    expect(() => parseShortcutsFile(v2)).toThrow(ZodError)
  })

  it('throws a ZodError for a file that is neither v3 nor v2', () => {
    expect(() => parseShortcutsFile({ version: 9 })).toThrow(ZodError)
  })
})
