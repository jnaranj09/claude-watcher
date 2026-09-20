// Custom themes — the SDK files are GENERATED from the code and drift-tested. Run
// `npm run gen:theme-docs` (THEME_DOCS_WRITE=1) to rewrite them; this test fails while the
// committed files differ.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  renderTokenTable,
  renderTerminalKeyList,
  renderThemeJsonSchema,
  renderBuiltinExampleManifest,
  replaceRegion
} from './themeDocs'
import { TOKENS } from './tokens'

const here = dirname(fileURLToPath(import.meta.url))
const docs = resolve(here, '../../../docs/themes')
const WRITE = process.env.THEME_DOCS_WRITE === '1'

function check(file: string, expected: string): void {
  if (WRITE) writeFileSync(file, expected)
  expect(readFileSync(file, 'utf8')).toBe(expected)
}

describe('replaceRegion', () => {
  it('replaces only the marked region and keeps the markers', () => {
    const doc = 'a\n<!-- generated:x:start -->\nold\n<!-- generated:x:end -->\nb\n'
    expect(replaceRegion(doc, 'x', 'new\n')).toBe(
      'a\n<!-- generated:x:start -->\nnew\n<!-- generated:x:end -->\nb\n'
    )
  })
  it('throws when a marker is missing', () => {
    expect(() => replaceRegion('nothing', 'x', 'y')).toThrow(/generated:x/)
  })
})

describe('docs/themes is generated from the code', () => {
  it('THEMES.md token table and terminal key list', () => {
    const file = resolve(docs, 'THEMES.md')
    const current = readFileSync(file, 'utf8')
    const expected = replaceRegion(
      replaceRegion(current, 'tokens', renderTokenTable()),
      'terminal',
      renderTerminalKeyList()
    )
    check(file, expected)
  })
  it('theme.schema.json', () => {
    check(resolve(docs, 'theme.schema.json'), renderThemeJsonSchema())
  })
  it('examples/builtin-dark/theme.json lists every token and terminal key at its default', () => {
    check(resolve(docs, 'examples/builtin-dark/theme.json'), renderBuiltinExampleManifest())
  })
})

describe('the rendered pieces', () => {
  it('the token table has one row per token with its meaning and default', () => {
    const table = renderTokenTable()
    expect(table).toContain('| `bg-base` | The window ground')
    expect(table).toContain('`#1a1a18`')
    expect(table.trim().split('\n')).toHaveLength(2 + Object.keys(TOKENS).length) // header, divider, one row per token
  })

  // Finding 6 — xtermTheme has no default for `selectionForeground` /
  // `selectionInactiveBackground` (xterm treats an absent key as "derive it"), so
  // `xtermTheme[k] ?? ''` rendered those two rows' Default cell as an EMPTY string — a bare
  // `` `` `` pair of backticks with nothing between them in the generated table, reading as a
  // broken table rather than "unset".
  it('a terminal key with no xtermTheme default renders "unset", never an empty cell', () => {
    const list = renderTerminalKeyList()
    expect(list).toContain('| `selectionForeground` | unset |')
    expect(list).toContain('| `selectionInactiveBackground` | unset |')
    expect(list).not.toMatch(/\|\s*``\s*\|/)
  })
  it('the JSON schema names every token as a property and forbids extras', () => {
    const schema = JSON.parse(renderThemeJsonSchema()) as {
      properties: { tokens: { properties: Record<string, unknown>; additionalProperties: boolean } }
      additionalProperties: boolean
      $id: string
    }
    expect(schema.$id).toBe(
      'https://raw.githubusercontent.com/jnaranj09/claude-watcher/main/docs/themes/theme.schema.json'
    )
    expect(schema.additionalProperties).toBe(false)
    expect(Object.keys(schema.properties.tokens.properties)).toContain('bg-base')
    expect(schema.properties.tokens.additionalProperties).toBe(false)
  })
})
