// Custom themes — pure renderers for the SDK files. themeDocs.test.ts compares them with the
// committed docs (and writes them with THEME_DOCS_WRITE=1). Pure: no fs here.
import { z } from 'zod'
import { TOKENS, type TokenName } from './tokens'
import { xtermTheme } from './xtermTheme'
import { TOKEN_DOCS } from './tokenDocs'
import { TERMINAL_THEME_KEYS, ThemeManifestSchema } from '../schemas/theme'

export const THEME_SCHEMA_URL =
  'https://raw.githubusercontent.com/jnaranj09/claude-watcher/main/docs/themes/theme.schema.json'

export function renderTokenTable(): string {
  const rows = (Object.keys(TOKENS) as TokenName[]).map(
    (name) => `| \`${name}\` | ${TOKEN_DOCS[name]} | \`${TOKENS[name]}\` |`
  )
  return ['| Token | Meaning | Default |', '| --- | --- | --- |', ...rows].join('\n') + '\n'
}

export function renderTerminalKeyList(): string {
  const rows = TERMINAL_THEME_KEYS.map((k) => `| \`${k}\` | \`${xtermTheme[k] ?? ''}\` |`)
  return (
    ['| Key | Default |', '| --- | --- |', ...rows, '| `allowTransparency` | `false` |'].join(
      '\n'
    ) + '\n'
  )
}

export function renderThemeJsonSchema(): string {
  const schema = z.toJSONSchema(ThemeManifestSchema, { io: 'input' }) as Record<string, unknown>
  const out = {
    $schema: schema.$schema,
    $id: THEME_SCHEMA_URL,
    title: 'claude-watcher theme manifest',
    description:
      'theme.json for a claude-watcher theme package. Rules the schema cannot express: a token or terminal value may not contain url(, ;, {, }, /*, a newline or a backslash; css may not contain ".."; name is trimmed before its length is checked, so a whitespace-only name (e.g. " ") satisfies this schema but is rejected by the app.',
    ...schema
  }
  return JSON.stringify(out, null, 2) + '\n'
}

export function renderBuiltinExampleManifest(): string {
  const terminal: Record<string, string> = {}
  for (const k of TERMINAL_THEME_KEYS) {
    const v = xtermTheme[k]
    if (v !== undefined) terminal[k] = v
  }
  const manifest = {
    $schema: THEME_SCHEMA_URL,
    version: 1,
    name: 'Built-in dark',
    author: 'claude-watcher',
    colorScheme: 'dark',
    tokens: { ...TOKENS },
    terminal,
    css: 'theme.css'
  }
  return JSON.stringify(manifest, null, 2) + '\n'
}

export function replaceRegion(doc: string, name: string, body: string): string {
  const start = `<!-- generated:${name}:start -->\n`
  const end = `<!-- generated:${name}:end -->`
  const a = doc.indexOf(start)
  const b = doc.indexOf(end)
  if (a === -1 || b === -1 || b < a) throw new Error(`missing generated:${name} markers`)
  return doc.slice(0, a + start.length) + body + doc.slice(b)
}
