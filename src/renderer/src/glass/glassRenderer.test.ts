import { describe, expect, it, vi } from 'vitest'
import { createGlassRenderer, hexToUnitRgb } from './glassRenderer'
import { GLASS_FIXTURE } from '../../../__fixtures__/glassSpec'

describe('createGlassRenderer', () => {
  it('returns null and logs glass_unavailable when there is no WebGL2', () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getContext').mockReturnValue(null)
    const log = vi.fn()
    expect(
      createGlassRenderer(
        canvas,
        GLASS_FIXTURE,
        { status: { working: [0, 0, 1], 'needs-you': [1, 1, 0], idle: [0.5, 0.5, 0.5] } },
        log
      )
    ).toBeNull()
    expect(log).toHaveBeenCalledWith('glass_unavailable')
  })
})
describe('hexToUnitRgb', () => {
  it('reads #rrggbb as 0..1 channels', () =>
    expect(hexToUnitRgb('#2a2414')).toEqual([42 / 255, 36 / 255, 20 / 255]))
})
