// Bundled themes (spec 2026-09-25) — the id list, where the folder is, and the packaging entry
// that must name the same ids. main-unit (node) project.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { BUNDLED_THEME_IDS, bundledThemesDir } from './bundledThemes'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')

describe('bundledThemesDir', () => {
  it('is <resourcesPath>/themes in a packaged app', () => {
    expect(
      bundledThemesDir({ isPackaged: true, resourcesPath: '/opt/cw/resources', mainDir: '/x' })
    ).toBe(join('/opt/cw/resources', 'themes'))
  })
  it('is the repo examples folder when unpackaged (main runs from out/main)', () => {
    expect(
      bundledThemesDir({
        isPackaged: false,
        resourcesPath: '/ignored',
        mainDir: join(repo, 'out', 'main')
      })
    ).toBe(join(repo, 'docs', 'themes', 'examples'))
  })
})

describe('BUNDLED_THEME_IDS', () => {
  it('ships Liquid Glass and Paper, never builtin-dark (a copy of Default)', () => {
    expect([...BUNDLED_THEME_IDS]).toEqual(['liquid-glass', 'paper'])
  })
  // The package and the scanner must agree. Read as TEXT (no yaml dependency): the filter lines
  // of the one extraResources entry that copies docs/themes/examples.
  it('electron-builder.yml copies exactly these ids, without their src/ folders', () => {
    const yml = readFileSync(join(repo, 'electron-builder.yml'), 'utf8')
    const block = /extraResources:\n((?:[ ]{2,}.*\n)+)/.exec(yml)?.[1] ?? ''
    expect(block).toContain('from: docs/themes/examples')
    expect(block).toContain('to: themes')
    const included = [...block.matchAll(/^\s+- ([a-z0-9-]+)\/\*\*\s*$/gm)].map((m) => m[1])
    expect(included).toEqual([...BUNDLED_THEME_IDS])
    expect(block).toMatch(/- '!\*\/src\/\*\*'/)
  })
})
