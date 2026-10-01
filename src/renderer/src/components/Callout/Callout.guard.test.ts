// Every in-page error and success is a Callout (spec 2026-10-01-feedback-callout-design.md). A
// bare `role="alert"` line, or text coloured --danger in a component's own stylesheet, is a second
// feedback style beside the Callout — the plain red line this standard replaced.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it, expect } from 'vitest'

const rendererDir = join(__dirname, '../..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const sources = walk(rendererDir).filter((f) => !/\.test\.tsx?$/.test(f))
const rel = (f: string): string => relative(rendererDir, f)

function offenders(ext: string, allowed: ReadonlySet<string>, pattern: RegExp): string[] {
  return sources
    .filter((f) => f.endsWith(ext) && !allowed.has(rel(f)))
    .filter((f) => pattern.test(readFileSync(f, 'utf8')))
    .map(rel)
}

describe('feedback guard: Callout owns every in-page message', () => {
  it('no role="alert" outside Callout and Toaster', () => {
    const allowed = new Set([
      'components/Callout/Callout.tsx',
      'components/Toaster/Toaster.tsx',
      // The dead PANE ("Claude exited …") is the alert; its refusal line inside is a Callout
      // with announce={false}.
      'terminal/EmbeddedTerminal.tsx'
    ])
    expect(offenders('.tsx', allowed, /role=["']alert["']/)).toEqual([])
  })

  it('no text coloured --danger outside Callout, Toaster, Button and the rules badge', () => {
    const allowed = new Set([
      'components/Callout/Callout.module.css',
      'components/Toaster/Toaster.module.css',
      'components/Button/Button.module.css',
      // `.broken` marks a rule that can never run — a row badge, not a feedback line.
      'components/RulesDialog/RulesDialog.module.css'
    ])
    // `color:` at the start of a declaration only — `border-color: var(--danger)` (an invalid
    // field's border) is not text.
    expect(offenders('.module.css', allowed, /(^|[\s;{])color:\s*var\(--danger\)/m)).toEqual([])
  })
})
