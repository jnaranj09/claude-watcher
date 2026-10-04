// A workspace NAME in its light tint — the replacement for the workspace dot in every list.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../../test/renderComponent'
import { WorkspaceLabel } from './WorkspaceLabel'

const CSS = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/WorkspaceLabel/WorkspaceLabel.module.css'),
  'utf8'
)

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

describe('WorkspaceLabel', () => {
  it('shows the name, keeps it as a title, and carries its tone', () => {
    const r = renderComponent(<WorkspaceLabel name="docs.example.app" tone="blue" testId="wl" />)
    cleanup = r.unmount
    const el = r.container.querySelector('[data-testid="wl"]')
    expect(el?.textContent).toBe('docs.example.app')
    expect(el?.getAttribute('title')).toBe('docs.example.app')
    expect(el?.getAttribute('data-tone')).toBe('blue')
  })

  it('is never a dot: no aria-hidden swatch, the name is the content', () => {
    const r = renderComponent(<WorkspaceLabel name="Ops" tone="green" testId="wl" />)
    cleanup = r.unmount
    const el = r.container.querySelector('[data-testid="wl"]')
    expect(el?.children.length).toBe(0)
    expect(el?.getAttribute('aria-hidden')).toBeNull()
  })

  // Any operator-typed name truncates and keeps a title (design.md) — a long domain in a
  // dropdown trigger must not push the caret out.
  it('truncates with an ellipsis and reads the tint with a fallback', () => {
    const label = CSS.slice(CSS.indexOf('.label {'), CSS.indexOf('}', CSS.indexOf('.label {')))
    expect(label).toContain('text-overflow: ellipsis')
    expect(label).toContain('white-space: nowrap')
    expect(label).toContain('overflow: hidden')
    expect(label).toContain('max-width: 100%')
    expect(label).toContain('background: var(--ws-fill, transparent)')
    expect(label).toContain('border: 1px solid var(--ws-border, var(--border))')
  })

  it('draws the orphan name in the secondary ink', () => {
    expect(CSS).toMatch(/\.label\[data-tone='orphan'\]\s*\{[^}]*color:\s*var\(--text-secondary\)/)
  })
})

describe('WorkspaceLabel — Global (spec 2026-10-03 H)', () => {
  it('Global is an outlined chip: --border-strong, --text-secondary, no fill', () => {
    expect(CSS).toMatch(
      /\.label\[data-tone='global'\]\s*\{[^}]*border-color:\s*var\(--border-strong\)[^}]*color:\s*var\(--text-secondary\)/
    )
    expect(CSS).not.toMatch(/\.label\[data-tone='global'\]\s*\{[^}]*background/)
  })
})
