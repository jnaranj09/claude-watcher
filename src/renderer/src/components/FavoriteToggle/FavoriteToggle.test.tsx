// Favorites — the ONE pin toggle. jsdom `unit` project, `renderComponent` harness.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { FavoriteToggle, type FavoriteToggleProps } from './FavoriteToggle'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

const BASE: FavoriteToggleProps = {
  name: 'deploy',
  favorite: false,
  busy: false,
  onToggle: () => {},
  testId: 'fav'
}

function render(props: Partial<FavoriteToggleProps> = {}): {
  r: RenderResult
  b: HTMLButtonElement
} {
  const r = renderComponent(<FavoriteToggle {...BASE} {...props} />)
  cleanup = r.unmount
  const b = r.container.querySelector<HTMLButtonElement>('[data-testid="fav"]')
  if (b === null) throw new Error('missing pin')
  return { r, b }
}

describe('FavoriteToggle', () => {
  it('names the row and reports its state', () => {
    const { b } = render()
    expect(b.getAttribute('aria-label')).toBe('Pin deploy')
    expect(b.getAttribute('title')).toBe('Pin')
    expect(b.getAttribute('aria-pressed')).toBe('false')
    expect(b.getAttribute('data-favorite')).toBe('off')
    expect(b.hasAttribute('data-lit')).toBe(false)
    expect(b.querySelector('svg path')?.getAttribute('fill')).toBe('none')
  })
  it('on: pressed, filled, still not lit', () => {
    const { b } = render({ favorite: true })
    expect(b.getAttribute('aria-pressed')).toBe('true')
    expect(b.getAttribute('data-favorite')).toBe('on')
    // The tooltip says what a click does; the accessible name stays `Pin <name>` + aria-pressed.
    expect(b.getAttribute('title')).toBe('Unpin')
    expect(b.getAttribute('aria-label')).toBe('Pin deploy')
    expect(b.hasAttribute('data-lit')).toBe(false)
    expect(b.querySelector('svg path')?.getAttribute('fill')).toBe('currentColor')
  })
  // Owner, 2026-10-13: the tilted flat pin (option D), the shape apps use for "pinned".
  it('draws the tilted pin', () => {
    const { b } = render()
    expect(b.querySelector('svg g')?.getAttribute('transform')).toBe('rotate(45 12 12)')
  })
  it('click calls onToggle once', () => {
    const onToggle = vi.fn()
    const { b } = render({ onToggle })
    act(() => b.click())
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
  it('busy disables it', () => {
    const { b } = render({ busy: true })
    expect(b.disabled).toBe(true)
  })
})

// Chromium drops focus from a node React MOVES (a row whose pin changed sorts elsewhere), and
// jsdom does not, so the test blurs by hand where the move happens. Without the restore, Escape
// and the arrow keys stop reaching the popover after a pin click.
function move(el: HTMLElement): void {
  const parent = el.parentNode
  if (parent === null) throw new Error('detached')
  act(() => {
    parent.removeChild(el)
    parent.appendChild(el)
  })
}

describe('FavoriteToggle — focus survives the row moving', () => {
  it('a pin pressed with focus gets it back when main answers', () => {
    const { r, b } = render({ favorite: true })
    act(() => b.focus())
    expect(document.activeElement).toBe(b)
    act(() => b.click())
    act(() => r.root.render(<FavoriteToggle {...BASE} favorite busy />))
    move(b) // the row moves: Chromium leaves focus on <body>
    expect(document.activeElement).not.toBe(b)
    act(() => r.root.render(<FavoriteToggle {...BASE} favorite={false} busy={false} />))
    expect(document.activeElement).toBe(b)
  })
  it('a pin that did not hold focus never takes it', () => {
    const { r, b } = render({ favorite: true })
    act(() => b.click())
    move(b)
    act(() => r.root.render(<FavoriteToggle {...BASE} favorite={false} busy={false} />))
    expect(document.activeElement).not.toBe(b)
  })
})

describe('FavoriteToggle — never steals focus', () => {
  it('focus the operator moved elsewhere during the save stays there', () => {
    const other = document.createElement('input')
    document.body.appendChild(other)
    const { r, b } = render({ favorite: true })
    act(() => b.focus())
    act(() => b.click())
    act(() => r.root.render(<FavoriteToggle {...BASE} favorite busy />))
    act(() => other.focus()) // the operator clicks the Name field before main answers
    act(() => r.root.render(<FavoriteToggle {...BASE} favorite={false} busy={false} />))
    expect(document.activeElement).toBe(other)
    other.remove()
  })
})
