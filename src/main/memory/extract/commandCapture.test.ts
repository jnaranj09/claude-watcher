// The Bash commands that worked in a slice (addendum "Commands"), read with no model. Line shapes
// from probe B5: a Bash that worked has an object `toolUseResult`, one that failed a string.
import { describe, expect, it } from 'vitest'
import { TranscriptEntrySchema } from '../../../shared/schemas/transcriptEntry'
import type { ReadLine } from './transcriptReader'
import { captureCommands } from './commandCapture'

let ends = 0
const rl = (raw: Record<string, unknown>): ReadLine => {
  ends += 100
  return { entry: TranscriptEntrySchema.parse(raw), end: ends }
}
const bash = (id: string, input: Record<string, unknown>, name = 'Bash'): ReadLine =>
  rl({
    type: 'assistant',
    uuid: `c-${id}`,
    message: { content: [{ type: 'tool_use', id, name, input }] }
  })
const done = (
  id: string,
  extra: Record<string, unknown> = {},
  toolUseResult: unknown = { stdout: 'ok', stderr: '', interrupted: false }
): ReadLine =>
  rl({
    type: 'user',
    uuid: `r-${id}`,
    toolUseResult,
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', ...extra }] }
  })

const failed = [
  bash('f', { command: 'npm run build' }),
  done('f', { is_error: true }, 'Error: Exit code 2')
]
const interrupted = [
  bash('i', { command: 'npm run dev' }),
  done('i', {}, { stdout: '', stderr: '', interrupted: true })
]
const background = [bash('b', { command: 'npm run dev', run_in_background: true }), done('b')]
const multiline = [bash('m', { command: 'cd /work/acme/shop\nnpm test' }), done('m')]
const long = [bash('l', { command: 'echo ' + 'x'.repeat(500) }), done('l')]
const secret = [
  bash('s', { command: 'git push https://' + 'bot:' + 'v'.repeat(12) + '@example.test/r' }),
  done('s')
]
const empty = [bash('e', { command: '   ' }), done('e')]
const notBash = [bash('n', { command: 'ls' }, 'Monitor'), done('n')]
const noResult = [bash('r', { command: 'ls' })]
const sidechain = [
  rl({
    type: 'assistant',
    uuid: 'c-sc',
    isSidechain: true,
    message: { content: [{ type: 'tool_use', id: 'sc', name: 'Bash', input: { command: 'ls' } }] }
  }),
  done('sc')
]
const oddError = [bash('o', { command: 'ls' }), done('o', { is_error: 'no' })]
const noCommand = [bash('k', { cmd: 'ls' }), done('k')]

describe('captureCommands', () => {
  it('lists a Bash command whose result is not an error, with the end offset of the result line', () => {
    const lines = [bash('t1', { command: 'npm test -- --run' }), done('t1')]
    expect(captureCommands(lines)).toEqual([{ text: 'npm test -- --run', lineEnd: lines[1]?.end }])
  })

  it('lists the commands in order, repeats included', () => {
    const lines = [
      bash('a', { command: 'npm test' }),
      done('a'),
      bash('b', { command: 'npm run lint' }),
      done('b'),
      bash('c', { command: 'npm test' }),
      done('c')
    ]
    expect(captureCommands(lines).map((c) => c.text)).toEqual([
      'npm test',
      'npm run lint',
      'npm test'
    ])
  })

  it('keeps a command whose result has a string toolUseResult and no error', () => {
    const lines = [bash('s1', { command: 'git status' }), done('s1', {}, 'clean')]
    expect(captureCommands(lines).map((c) => c.text)).toEqual(['git status'])
  })

  it('trims the command', () => {
    const lines = [bash('w', { command: '  npm test  ' }), done('w')]
    expect(captureCommands(lines).map((c) => c.text)).toEqual(['npm test'])
  })

  it('keeps a command of exactly 500 characters', () => {
    const text = 'echo ' + 'x'.repeat(495)
    const lines = [bash('x', { command: text }), done('x')]
    expect(captureCommands(lines).map((c) => c.text)).toEqual([text])
  })

  it.each([
    ['a failed command', failed],
    ['an interrupted one', interrupted],
    ['a background one', background],
    ['a two-line one', multiline],
    ['one over 500 characters', long],
    ['one holding a secret', secret],
    ['an empty one', empty],
    ['one from another tool', notBash],
    ['one with no result in the slice', noResult],
    ['one from a sidechain', sidechain],
    ['one whose is_error is not a boolean', oddError],
    ['one with no command string', noCommand]
  ])('leaves out %s', (_n, lines) => {
    expect(captureCommands(lines)).toEqual([])
  })
})
