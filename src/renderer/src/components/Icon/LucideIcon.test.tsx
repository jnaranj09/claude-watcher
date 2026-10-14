// The shared lucide icons: one 14px stroke box, aria-hidden, the paths copied from lucide.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { LucideIcon, type LucideIconName } from './LucideIcon'

let r: RenderResult | undefined
afterEach(() => {
  r?.unmount()
  r = undefined
})

function draw(name: LucideIconName): SVGSVGElement {
  r?.unmount()
  r = renderComponent(<LucideIcon name={name} />)
  const svg = r.container.querySelector('svg')
  if (svg === null) throw new Error('no svg')
  return svg
}

describe('LucideIcon', () => {
  it('draws a 14px currentColor stroke box hidden from readers', () => {
    const svg = draw('layers')
    expect(svg.getAttribute('width')).toBe('14')
    expect(svg.getAttribute('height')).toBe('14')
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('fill')).toBe('none')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('stroke-width')).toBe('2.25')
    expect(svg.getAttribute('stroke-linecap')).toBe('round')
    expect(svg.getAttribute('stroke-linejoin')).toBe('round')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
  })

  it.each([
    ['layers', 3, 'M12.83 2.18'],
    ['rotate-ccw', 2, 'M3 12a9 9'],
    ['arrow-up-right', 2, 'M7 7h10v10']
  ] as const)('%s draws its lucide paths', (name, count, firstPath) => {
    const paths = [...draw(name).querySelectorAll('path')]
    expect(paths).toHaveLength(count)
    expect(paths[0]?.getAttribute('d')?.startsWith(firstPath)).toBe(true)
  })
})
