// Popover — the ONE drawing of a menu / list popup (spec 2026-10-01-popover-standard-design.md).
// jsdom `unit` project. CSS-module imports are proxies here (design.md), so the look is pinned by
// reading the stylesheet as text.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { Popover } from './Popover'
import { Presence } from '../Presence/Presence'
import { pointerInput } from '../../test/pointerInput'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})
function render(node: React.ReactNode): RenderResult {
  const r = renderComponent(<>{node}</>)
  cleanup = r.unmount
  return r
}
const q = (r: RenderResult, sel: string): HTMLElement => {
  const el = r.container.querySelector<HTMLElement>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

describe('Popover parts', () => {
  it('Surface stamps data-popover and passes role, aria and the test id through', () => {
    const onKeyDown = vi.fn()
    const r = render(
      <Popover.Surface role="menu" aria-label="Menu" testId="m" onKeyDown={onKeyDown}>
        x
      </Popover.Surface>
    )
    const s = q(r, '[data-testid="m"]')
    expect(s.hasAttribute('data-popover')).toBe(true)
    expect(s.getAttribute('role')).toBe('menu')
    expect(s.getAttribute('aria-label')).toBe('Menu')
    act(() => {
      s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it('List stamps data-popover-list and is not a popover box', () => {
    const r = render(
      <Popover.List role="listbox" testId="l">
        x
      </Popover.List>
    )
    const l = q(r, '[data-testid="l"]')
    expect(l.hasAttribute('data-popover-list')).toBe(true)
    expect(l.hasAttribute('data-popover')).toBe(false)
  })

  it('Item is a button that stamps data-popover-item and forwards role, ARIA state and click', () => {
    const onClick = vi.fn()
    const r = render(
      <Popover.Item role="menuitemradio" aria-checked testId="i" onClick={onClick}>
        Row
      </Popover.Item>
    )
    const i = q(r, '[data-testid="i"]')
    expect(i.tagName).toBe('BUTTON')
    expect((i as HTMLButtonElement).type).toBe('button')
    expect(i.hasAttribute('data-popover-item')).toBe(true)
    expect(i.getAttribute('role')).toBe('menuitemradio')
    expect(i.getAttribute('aria-checked')).toBe('true')
    act(() => i.click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('Item stamps data-tone only with a tone, and data-active only when active', () => {
    const r = render(
      <>
        <Popover.Item testId="plain">a</Popover.Item>
        <Popover.Item testId="tinted" tone="blue" active>
          b
        </Popover.Item>
      </>
    )
    const plain = q(r, '[data-testid="plain"]')
    const tinted = q(r, '[data-testid="tinted"]')
    expect(plain.hasAttribute('data-tone')).toBe(false)
    expect(plain.hasAttribute('data-active')).toBe(false)
    expect(tinted.getAttribute('data-tone')).toBe('blue')
    expect(tinted.hasAttribute('data-active')).toBe(true)
    // The tint class is added on top of the row class (WorkspaceTint is the one mapping).
    expect(tinted.className.split(' ').length).toBeGreaterThan(plain.className.split(' ').length)
  })

  it('CompactItem and QuietItem are explicit variants of the same row', () => {
    const r = render(
      <>
        <Popover.CompactItem testId="c">c</Popover.CompactItem>
        <Popover.QuietItem testId="q">q</Popover.QuietItem>
      </>
    )
    const c = q(r, '[data-testid="c"]')
    const qi = q(r, '[data-testid="q"]')
    expect(c.hasAttribute('data-popover-item')).toBe(true)
    expect(c.getAttribute('data-density')).toBe('compact')
    expect(qi.hasAttribute('data-popover-item')).toBe(true)
    expect(qi.hasAttribute('data-quiet')).toBe(true)
  })

  it('Divider is a separator; Note is a paragraph with its test id', () => {
    const r = render(
      <>
        <Popover.Divider />
        <Popover.Note testId="n">Nothing yet</Popover.Note>
      </>
    )
    expect(q(r, '[data-popover-divider]').getAttribute('role')).toBe('separator')
    expect(q(r, '[data-testid="n"]').tagName).toBe('P')
  })

  it('ItemIcon is hidden from assistive tech', () => {
    const r = render(
      <Popover.Item testId="i">
        <Popover.ItemIcon>⚙</Popover.ItemIcon>
        Settings…
      </Popover.Item>
    )
    expect(q(r, '[data-testid="i"] [aria-hidden="true"]').textContent).toBe('⚙')
  })
})

describe('Popover.module.css', () => {
  const css = readFileSync(join(__dirname, 'Popover.module.css'), 'utf8')
  const body = (sel: string): string => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|\\n)${esc} \\{([^}]*)\\}`).exec(css)?.[2] ?? ''
  }

  it('the surface never scrolls (a submenu inside it would be clipped); the list does', () => {
    expect(body('.surface')).not.toMatch(/overflow/)
    expect(body('.list')).toMatch(/max-height: var\(--popover-max-height, none\);/)
    expect(body('.list')).toMatch(/overflow-y: auto;/)
  })

  it('rows are rounded-md with a transparent border, and the focus ring sits inside the row', () => {
    expect(body('.item')).toMatch(/border-radius: var\(--rounded-md\);/)
    expect(body('.item')).toMatch(/border: 1px solid transparent;/)
    expect(body('.item:focus-visible')).toMatch(
      /outline-offset: calc\(-1 \* var\(--focus-ring-width\)\);/
    )
  })

  it('styles every row state from ARIA, in one rule', () => {
    for (const s of [
      "[aria-selected='true']",
      "[aria-checked='true']",
      "[aria-expanded='true']",
      '[data-active]'
    ]) {
      expect(css).toContain(`.item${s}`)
    }
  })

  it('a tinted row keeps its tint fill on hover and moves only the border', () => {
    expect(body('.item[data-tone]')).toMatch(/background: var\(--ws-fill\);/)
    expect(body('.item[data-tone]')).toMatch(/border-color: var\(--ws-border\);/)
    expect(body('.item[data-tone]:hover')).toMatch(/border-color: var\(--text-secondary\);/)
    expect(body('.item[data-tone]:hover')).toMatch(/background: var\(--ws-fill\);/)
  })
})

describe('Popover.Surface — overlay motion (spec 2026-10-04 §4)', () => {
  it('is marked data-leaving + inert inside a leaving Presence, and not otherwise', () => {
    const clearInput = pointerInput()
    vi.useFakeTimers()
    const tree = (open: boolean): JSX.Element => (
      <Presence value={open || null}>
        {() => (
          <Popover.Surface testId="surf">
            <span>x</span>
          </Popover.Surface>
        )}
      </Presence>
    )
    const r = renderComponent(tree(true))
    const surf = (): Element | null => r.container.querySelector('[data-testid="surf"]')
    expect(surf()?.hasAttribute('data-leaving')).toBe(false)
    act(() => {
      r.root.render(tree(false))
    })
    expect(surf()?.hasAttribute('data-leaving')).toBe(true)
    expect(surf()?.hasAttribute('inert')).toBe(true)
    r.unmount()
    vi.useRealTimers()
    clearInput()
  })

  it('CSS: enters from opacity 0 + 4px up, leaves the same way, instant on keyboard and reduced motion', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/Popover/Popover.module.css'),
      'utf8'
    )
    expect(css).toMatch(
      /@starting-style\s*\{\s*\.surface\s*\{\s*opacity:\s*0;\s*translate:\s*0 -4px;/
    )
    expect(css).toMatch(/\.surface\[data-leaving\]\s*\{[^}]*opacity:\s*0;[^}]*translate:\s*0 -4px;/)
    expect(css).toMatch(/\.surface\[data-leaving\]\s*\{[^}]*var\(--motion-ease-exit\)/)
    expect(css).toMatch(/:root\[data-input='keyboard'\] \.surface\s*\{\s*transition:\s*none;/)
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\.surface\s*\{\s*transition:\s*none;/
    )
    // Never `transform`: callers' wrappers centre with it (ExpanderBox, the dead-pane menu).
    expect(css).not.toMatch(/\.surface[^{]*\{[^}]*transform:/)
  })
})
