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
