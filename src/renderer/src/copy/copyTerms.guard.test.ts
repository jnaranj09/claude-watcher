// technical-taste §4 "Same thing, same word" — a word in copy/terms.ts is the ONE source for that
// thing's name. This guard fails when one of those strings is typed by hand in another renderer
// file (a string literal or JSX text equal to it), so a new control has to import the word and
// can never drift from its siblings. It bans no word: renaming means editing terms.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it, expect } from 'vitest'
import * as terms from './terms'

const RENDERER = join(process.cwd(), 'src/renderer/src')
const SELF = join(RENDERER, 'copy/terms.ts')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sourceFiles(path)
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || name.endsWith('.d.ts')) return []
    return path === SELF ? [] : [path]
  })
}

/** String literals and JSX text in `src`, comments stripped. */
export function textsIn(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const out: string[] = []
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`$]*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  for (const m of code.matchAll(/>([^<>{}]+)</g)) out.push(m[1] ?? '')
  return out.map((t) => t.trim()).filter((t) => t !== '')
}

const words = new Set<string>(
  Object.values(terms).flatMap((group) => Object.values(group).filter((v) => typeof v === 'string'))
)

describe('copy/terms.ts — one source per word', () => {
  it('finds its own words (the guard is not empty)', () => {
    expect(words.has('Open shell')).toBe(true)
    expect(textsIn(`<b title='Open shell'>x</b>`)).toContain('Open shell')
    expect(textsIn(`<span aria-hidden>{'>_'}</span> Shell\n</Button>`)).toContain('Shell')
  })

  it('no renderer file types a terms.ts word by hand — import it instead', () => {
    const typed = sourceFiles(RENDERER).flatMap((file) =>
      textsIn(readFileSync(file, 'utf8'))
        .filter((t) => words.has(t))
        .map((t) => `${relative(RENDERER, file)}: "${t}"`)
    )
    expect(typed).toEqual([])
  })
})
