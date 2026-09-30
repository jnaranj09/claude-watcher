// Action feedback (spec 2026-09-29 §3) — the structural guard. A fire-and-forget bridge call
// (`void window.<a>.<b>(…)`) with no `.catch(` is an unhandled rejection: the silent failures this
// spec found (Settings' Copy, App's move card, the quit request/cancel paths) were all this shape.
// It walks every renderer source and, from each `void window.a.b(`, matches the parens to the
// call's end, skips any `.then(…)` links, and requires `.catch(` next.
//
// Limit (known, accepted): it does not see `void <wrapper>()` — persistSettingsPatch, moveRule and
// setSessionTags were the pattern behind three silent failures; those are pinned by per-surface
// tests instead.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(process.cwd(), 'src/renderer/src')

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sources(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Index just past the `)` that closes the `(` at `open`, or -1. Skips string/template literals. */
function closeParen(text: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (quote !== null) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** True when `args` (the text between a call's parens) has a comma outside any nesting/string. */
function hasTopLevelComma(args: string): boolean {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < args.length; i++) {
    const c = args[i]
    if (quote !== null) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) return true
  }
  return false
}

function uncaughtBridgeCalls(text: string): number[] {
  const offenders: number[] = []
  const call = /void\s+window\s*\.\s*\w+\s*\.\s*\w+\s*\(/g
  for (let m = call.exec(text); m !== null; m = call.exec(text)) {
    let at = closeParen(text, m.index + m[0].length - 1)
    let caught = false
    while (at !== -1) {
      const rest = text.slice(at)
      const link = /^\s*\.\s*(then|catch)\s*\(/.exec(rest)
      if (link === null) break
      if (link[1] === 'catch') {
        caught = true
        break
      }
      const open = at + link[0].length - 1
      const end = closeParen(text, open)
      // `.then(ok, fail)` handles the rejection itself: a top-level comma inside its parens.
      if (end !== -1 && hasTopLevelComma(text.slice(open + 1, end - 1))) {
        caught = true
        break
      }
      at = end
    }
    if (!caught) offenders.push(text.slice(0, m.index).split('\n').length)
  }
  return offenders
}

describe('uncaughtBridgeCalls (non-vacuity)', () => {
  it('flags a bare void bridge call', () => {
    expect(uncaughtBridgeCalls('void window.quit.cancel()')).toEqual([1])
  })

  it('flags one whose only link is .then', () => {
    expect(uncaughtBridgeCalls('x\nvoid window.api.x(a).then(() => f(")"))')).toEqual([2])
  })

  it('accepts a two-argument .then(ok, fail) but not a one-argument one with a comma inside', () => {
    expect(uncaughtBridgeCalls('void window.a.b().then(() => ok(), () => bad())')).toEqual([])
    expect(uncaughtBridgeCalls('void window.a.b().then(() => f(1, 2))')).toEqual([1])
  })

  it('accepts .catch, directly or after .then links, across lines', () => {
    const ok = [
      'void window.launch.archiveSession(id).catch(() => {})',
      'void window.clipboard\n  .writeText(sel)\n  .then(() => ok())\n  .catch(() => bad())',
      "void window.quit.requestQuit().catch(() => console.warn('code=x'))"
    ]
    for (const text of ok) expect(uncaughtBridgeCalls(text)).toEqual([])
  })
})

describe('every void bridge call in the renderer handles its rejection', () => {
  it('has no offender', () => {
    const offenders: string[] = []
    for (const file of sources(root)) {
      for (const line of uncaughtBridgeCalls(readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(root, file)}:${line}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
