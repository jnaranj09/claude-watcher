import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { ScopeMarker } from './ScopeMarker'

const WS = [{ id: 'w1', name: 'Ops', color: 'blue' as const, defaultCwd: null }]
let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})
function render(workspaceId: string | null): RenderResult {
  const r = renderComponent(<ScopeMarker workspaceId={workspaceId} workspaces={WS} />)
  cleanup = r.unmount
  return r
}
const label = (r: RenderResult): Element | null =>
  r.container.querySelector('[data-testid="scope-marker"] [data-tone]')

describe('ScopeMarker (spec 2026-10-03 H)', () => {
  it('a workspace row: the name in its tint', () => {
    const r = render('w1')
    expect(label(r)?.textContent).toBe('Ops')
    expect(label(r)?.getAttribute('data-tone')).toBe('blue')
  })
  it('a global row: "Global"', () => {
    const r = render(null)
    expect(label(r)?.textContent).toBe('Global')
    expect(label(r)?.getAttribute('data-tone')).toBe('global')
  })
  it('a row whose workspace is gone: "(no workspace)"', () => {
    const r = render('gone')
    expect(label(r)?.textContent).toBe('(no workspace)')
    expect(label(r)?.getAttribute('data-tone')).toBe('orphan')
  })
  it('sits at the row`s right end and never shrinks below its text', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/ScopeFilter/ScopeMarker.module.css'),
      'utf8'
    )
    expect(css).toMatch(/\.marker\s*\{[^}]*margin-left:\s*auto/)
    expect(css).toMatch(/\.marker\s*\{[^}]*flex:\s*none/)
  })
})
