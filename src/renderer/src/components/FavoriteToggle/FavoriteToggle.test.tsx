// Favorites — the ONE star toggle. jsdom `unit` project, `renderComponent` harness.
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
  if (b === null) throw new Error('missing star')
  return { r, b }
}

describe('FavoriteToggle', () => {
  it('names the row and reports its state', () => {
    const { b } = render()
    expect(b.getAttribute('aria-label')).toBe('Favorite deploy')
    expect(b.getAttribute('aria-pressed')).toBe('false')
    expect(b.getAttribute('data-favorite')).toBe('off')
    expect(b.hasAttribute('data-lit')).toBe(false)
    expect(b.querySelector('svg path')?.getAttribute('fill')).toBe('none')
  })
  it('on: pressed, filled, still not lit', () => {
    const { b } = render({ favorite: true })
    expect(b.getAttribute('aria-pressed')).toBe('true')
    expect(b.getAttribute('data-favorite')).toBe('on')
    expect(b.hasAttribute('data-lit')).toBe(false)
    expect(b.querySelector('svg path')?.getAttribute('fill')).toBe('currentColor')
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

// Chromium drops focus from a node React MOVES (a row whose star changed sorts elsewhere), and
// jsdom does not, so the test blurs by hand where the move happens. Without the restore, Escape
// and the arrow keys stop reaching the popover after a star click.
function move(el: HTMLElement): void {
  const parent = el.parentNode
  if (parent === null) throw new Error('detached')
  act(() => {
    parent.removeChild(el)
    parent.appendChild(el)
  })
}

describe('FavoriteToggle — focus survives the row moving', () => {
  it('a star pressed with focus gets it back when main answers', () => {
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
  it('a star that did not hold focus never takes it', () => {
    const { r, b } = render({ favorite: true })
    act(() => b.click())
    move(b)
    act(() => r.root.render(<FavoriteToggle {...BASE} favorite={false} busy={false} />))
    expect(document.activeElement).not.toBe(b)
  })
})
