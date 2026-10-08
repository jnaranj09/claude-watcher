import { describe, expect, it } from 'vitest'
import { DEFAULT_LIGHT_ANGLE, lightAngleFor, surfaceAt } from './lightAngle'

const rect = { left: 100, top: 100, width: 100, height: 100 } // centre (150,150)
describe('lightAngleFor', () => {
  it.each([
    [{ x: 300, y: 150 }, 0],
    [{ x: 150, y: 0 }, 90],
    [{ x: 0, y: 150 }, 180],
    [{ x: 150, y: 300 }, 270],
    [{ x: 50, y: 50 }, 135]
  ])('pointer %o → %s°', (p, deg) => expect(lightAngleFor(rect, p, false)).toBeCloseTo(deg))
  it('no pointer or reduced motion → the fixed top-left light', () => {
    expect(lightAngleFor(rect, null, false)).toBe(DEFAULT_LIGHT_ANGLE)
    expect(lightAngleFor(rect, { x: 300, y: 150 }, true)).toBe(DEFAULT_LIGHT_ANGLE)
  })
  it('pointer on the centre → default', () =>
    expect(lightAngleFor(rect, { x: 150, y: 150 }, false)).toBe(DEFAULT_LIGHT_ANGLE))
})
describe('surfaceAt', () => {
  it('prefers the top-most (last drawn) surface', () => {
    const items = [
      {
        kind: 'column',
        rect: { left: 0, top: 0, width: 300, height: 600 },
        radius: 24,
        level: 1,
        status: null,
        clip: null
      },
      {
        kind: 'card',
        rect: { left: 10, top: 10, width: 200, height: 80 },
        radius: 12,
        level: 2,
        status: null,
        clip: null
      }
    ] as const
    expect(surfaceAt(items, { x: 20, y: 20 })).toBe(1)
    expect(surfaceAt(items, { x: 20, y: 200 })).toBe(0)
    expect(surfaceAt(items, { x: 900, y: 900 })).toBeNull()
  })
})
