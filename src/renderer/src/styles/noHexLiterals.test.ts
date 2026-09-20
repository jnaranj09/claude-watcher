// Custom themes (D-9) — a theme whose `tokens` do not reach a dialog is a standard that lies.
// Every colour in the renderer is a token; this walk fails on the next hand-typed hex.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
// This walk covers src/renderer/src ONLY — deliberately, not an oversight. Custom themes put
// hex literals in `src/shared/theme/` too (tokens.ts, xtermTheme.ts, themeDocs.ts's generated
// examples), which nothing here guards. That is correct TODAY: `src/shared/` has no components
// to leak a hand-typed color into a dialog, and those files ARE the token source everything
// else (main's validation, the generated SDK docs) transcribes FROM — the whole reason a hex
// literal is allowed to originate there. If a component ever moves into `src/shared/`, this
// boundary needs revisiting.
const root = resolve(here, '..') // src/renderer/src

/** The documented exceptions, as paths relative to src/renderer/src. */
const ALLOWED = new Set([
  'styles/tokens.css', // the sheet itself
  'styles/tokens.ts', // a re-export today; kept listed so a future value here is still allowed
  'styles/xtermTheme.ts',
  'components/WorkspaceDot/WorkspaceDot.module.css', // the operator's workspace colours (design.md)
  'SmokeCockpit.tsx' // the diagnostic screen's deliberately hardcoded xterm theme
])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(css|ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('no hex colour literal outside the token files', () => {
  it('every renderer source colours through var(--token)', () => {
    const offenders: string[] = []
    for (const file of walk(root)) {
      const rel = relative(root, file)
      if (ALLOWED.has(rel)) continue
      const text = stripComments(readFileSync(file, 'utf8'))
      const m = text.match(/#[0-9a-fA-F]{3,8}\b/g)
      if (m) offenders.push(`${rel}: ${m.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('the allow-list names only files that exist', () => {
    for (const rel of ALLOWED) expect(() => readFileSync(join(root, rel))).not.toThrow()
  })
})
