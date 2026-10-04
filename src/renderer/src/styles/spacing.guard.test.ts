// Every gap / padding / margin in a component stylesheet is a spacing ROLE (spec
// 2026-10-01-spacing-roles-design.md). A raw length or a `--space-N` step is a second rhythm —
// the drift this standard replaced (one job, four values across the app).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it, expect } from 'vitest'

const rendererDir = join(__dirname, '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const sheets = walk(rendererDir).filter((f) => f.endsWith('.module.css'))

const SPACING =
  /^\s*((?:row-|column-)?gap|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|scroll-padding(?:-[a-z-]+)?)\s*:\s*([^;]+);/gm

// Vars that are geometry, not rhythm: a calc() may combine them with a role.
const GEOMETRY_VARS = new Set(['--rounded-md', '--rail-tab-inset', '--rail-tools-width'])

// Optical nudges and geometry sizes, each with its reason. Key: `<file> <prop>: <value>`.
const ALLOWED = new Set([
  // Optical: the icon disc sits on the title's cap height.
  'components/Callout/Callout.module.css margin-top: 1px',
  // Overlaps the rail's own 1px border.
  'components/attention/AttentionRail.module.css margin-right: -1px',
  // A space's width inside running text.
  'components/SessionCard/SessionCard.module.css margin-left: 0.3em',
  // Geometry: Tab must park a field clear of the sticky Manage footer (a 32px md Button + its
  // --gap-actions top / compact bottom padding).
  'components/ManageDialog/ManageDialog.module.css scroll-padding-block: var(--inset-compact-x) calc(32px + var(--gap-actions) + var(--inset-compact-y) + var(--inset-compact-x))',
  // Geometry: a row reached by keyboard parks above the rail list's 32px end fade.
  'components/ManageDialog/ManageDialog.module.css scroll-padding-bottom: 32px',
  // Geometry: Select all's box lines up with the row boxes past the row's 1px border.
  'components/SessionsDialog/SessionsDialog.module.css padding-left: calc(var(--inset-item-x) + 1px)',
  // Geometry: the 14px search icon the text starts past.
  'components/TextInput/TextInput.module.css padding-left: calc(var(--inset-compact-x) + 14px + var(--gap-inline))',
  // The rail header and pinned slot compensate the rail's 1px right border.
  'components/attention/AttentionRail.module.css padding-right: calc(var(--inset-item-x) + 1px)',
  'components/attention/AttentionRail.module.css padding: var(--inset-item-y) 1px var(--inset-item-y) 0',
  'components/attention/AttentionRail.module.css padding: var(--inset-card) 1px var(--inset-card) 0',
  // Geometry: the 28px tag-peek toggle the row name keeps clear of.
  'components/attention/AttentionRail.module.css padding-right: calc(var(--inset-item-x) + 28px)',
  'components/attention/AttentionRail.module.css padding-right: calc(var(--inset-item-x) + 28px - var(--rounded-md))',
  // Geometry: the 8px status dot the tag line indents past.
  'components/attention/AttentionRail.module.css padding-left: calc(8px + var(--inset-compact-x))',
  // Geometry: the collapsed active tab hands back the gutter + wall + its own border (1px each)
  // it swallowed, so the dot stays centred over the square.
  'components/attention/AttentionRail.module.css padding-right: calc(var(--rail-tab-inset) + 2px)',
  'components/attention/AttentionRail.module.css margin-right: calc(var(--rounded-md) - 1px)',
  'components/attention/AttentionRail.module.css padding-right: calc(var(--rail-tab-inset) + 2px - var(--rounded-md))'
])

function offenders(): string[] {
  const out: string[] = []
  for (const file of sheets) {
    const rel = relative(rendererDir, file)
    for (const [, prop, raw] of readFileSync(file, 'utf8').matchAll(SPACING)) {
      const value = raw!.replace(/\s+/g, ' ').trim()
      if (ALLOWED.has(`${rel} ${prop}: ${value}`)) continue
      const vars = [...value.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!)
      const badVar = vars.some((v) => !/^--(gap|inset)-/.test(v) && !GEOMETRY_VARS.has(v))
      // Strip vars and calc punctuation; what is left must hold no length. A bare number (a
      // calc() multiplier like `-1 *`) is not a length.
      const rest = value.replace(/var\([^)]*\)/g, ' ').replace(/calc\(|[()*/+]|\s-\s/g, ' ')
      const rawLength = rest.split(/\s+/).some((t) => /^-?\d*\.?\d+(px|em|rem)$/.test(t))
      if (badVar || rawLength) out.push(`${rel} ${prop}: ${value}`)
    }
  }
  return out
}

describe('spacing guard: component CSS uses spacing roles only', () => {
  it('no raw length and no --space-N step in a gap / padding / margin', () => {
    expect(offenders()).toEqual([])
  })
})
