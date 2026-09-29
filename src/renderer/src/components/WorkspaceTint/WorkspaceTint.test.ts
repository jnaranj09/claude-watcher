// The ONE tone → tint mapping. Reads the stylesheet TEXT: a CSS-module import is a proxy that
// answers every key, so indexing `styles` could never catch a missing class (design.md).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { WORKSPACE_COLORS } from '../../../../shared/schemas/workspace'

const CSS = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/WorkspaceTint/WorkspaceTint.module.css'),
  'utf8'
)

function rule(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(0)
  return CSS.slice(start, CSS.indexOf('}', start))
}

describe('WorkspaceTint.module.css', () => {
  it('maps every WORKSPACE_COLORS entry to its own two tokens', () => {
    for (const c of WORKSPACE_COLORS) {
      const body = rule(`.${c}`)
      expect(body).toContain(`--ws-fill: var(--workspace-${c}-fill)`)
      expect(body).toContain(`--ws-border: var(--workspace-${c}-border)`)
    }
  })

  // Custom properties INHERIT. A Global label inside a tinted row must not pick up the row's
  // colour, so the neutral class resets both to the guaranteed-invalid value.
  it('resets the tint for the untinted tones', () => {
    const body = rule('.neutral')
    expect(body).toContain('--ws-fill: initial')
    expect(body).toContain('--ws-border: initial')
  })

  it('holds no colour literal of its own', () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})
