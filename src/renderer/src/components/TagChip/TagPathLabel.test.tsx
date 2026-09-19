import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderComponent } from '../../test/renderComponent'
import { TagPathLabel } from './TagPathLabel'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

describe('TagPathLabel (D-13)', () => {
  it('draws parent/ muted and the leaf primary, indented by depth, named by the FULL name', () => {
    const r = renderComponent(<TagPathLabel tag={{ id: 't', name: 'acme/prod', color: 'blue' }} />)
    cleanup = r.unmount
    const root = r.container.querySelector<HTMLElement>('[data-testid="tag-path"]')
    expect(root?.getAttribute('aria-label')).toBe('acme/prod')
    expect(root?.getAttribute('title')).toBe('acme/prod')
    expect(root?.style.paddingLeft).toBe('calc(1 * var(--space-3))')
    expect(r.container.querySelector('[data-testid="tag-path-parent"]')?.textContent).toBe('acme/')
    expect(r.container.querySelector('[data-testid="tag-path-leaf"]')?.textContent).toBe('prod')
  })
  it('a plain name has no parent span and no indent', () => {
    const r = renderComponent(<TagPathLabel tag={{ id: 't', name: 'acme', color: 'blue' }} />)
    cleanup = r.unmount
    expect(r.container.querySelector('[data-testid="tag-path-parent"]')).toBeNull()
    expect(
      r.container.querySelector<HTMLElement>('[data-testid="tag-path"]')?.style.paddingLeft
    ).toBe('')
  })
  it('the parent is --text-secondary and the leaf --text-primary (never muted on a raised panel)', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/TagChip/TagChip.module.css'),
      'utf8'
    )
    expect(css).toMatch(/\.pathParent\s*\{[^}]*var\(--text-secondary\)/)
    expect(css).toMatch(/\.pathLeaf\s*\{[^}]*var\(--text-primary\)/)
    expect(css).not.toMatch(/\.pathParent\s*\{[^}]*--text-muted/)
  })
})
