// The memory mod's protocol (src/mod/watcher-memory/hooks/protocol.ts): how it finds main, the
// bodies it builds and how it reads main's answers. Pure, so it runs under node. Its contract with
// main's real schemas and routes is pinned in tests/main/modMemoryContract.test.ts.
import { describe, it, expect } from 'vitest'
import {
  CONFIG_ENV,
  FILE_TOOLS,
  PAUSE_MS,
  REMEMBER_COMMAND,
  SECTION_ID,
  WAIT_MS,
  atUseBody,
  foldersFor,
  indexBody,
  parseConfig,
  readIndexAnswer,
  readRememberAnswer,
  readTextAnswer,
  recallBody,
  rememberBody,
  rememberRow
} from '../../src/mod/watcher-memory/hooks/protocol'

describe('the memory mod protocol', () => {
  it('parseConfig reads the address and the header of the memory server', () => {
    const file = JSON.stringify({
      mcpServers: {
        'claude-watcher-memory': {
          type: 'http',
          url: 'http://127.0.0.1:29279/mcp/memory',
          headers: { Authorization: 'Bearer abc' }
        }
      }
    })
    expect(parseConfig(file)).toEqual({
      base: 'http://127.0.0.1:29279',
      authorization: 'Bearer abc'
    })
  })

  it('parseConfig refuses anything else', () => {
    expect(
      [
        '',
        'not json',
        '{}',
        JSON.stringify({
          mcpServers: {
            other: { url: 'http://127.0.0.1:1/mcp/memory', headers: { Authorization: 'Bearer a' } }
          }
        }),
        JSON.stringify({
          mcpServers: {
            'claude-watcher-memory': {
              url: 'http://127.0.0.1:1/elsewhere',
              headers: { Authorization: 'Bearer a' }
            }
          }
        })
      ].map(parseConfig)
    ).toEqual([undefined, undefined, undefined, undefined, undefined])
  })

  it('parseConfig refuses a server with no header, a blank header or a URL with no host', () => {
    const server = (entry: unknown): string =>
      JSON.stringify({ mcpServers: { 'claude-watcher-memory': entry } })
    expect(
      [
        server({ url: 'http://127.0.0.1:1/mcp/memory' }),
        server({ url: 'http://127.0.0.1:1/mcp/memory', headers: { Authorization: '' } }),
        server({ url: 'http://127.0.0.1:1/mcp/memory', headers: { Authorization: 7 } }),
        server({ url: '/mcp/memory', headers: { Authorization: 'Bearer a' } }),
        server({ url: 'http:///mcp/memory', headers: { Authorization: 'Bearer a' } }),
        server(null),
        JSON.stringify({ mcpServers: [] }),
        'null'
      ].map(parseConfig)
    ).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    ])
  })

  it('recallBody cuts the prompt to 2,000 characters and sends nothing for a blank one', () => {
    expect(JSON.parse(recallBody(2, 'composer', 'x'.repeat(100_000)) ?? '{}')).toEqual({
      version: 1,
      window: 2,
      origin: 'composer',
      text: 'x'.repeat(2000)
    })
    expect(recallBody(0, 'composer', '  \n ')).toBeUndefined()
  })

  it('recallBody never cuts a character in half', () => {
    const text = `${'x'.repeat(1999)}😀tail`
    expect(JSON.parse(recallBody(0, 'composer', text) ?? '{}')).toEqual({
      version: 1,
      window: 0,
      origin: 'composer',
      text: 'x'.repeat(1999)
    })
  })

  it('the index and at-use bodies carry the window and the folders', () => {
    expect([JSON.parse(indexBody(3)), JSON.parse(atUseBody(4, ['/work/app']))]).toEqual([
      { version: 1, window: 3 },
      { version: 1, window: 4, folders: ['/work/app'] }
    ])
  })

  it('rememberBody cuts the text to 8,000 characters', () => {
    expect(JSON.parse(rememberBody('composer', 'y'.repeat(20_000)))).toEqual({
      version: 1,
      origin: 'composer',
      text: 'y'.repeat(8000)
    })
  })

  it('foldersFor matches on a path boundary, deepest first', () => {
    const folders = ['/work/app', '/work/app/api', '/work/app-old', '/work']
    expect([
      foldersFor('/work/app/api/x.ts', folders, new Set()),
      foldersFor('/work/app-old/y.ts', folders, new Set()),
      foldersFor('src/x.ts', folders, new Set()),
      foldersFor('/work/app', ['/work/app/'], new Set())
    ]).toEqual([
      ['/work/app/api', '/work/app', '/work'],
      ['/work/app-old', '/work'],
      [],
      ['/work/app/']
    ])
  })

  it('foldersFor skips what was asked and gives at most 5', () => {
    expect(
      foldersFor(
        '/work/app/api/x.ts',
        ['/work/app', '/work/app/api', '/work'],
        new Set(['/work/app'])
      )
    ).toEqual(['/work/app/api', '/work'])
    expect(
      foldersFor(
        '/a/b/c/d/e/f/g/x.ts',
        ['/a', '/a/b', '/a/b/c', '/a/b/c/d', '/a/b/c/d/e', '/a/b/c/d/e/f'],
        new Set()
      )
    ).toHaveLength(5)
  })

  it('foldersFor never names an empty or relative folder, nor one twice', () => {
    expect(
      foldersFor('/work/app/x.ts', ['', 'work/app', '/work/app', '/work/app'], new Set())
    ).toEqual(['/work/app'])
  })

  it('the text reader gives a block only for an ok answer with text', () => {
    expect(
      [
        '{"ok":true,"text":"B"}',
        '',
        'x',
        '{"ok":false}',
        '{"ok":true,"text":""}',
        '{"ok":true,"text":5}'
      ].map(readTextAnswer)
    ).toEqual(['B', undefined, undefined, undefined, undefined, undefined])
  })

  it('the index reader refuses a folder that is not a string', () => {
    expect([
      readIndexAnswer('{"ok":true,"text":"I","folders":["/work/app"]}'),
      readIndexAnswer('{"ok":true,"text":"I","folders":["/work/app",7]}')
    ]).toEqual([{ text: 'I', folders: ['/work/app'] }, undefined])
  })

  it('the index reader refuses a not-ok answer, a missing text or missing folders', () => {
    expect(
      [
        '{"ok":false}',
        '{"ok":true,"folders":[]}',
        '{"ok":true,"text":"I"}',
        '{"ok":true,"text":"I","folders":"/work"}',
        'null',
        'nope'
      ].map(readIndexAnswer)
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
  })

  it('the remember reader takes a saved item or a refusal code, and nothing else', () => {
    expect(
      [
        '{"ok":true,"kind":"fact","id":"m1"}',
        '{"ok":false,"code":"remember_secret"}',
        '{"ok":true,"kind":"episode","id":"m1"}',
        '{"ok":true,"kind":"fact","id":""}',
        '{"ok":true,"kind":"fact"}',
        '{"ok":false}',
        '{"ok":false,"code":""}',
        '[]',
        ''
      ].map(readRememberAnswer)
    ).toEqual([
      { ok: true, kind: 'fact', id: 'm1' },
      { ok: false, code: 'remember_secret' },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    ])
  })

  it('the command row says what happened, word for word', () => {
    expect([
      rememberRow({ ok: true, kind: 'specific', id: 'm7' }),
      rememberRow({ ok: true, kind: 'fact', id: 'm8' }),
      rememberRow({ ok: false, code: 'memory_not_available' }),
      rememberRow({ ok: false, code: 'remember_empty' }),
      rememberRow({ ok: false, code: 'remember_too_long' }),
      rememberRow({ ok: false, code: 'remember_invalid' }),
      rememberRow({ ok: false, code: 'remember_secret' }),
      rememberRow({ ok: false, code: 'remember_not_operator' }),
      rememberRow({ ok: false, code: 'store_write_failed' }),
      rememberRow({ ok: false, code: 'something_new' }),
      rememberRow(undefined)
    ]).toEqual([
      'Saved as a specific. id=m7',
      'Saved as a fact. id=m8',
      'Memory is not available.',
      'Nothing to save. Type /remember and the text.',
      'Too long to save. A fact holds at most 2,000 characters.',
      'That text cannot be saved: it holds a control character.',
      'That looks like a secret, so it was not saved.',
      'Only you can use /remember.',
      'Memory could not be saved.',
      'Memory is not available.',
      'Memory did not answer. The line may not be saved.'
    ])
  })

  it('an inherited name is not a refusal code the row knows', () => {
    expect(rememberRow({ ok: false, code: 'toString' })).toBe('Memory is not available.')
  })

  it("the command's name, description and hint are the Copy table's, word for word", () => {
    expect(REMEMBER_COMMAND).toEqual({
      name: 'remember',
      description: "Save a line to this app's memory. No model turn.",
      argumentHint: '<text> | <key> = <value>'
    })
  })

  it('the waits, the pause, the env var, the file tools and the section id are the plan’s values', () => {
    expect([WAIT_MS, PAUSE_MS, CONFIG_ENV, FILE_TOOLS, SECTION_ID]).toEqual([
      { index: 500, recall: 250, atUse: 250, remember: 3000 },
      30_000,
      'CLAUDE_WATCHER_MEMORY_CONFIG',
      ['Read', 'Edit', 'Write', 'NotebookEdit'],
      'watcher-memory:index'
    ])
  })
})
