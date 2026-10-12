import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent } from '../../test/renderComponent'
import { ScopeFilter } from './ScopeFilter'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

describe('ScopeFilter workspace names', () => {
  // A workspace is its tinted name, never a dot (spec 2026-09-29). Global and the orphan entry are
  // untinted names.
  it('draws each entry as a tinted name box, with no dot', () => {
    const r = renderComponent(
      <ScopeFilter
        value="all"
        workspaces={[{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }]}
        allLabel="All templates"
        showOrphans
        onChange={vi.fn()}
        testId="scope"
        ariaLabel="Scope"
      />
    )
    cleanup = r.unmount
    act(() => (r.container.querySelector('[data-testid="scope"]') as HTMLElement).click())
    const tones = [...document.querySelectorAll('[data-testid="scope-list"] [data-tone]')].map(
      (e) => e.getAttribute('data-tone')
    )
    expect(tones).toEqual(['global', 'blue', 'orphan'])
    expect(document.querySelector('[data-testid="scope-list"] [aria-hidden="true"]')).toBeNull()
  })

  it('the closed trigger shows the workspace NAME as plain text, no tint box (spec 2026-10-03 G)', () => {
    const r = renderComponent(
      <ScopeFilter
        value="ws:w1"
        workspaces={[{ id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }]}
        allLabel="All templates"
        showOrphans={false}
        onChange={vi.fn()}
        testId="scope"
        ariaLabel="Scope"
      />
    )
    cleanup = r.unmount
    const trigger = r.container.querySelector('[data-testid="scope"]')
    expect(trigger?.querySelector('[data-tone]')).toBeNull()
    expect(trigger?.textContent).toContain('Ops')
  })
})
