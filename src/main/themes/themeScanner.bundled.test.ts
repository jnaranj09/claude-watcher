// Bundled themes (spec 2026-09-25) — the scanner's second, allowlisted, read-only root.
// main-unit (node) project. The no-`bundled` behaviour is themeScanner.test.ts, unchanged.
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterEach } from 'vitest'
import { BUNDLED_THEME_IDS } from './bundledThemes'
import { createThemeScanner } from './themeScanner'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'cw-bundled-'))
  dirs.push(d)
  return d
}
function theme(dir: string, id: string, name: string): void {
  mkdirSync(join(dir, id), { recursive: true })
  writeFileSync(join(dir, id, 'theme.json'), JSON.stringify({ version: 1, name }))
}
const logs: string[] = []
const log = (m: string): void => {
  logs.push(m)
}
function setup(): { user: string; shipped: string } {
  const root = tmp()
  const user = join(root, 'user')
  const shipped = join(root, 'shipped')
  mkdirSync(user)
  mkdirSync(shipped)
  logs.length = 0
  return { user, shipped }
}
const IDS = ['glass', 'paper'] as const

describe('bundled themes', () => {
  it('lists bundled and user themes together, sorted by name', () => {
    const { user, shipped } = setup()
    theme(shipped, 'glass', 'Glass')
    theme(shipped, 'paper', 'Paper')
    theme(user, 'mine', 'Mine')
    const s = createThemeScanner({ dir: user, bundled: { dir: shipped, ids: IDS }, log })
    expect(s.scan()).toEqual([
      { id: 'glass', name: 'Glass', colorScheme: 'dark' },
      { id: 'mine', name: 'Mine', colorScheme: 'dark' },
      { id: 'paper', name: 'Paper', colorScheme: 'dark' }
    ])
  })

  it('loads a bundled id from the bundled folder', () => {
    const { user, shipped } = setup()
    theme(shipped, 'glass', 'Shipped glass')
    const r = createThemeScanner({ dir: user, bundled: { dir: shipped, ids: IDS }, log }).load(
      'glass'
    )
    expect(r.ok && r.bundle.name).toBe('Shipped glass')
  })

  it('a user folder with a bundled id is skipped and does not change load()', () => {
    const { user, shipped } = setup()
    theme(shipped, 'glass', 'Shipped glass')
    theme(user, 'glass', 'Stale copy')
    const s = createThemeScanner({ dir: user, bundled: { dir: shipped, ids: IDS }, log })
    expect(s.scan()).toEqual([{ id: 'glass', name: 'Shipped glass', colorScheme: 'dark' }])
    expect(logs).toContain('[claude-watcher][themes] code=theme_id_reserved id=glass')
    const r = s.load('glass')
    expect(r.ok && r.bundle.name).toBe('Shipped glass')
  })

  it('skips a broken user folder with a bundled id before reading it — never a broken row', () => {
    const { user, shipped } = setup()
    theme(shipped, 'glass', 'Shipped glass')
    mkdirSync(join(user, 'glass')) // no theme.json at all
    symlinkSync(join(shipped, 'glass'), join(user, 'paper')) // a link in the user folder
    const s = createThemeScanner({ dir: user, bundled: { dir: shipped, ids: IDS }, log })
    const listed = s.scan()
    expect(listed.filter((t) => t.error !== undefined)).toEqual([])
    expect(listed.map((t) => t.id)).toEqual(['glass'])
  })

  it('ignores a bundled-dir folder that is not allowlisted (builtin-dark in dev)', () => {
    const { user, shipped } = setup()
    theme(shipped, 'glass', 'Glass')
    theme(shipped, 'builtin-dark', 'Built-in dark')
    const s = createThemeScanner({ dir: user, bundled: { dir: shipped, ids: IDS }, log })
    expect(s.scan().map((t) => t.id)).toEqual(['glass'])
    expect(s.load('builtin-dark')).toEqual({ ok: false, code: 'theme_not_found' })
  })

  it('a missing bundled folder logs theme_not_found and scan() still returns user themes', () => {
    const { user, shipped } = setup()
    theme(shipped, 'glass', 'Glass') // paper is missing
    theme(user, 'mine', 'Mine')
    const s = createThemeScanner({ dir: user, bundled: { dir: shipped, ids: IDS }, log })
    expect(s.scan().map((t) => t.id)).toEqual(['glass', 'mine'])
    expect(logs).toContain('[claude-watcher][themes] code=theme_not_found id=paper')
  })

  it('load of a missing bundled id never falls back to the user folder', () => {
    const { user, shipped } = setup()
    theme(user, 'paper', 'User paper')
    const s = createThemeScanner({ dir: user, bundled: { dir: shipped, ids: IDS }, log })
    expect(s.load('paper')).toEqual({ ok: false, code: 'theme_not_found' })
  })

  it('still lists bundled themes when the user folder is unusable', () => {
    const { shipped } = setup()
    theme(shipped, 'glass', 'Glass')
    const file = join(tmp(), 'not-a-dir')
    writeFileSync(file, 'x') // a regular FILE where the user themes folder should be
    const s = createThemeScanner({ dir: file, bundled: { dir: shipped, ids: IDS }, log })
    expect(s.scan().map((t) => t.id)).toEqual(['glass'])
    expect(logs).toContain('[claude-watcher][themes] code=theme_read_failed')
    expect(s.load('glass').ok).toBe(true)
  })

  it('never creates the bundled folder', () => {
    const { user } = setup()
    const shipped = join(tmp(), 'absent')
    createThemeScanner({ dir: user, bundled: { dir: shipped, ids: IDS }, log }).scan()
    expect(existsSync(shipped)).toBe(false)
  })

  it('never logs the bundled folder path', () => {
    const { user, shipped } = setup()
    createThemeScanner({ dir: user, bundled: { dir: shipped, ids: IDS }, log }).scan()
    expect(logs.join('\n')).not.toContain(shipped)
  })

  it('the real docs/themes/examples, read as the bundled root, lists Liquid Glass and Paper clean', () => {
    const { user } = setup()
    const here = dirname(fileURLToPath(import.meta.url))
    const examples = resolve(here, '../../../docs/themes/examples')
    const s = createThemeScanner({
      dir: user,
      bundled: { dir: examples, ids: BUNDLED_THEME_IDS },
      log
    })
    expect(s.scan()).toEqual([
      expect.objectContaining({ id: 'liquid-glass', name: 'Liquid Glass' }),
      expect.objectContaining({ id: 'paper', name: 'Paper' })
    ])
    expect(s.scan().some((t) => t.error !== undefined)).toBe(false)
    expect(s.load('liquid-glass').ok).toBe(true)
  })
})
