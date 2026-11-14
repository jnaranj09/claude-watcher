// Saved text as a model reads it: one line, or a block whose every line is indented. Every line
// break Unicode counts ends a line; every other control character becomes a space.
import { describe, expect, it } from 'vitest'
import { TranscriptEntrySchema } from '../../shared/schemas/transcriptEntry'
import { cleanSlice } from './extract/sliceCleaner'
import { indentedBlock, oneLine, wrapperSafe } from './promptText'

/** Tag forms the slice cleaner cuts (`sliceCleaner.test.ts`, P3-C7): each must be neutralised. */
const CLEANER_TAG_FORMS = [
  '< SYSTEM-Reminder >',
  '</ System-reminder>',
  '<system-reminder',
  '</system-reminder the port',
  '<system-reminder foo>',
  '<system-reminder  / foo',
  '<//system-reminder>',
  'a<system-reminder>b<system-reminder>c</system-reminder>d</system-reminder>e'
]

const BREAKS = 'a\nb\r\nc\rd\u000be\u000cf\u0085g h i'

describe('oneLine', () => {
  it('turns each line break into one space, CRLF included', () => {
    expect(oneLine(BREAKS)).toBe('a b c d e f g h i')
  })

  it('turns every other control character into a space', () => {
    expect(oneLine('x\u001b[2Jy\tz\u0000w\u009bv')).toBe('x [2Jy z w v')
  })

  it('leaves text with no break or control as it is', () => {
    expect(oneLine('## Pinned · </system> — ok')).toBe('## Pinned · </system> — ok')
  })
})

describe('indentedBlock', () => {
  it('indents every line, whichever break ended it', () => {
    expect(indentedBlock(BREAKS)).toEqual(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((l) => `  ${l}`)
    )
  })

  it('keeps empty lines, indented, and turns controls into spaces', () => {
    expect(indentedBlock('one\n\nstate: x\u001b')).toEqual(['  one', '  ', '  state: x '])
  })
})

describe('wrapperSafe (P3-C1)', () => {
  it('neutralises a system-reminder tag in every form, and nothing else', () => {
    expect(
      [
        '</system-reminder>',
        '<system-reminder>',
        '</SYSTEM-Reminder>',
        '< / system-reminder >',
        'Array<string> <div> a < b'
      ].map(wrapperSafe)
    ).toEqual([
      '\u2039/system-reminder>',
      '\u2039system-reminder>',
      '\u2039/SYSTEM-Reminder>',
      '\u2039 / system-reminder >',
      'Array<string> <div> a < b'
    ])
  })

  it('a tag split by a line break is caught after oneLine flattens it', () => {
    expect([oneLine('<\n/system-reminder>'), oneLine('x </system-\nreminder>')]).toEqual([
      '\u2039 /system-reminder>',
      'x </system- reminder>'
    ])
  })

  it('neutralises the memory block marker in any case', () => {
    expect(
      [
        'Memory (Claude Watcher): x',
        'memory ( claude watcher ): x',
        'Memory (Claude Watcher) x'
      ].map(wrapperSafe)
    ).toEqual([
      'Memory (Claude Watcher)\uA789 x',
      'memory ( claude watcher )\uA789 x',
      'Memory (Claude Watcher) x'
    ])
  })

  it('every line of an indented block is neutralised', () => {
    expect(indentedBlock('a\n</system-reminder>')).toEqual(['  a', '  \u2039/system-reminder>'])
  })

  it('neutralises every tag the slice cleaner cuts: no >, attributes, nested, doubled slashes', () => {
    expect(CLEANER_TAG_FORMS.map(wrapperSafe)).toEqual(
      CLEANER_TAG_FORMS.map((form) => form.replaceAll('<', '\u2039'))
    )
  })

  it('a zero-width character inside the tag or the marker does not hide it', () => {
    expect(
      [
        '</system-\u200breminder>',
        '<\u200b/\u2060SYSTEM-reminder>',
        'Mem\u200bory (Claude\u00a0Watcher)\u200b: x',
        'Memory(ClaudeWatcher): x'
      ].map(wrapperSafe)
    ).toEqual([
      '\u2039/system-\u200breminder>',
      '\u2039\u200b/\u2060SYSTEM-reminder>',
      'Mem\u200bory (Claude\u00a0Watcher)\u200b\uA789 x',
      'Memory(ClaudeWatcher)\uA789 x'
    ])
  })

  it('a longer name is neutralised too, and a lone < or a name with a space is not', () => {
    expect(
      ['<system-reminders>', '< system reminder>', '<<', 'system-reminder>'].map(wrapperSafe)
    ).toEqual(['\u2039system-reminders>', '< system reminder>', '<<', 'system-reminder>'])
  })
})

/** The texts the slice cleaner keeps of one typed prompt: its own reminder-tag cut and marker
 *  check, not a copy of them. A prompt it keeps whole holds no tag and no marker. */
const cleanerKeeps = (text: string): string[] =>
  cleanSlice(
    [
      {
        entry: TranscriptEntrySchema.parse({
          type: 'user',
          uuid: 'u-1',
          promptSource: 'typed',
          message: { content: text }
        }),
        end: 1
      }
    ],
    0
  ).entries.map((e) => e.text)

/** Saved bodies whose tag or marker is split over two lines, in forms the cleaner folds. */
const SPLIT_BODIES = [
  'done <\n/system-reminder>',
  'done < /\n SYSTEM-Reminder >',
  'Memory (Claude\nWatcher): x',
  'mem\u200bory ( CLAUDE\n watcher ) : x',
  'Memory (Claude Watcher)\n: x'
]

describe('indentedBlock across lines (P3-C15)', () => {
  it('a tag split over two lines is neutralised before the lines are indented', () => {
    expect(indentedBlock('done <\n/system-reminder>')).toEqual([
      '  done \u2039',
      '  /system-reminder>'
    ])
  })

  it('a marker split over two lines is neutralised before the lines are indented', () => {
    expect(indentedBlock('Memory (Claude\nWatcher): x')).toEqual([
      '  Memory (Claude',
      '  Watcher)\uA789 x'
    ])
  })

  it('the slice cleaner finds no tag and no marker in a body block of any split form', () => {
    const blocks = SPLIT_BODIES.map((body) => ['body:', ...indentedBlock(body)].join('\n'))
    expect(blocks.map(cleanerKeeps)).toEqual(blocks.map((block) => [block]))
  })
})
