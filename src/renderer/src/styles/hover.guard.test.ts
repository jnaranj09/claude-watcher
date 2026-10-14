// Every clickable control shows a hover, in every theme. Two failures this replaced: controls with
// `cursor: pointer` and no `:hover` rule at all (the Select box, the card), and hovers painted with
// a SURFACE token (`--bg-surface`, …) that vanished wherever that surface was the panel's own
// colour (Paper's white-on-white). A hover paints the `--bg-hover` layer, or moves the border / ink.
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

// `selector { body }` leaves; an @media wrapper's inner rules match on their own.
function rules(file: string): { selectors: string[]; body: string }[] {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    selectors: sel!.split(',').map((s) => s.trim()),
    body: body!
  }))
}

// The compound selector a pseudo-class sits on: `.a:hover .b` → `.a:hover`.
const compoundWith = (selector: string, pseudo: string): string | undefined =>
  selector.split(/\s+|>|\+|~/).find((part) => part.includes(pseudo))

const classesOf = (compound: string): string[] =>
  [...compound.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]!)

// A clickable class whose hover its PARENT paints, so a control drawn beside it inside that parent
// sits in the same highlight. Key: `<file> .<class>` → the parent class, which must have its own
// `:hover` rule in the same sheet (or the entry hides a missing hover).
const HOVERED_BY_PARENT = new Map([
  // The Manage rail row hovers as a whole, so the favorite pin and the row checkbox, drawn before
  // the select button, are inside the highlight (owner, 2026-10-14).
  ['components/ManageDialog/ManageDialog.module.css .rowSelect', 'row']
])

function clickableWithoutHover(): string[] {
  const out: string[] = []
  for (const file of sheets) {
    const all = rules(file)
    const clickable = new Set<string>()
    const hovered = new Set<string>()
    for (const { selectors, body } of all) {
      for (const sel of selectors) {
        const hover = compoundWith(sel, ':hover')
        if (hover) for (const c of classesOf(hover)) hovered.add(c)
        if (/cursor:\s*pointer/.test(body) && !sel.includes(':')) {
          const last =
            sel
              .split(/\s+|>|\+|~/)
              .filter(Boolean)
              .at(-1) ?? ''
          const cls = classesOf(last).at(-1)
          if (cls) clickable.add(cls)
        }
      }
    }
    for (const c of clickable) {
      const key = `${relative(rendererDir, file)} .${c}`
      const parent = HOVERED_BY_PARENT.get(key)
      if (!hovered.has(c) && (parent === undefined || !hovered.has(parent))) out.push(key)
    }
  }
  return out
}

// A hover that previews a state painted with the same token. Key: `<file> <selector>`.
const ALLOWED = new Set([
  // A resting rail row (`--bg-row-rest`) previews the active tab, which IS the ground.
  'components/attention/AttentionRail.module.css .row:not(.active):hover',
  'components/attention/AttentionRail.module.css .startingRow:hover'
])

const SURFACE_FILL = /^\s*background(?:-color)?\s*:\s*var\(--bg-(?:base|surface|surface-raised)\)/m

function hoverPaintedWithSurface(): string[] {
  const out: string[] = []
  for (const file of sheets) {
    for (const { selectors, body } of rules(file)) {
      const hover = selectors.find((s) => s.includes(':hover'))
      const key = `${relative(rendererDir, file)} ${hover}`
      if (hover && SURFACE_FILL.test(body) && !ALLOWED.has(key)) out.push(key)
    }
  }
  return out
}

describe('hover guard: every clickable control shows a hover in every theme', () => {
  it('every class with `cursor: pointer` has a `:hover` rule in its sheet', () => {
    expect(clickableWithoutHover()).toEqual([])
  })

  it('no hover paints a surface token (use the --bg-hover layer)', () => {
    expect(hoverPaintedWithSurface()).toEqual([])
  })
})
