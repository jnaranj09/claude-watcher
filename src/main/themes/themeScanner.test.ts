import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME_BUNDLE, THEME_MANIFEST_MAX_BYTES } from '../../shared/schemas/theme'
import { createThemeScanner, codeForIssue } from './themeScanner'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function themesDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'cw-themes-'))
  dirs.push(d)
  return d
}
function theme(
  dir: string,
  id: string,
  manifest: unknown,
  files: Record<string, string | Uint8Array> = {}
): void {
  mkdirSync(join(dir, id), { recursive: true })
  if (manifest !== null)
    writeFileSync(
      join(dir, id, 'theme.json'),
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest)
    )
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, id, name), body)
}
const logs: string[] = []
const log = (m: string): void => {
  logs.push(m)
}

describe('scan()', () => {
  it('creates the folder when missing and returns []', () => {
    const dir = join(themesDir(), 'themes')
    const s = createThemeScanner({ dir, log })
    expect(s.scan()).toEqual([])
    expect(() => mkdirSync(dir)).toThrow() // exists now
  })
  it('lists loadable themes sorted by name, broken ones with a code, never Default', () => {
    const dir = themesDir()
    theme(dir, 'zeta', { version: 1, name: 'Alpha', author: 'a', colorScheme: 'light' })
    theme(dir, 'beta', { version: 1, name: 'Zulu' })
    theme(dir, 'broken', { version: 1, name: 'B', tokens: { 'bg-bas': '#000' } })
    theme(dir, 'nomanifest', null)
    writeFileSync(join(dir, 'a-file.txt'), 'ignored')
    expect(createThemeScanner({ dir, log }).scan()).toEqual([
      { id: 'zeta', name: 'Alpha', author: 'a', colorScheme: 'light' },
      {
        id: 'broken',
        name: 'broken',
        colorScheme: 'dark',
        error: 'theme_unknown_token',
        path: 'tokens.bg-bas'
      },
      {
        id: 'nomanifest',
        name: 'nomanifest',
        colorScheme: 'dark',
        error: 'theme_manifest_missing'
      },
      { id: 'beta', name: 'Zulu', colorScheme: 'dark' }
    ])
  })
  it('skips a `default` folder (reserved) and a bad folder name (invalid), logging each', () => {
    const dir = themesDir()
    theme(dir, 'default', { version: 1, name: 'X' })
    theme(dir, 'Bad_Name', { version: 1, name: 'X' })
    logs.length = 0
    expect(createThemeScanner({ dir, log }).scan()).toEqual([])
    expect(logs).toContain('[claude-watcher][themes] code=theme_id_reserved id=default')
    expect(logs).toContain('[claude-watcher][themes] code=theme_id_invalid')
    expect(logs.join('\n')).not.toContain('Bad_Name') // never the value
  })
  it('never throws — a regular file occupying the themes path returns [] instead', () => {
    const dir = themesDir()
    const filePath = join(dir, 'occupied')
    writeFileSync(filePath, 'not a directory')
    const scanner = createThemeScanner({ dir: filePath, log })
    let result: unknown
    expect(() => {
      result = scanner.scan()
    }).not.toThrow()
    expect(result).toEqual([])
  })
  it('the broken-theme log line carries only the code and the bounded path', () => {
    const dir = themesDir()
    theme(dir, 'broken2', { version: 1, name: 'B', tokens: { 'bg-bas': '#000' } })
    logs.length = 0
    createThemeScanner({ dir, log }).scan()
    expect(logs).toEqual([
      '[claude-watcher][themes] code=theme_unknown_token id=broken2 path=tokens.bg-bas'
    ])
  })
  it('omits a bare path= for a root-level issue', () => {
    const dir = themesDir()
    theme(dir, 'rootissue', { version: 1, name: 'X', extra: 1 })
    logs.length = 0
    createThemeScanner({ dir, log }).scan()
    expect(logs).toEqual(['[claude-watcher][themes] code=theme_manifest_invalid id=rootissue'])
  })
})

describe('load(id)', () => {
  it('default is compiled in and touches no disk', () => {
    const s = createThemeScanner({ dir: '/nonexistent/claude-watcher-themes', log })
    expect(s.load('default')).toEqual({ ok: true, bundle: DEFAULT_THEME_BUNDLE })
  })
  it('a full theme composes', () => {
    const dir = themesDir()
    theme(
      dir,
      'glass',
      {
        version: 1,
        name: 'Glass',
        tokens: { 'bg-base': '#000' },
        css: 'theme.css',
        terminal: { allowTransparency: true }
      },
      { 'theme.css': 'body{background:url(bg.png)}', 'bg.png': new Uint8Array([1, 2, 3]) }
    )
    const r = createThemeScanner({ dir, log }).load('glass')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bundle.id).toBe('glass')
      expect(r.bundle.css).toBe(
        ':root {\n  --bg-base: #000;\n}\nbody{background:url("data:image/png;base64,AQID")}'
      )
      expect(r.bundle.terminal).toEqual({ allowTransparency: true })
    }
  })
  it.each([
    ['theme_not_found', 'missing', null, {}],
    ['theme_id_invalid', 'Bad', null, {}],
    ['theme_manifest_missing', 'nomanifest', undefined, {}],
    ['theme_manifest_invalid', 'badjson', '{not json', {}],
    ['theme_manifest_invalid', 'v2', { version: 2, name: 'X' }, {}],
    ['theme_manifest_invalid', 'extra', { version: 1, name: 'X', extra: 1 }, {}],
    [
      'theme_manifest_too_large',
      'big',
      JSON.stringify({ version: 1, name: 'X', author: 'a'.repeat(THEME_MANIFEST_MAX_BYTES) }),
      {}
    ],
    ['theme_unknown_token', 'tok', { version: 1, name: 'X', tokens: { nope: '#000' } }, {}],
    [
      'theme_token_value_invalid',
      'val',
      { version: 1, name: 'X', tokens: { 'bg-base': 'a;b' } },
      {}
    ],
    [
      'theme_token_value_invalid',
      'tval',
      { version: 1, name: 'X', terminal: { red: 'url(x)' } },
      {}
    ],
    ['theme_css_missing', 'nocss', { version: 1, name: 'X', css: 'theme.css' }, {}],
    [
      'theme_css_url_invalid',
      'url',
      { version: 1, name: 'X', css: 'theme.css' },
      { 'theme.css': 'a{b:url(https://x/y.png)}' }
    ],
    [
      'theme_asset_missing',
      'asset',
      { version: 1, name: 'X', css: 'theme.css' },
      { 'theme.css': 'a{b:url(y.png)}' }
    ],
    [
      'theme_asset_type_invalid',
      'ext',
      { version: 1, name: 'X', css: 'theme.css' },
      { 'theme.css': 'a{b:url(y.exe)}', 'y.exe': 'x' }
    ]
  ] as const)('%s', (code, id, manifest, files) => {
    const dir = themesDir()
    if (manifest !== null) theme(dir, id, manifest === undefined ? null : manifest, files)
    const r = createThemeScanner({ dir, log }).load(id)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe(code)
  })
  it('theme_read_failed when the manifest is a directory', () => {
    const dir = themesDir()
    mkdirSync(join(dir, 'weird', 'theme.json'), { recursive: true })
    const r = createThemeScanner({ dir, log }).load('weird')
    expect(r).toEqual({ ok: false, code: 'theme_read_failed' })
  })
  it('refuses a symlinked asset — never follows a link out of the theme folder', () => {
    const dir = themesDir()
    const outsideFile = join(dir, 'outside.png')
    writeFileSync(outsideFile, 'secret')
    theme(
      dir,
      'linked',
      { version: 1, name: 'X', css: 'theme.css' },
      { 'theme.css': 'a{b:url(bg.png)}' }
    )
    symlinkSync(outsideFile, join(dir, 'linked', 'bg.png'))
    const r = createThemeScanner({ dir, log }).load('linked')
    expect(r).toEqual({ ok: false, code: 'theme_asset_missing' })
  })
  it('truncates an unrecognized token key to 64 chars in the reported path', () => {
    const dir = themesDir()
    const longKey = 'x'.repeat(100)
    theme(dir, 'longkey', { version: 1, name: 'X', tokens: { [longKey]: '#000' } })
    const r = createThemeScanner({ dir, log }).load('longkey')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.path).toBe(`tokens.${longKey.slice(0, 64)}`)
      expect(r.path?.length).toBeLessThanOrEqual(200)
    }
  })
})

describe('codeForIssue', () => {
  it('maps zod issues to theme codes with a path', () => {
    expect(codeForIssue({ path: ['tokens'], code: 'unrecognized_keys' })).toEqual({
      code: 'theme_unknown_token',
      path: 'tokens'
    })
    expect(codeForIssue({ path: ['tokens', 'bg-base'], code: 'custom' })).toEqual({
      code: 'theme_token_value_invalid',
      path: 'tokens.bg-base'
    })
    expect(codeForIssue({ path: ['tokens', 'bg-base'], code: 'too_big' })).toEqual({
      code: 'theme_token_value_invalid',
      path: 'tokens.bg-base'
    })
    expect(codeForIssue({ path: ['terminal', 'red'], code: 'custom' })).toEqual({
      code: 'theme_token_value_invalid',
      path: 'terminal.red'
    })
    expect(codeForIssue({ path: ['terminal'], code: 'unrecognized_keys' })).toEqual({
      code: 'theme_manifest_invalid',
      path: 'terminal'
    })
    expect(codeForIssue({ path: ['name'], code: 'too_small' })).toEqual({
      code: 'theme_manifest_invalid',
      path: 'name'
    })
  })
})
