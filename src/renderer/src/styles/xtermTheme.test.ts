// Story 1.3 — xtermTheme drift guard (AC-2).
//
// Asserts each `xtermTheme` field equals its DESIGN.md `embedded-terminal` value,
// reading the AUTHORITATIVE source (DESIGN.md frontmatter) directly so a drift
// between the shipped theme object and the UX spec fails LOUDLY (one source of
// truth, UX-DR2). `{colors.*}` references in the frontmatter are resolved to their
// concrete hex from the same frontmatter `colors` block.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { xtermTheme } from './xtermTheme'

const DESIGN_MD = resolve(
  dirname(__filename),
  '../../../../_bmad-output/planning-artifacts/ux-designs/ux-c9watch-webapp-2026-06-18/DESIGN.md'
)

/** Pull a `key: value` line (value may be quoted or `{ref}`) from a YAML chunk.
 *  A `#` only starts a comment when preceded by whitespace — a leading `#hex`
 *  value must NOT be mistaken for a comment. */
function field(block: string, key: string): string {
  const re = new RegExp(`^\\s*${key}:\\s*(.+?)\\s*(?:\\s#.*)?$`, 'm')
  const m = block.match(re)
  if (!m || m[1] === undefined) throw new Error(`DESIGN.md embedded-terminal missing "${key}"`)
  return m[1].replace(/^['"]|['"]$/g, '').trim()
}

/** Resolve a `{colors.x}` reference against the frontmatter `colors:` block. */
function resolveRef(value: string, frontmatter: string): string {
  const ref = value.match(/^\{colors\.([\w-]+)\}$/)
  if (!ref) return value
  const name = ref[1]
  const re = new RegExp(`^\\s*${name}:\\s*['"]?(#[0-9a-fA-F]+|rgba\\([^)]*\\))['"]?`, 'm')
  const m = frontmatter.match(re)
  if (!m || m[1] === undefined) throw new Error(`DESIGN.md colors.${name} not found`)
  return m[1]
}

const md = readFileSync(DESIGN_MD, 'utf8')
const frontmatter = md.slice(md.indexOf('---') + 3, md.indexOf('---', 3))
// Isolate the `embedded-terminal:` block (indented children up to the closing ---).
const etStart = frontmatter.indexOf('embedded-terminal:')
const etBlock = frontmatter.slice(etStart)

function expected(key: string): string {
  return resolveRef(field(etBlock, key), frontmatter)
}

describe('xtermTheme — derived 1:1 from DESIGN.md embedded-terminal (AC-2)', () => {
  it.each([
    ['background', () => xtermTheme.background],
    ['foreground', () => xtermTheme.foreground],
    ['cursor', () => xtermTheme.cursor],
    ['cursorAccent', () => xtermTheme.cursorAccent],
    ['selectionBackground', () => xtermTheme.selectionBackground],
    ['black', () => xtermTheme.black],
    ['red', () => xtermTheme.red],
    ['green', () => xtermTheme.green],
    ['yellow', () => xtermTheme.yellow],
    ['blue', () => xtermTheme.blue],
    ['magenta', () => xtermTheme.magenta],
    ['cyan', () => xtermTheme.cyan],
    ['white', () => xtermTheme.white],
    ['brightBlack', () => xtermTheme.brightBlack],
    ['brightRed', () => xtermTheme.brightRed],
    ['brightGreen', () => xtermTheme.brightGreen],
    ['brightYellow', () => xtermTheme.brightYellow],
    ['brightBlue', () => xtermTheme.brightBlue],
    ['brightMagenta', () => xtermTheme.brightMagenta],
    ['brightCyan', () => xtermTheme.brightCyan],
    ['brightWhite', () => xtermTheme.brightWhite]
  ])('%s equals the DESIGN.md value', (key, getActual) => {
    const want = expected(key).replace(/\s+/g, '')
    const got = (getActual() ?? '').replace(/\s+/g, '')
    expect(got).toBe(want)
  })

  it('keeps the full Catppuccin Mocha ANSI red/yellow (NOT reconciled with gold)', () => {
    // Gold (#ffcf29) is the app alert hue; the terminal's ANSI red/yellow are a
    // different plane and must stay verbatim.
    expect(xtermTheme.red).toBe('#f38ba8')
    expect(xtermTheme.yellow).toBe('#f9e2af')
    expect(xtermTheme.red).not.toBe('#ffcf29')
    expect(xtermTheme.yellow).not.toBe('#ffcf29')
  })
})
