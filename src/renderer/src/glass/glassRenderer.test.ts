import { describe, expect, it, vi } from 'vitest'
import { createGlassRenderer, hexToUnitRgb, type GlassColors } from './glassRenderer'
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
// A counting stand-in for WebGL2 (jsdom has none): shaders and programs live until deleted, so a
// renderer cycle that leaves any behind shows up as a non-empty set (review 2026-10-08: a theme
// push re-creates the renderer on the SAME context, so leaks add up).
function fakeGl(failWhen: (src: string) => boolean): {
  gl: WebGL2RenderingContext
  shaders: Set<object>
  programs: Set<object>
} {
  const shaders = new Set<object>()
  const programs = new Set<object>()
  const source = new Map<object, string>()
  const impl: Record<string, (...a: unknown[]) => unknown> = {
    createShader: () => {
      const sh = {}
      shaders.add(sh)
      return sh
    },
    deleteShader: (sh) => void shaders.delete(sh as object),
    shaderSource: (sh, src) => void source.set(sh as object, String(src)),
    getShaderParameter: (sh) => !failWhen(source.get(sh as object) ?? ''),
    createProgram: () => {
      const p = {}
      programs.add(p)
      return p
    },
    deleteProgram: (p) => void programs.delete(p as object),
    getProgramParameter: (_p, what) => (what === 'ACTIVE_UNIFORMS' ? 0 : true),
    getAttribLocation: () => 0,
    isContextLost: () => false
  }
  const gl = new Proxy(
    {},
    {
      get: (_t, key) =>
        typeof key === 'string' && /^[A-Z_0-9]+$/.test(key)
          ? key
          : typeof key === 'string' && key in impl
            ? impl[key]
            : () => ({})
    }
  ) as unknown as WebGL2RenderingContext
  return { gl, shaders, programs }
}

const COLORS: GlassColors = {
  status: { working: [0, 0, 1], 'needs-you': [1, 1, 0], idle: [0.5, 0.5, 0.5] }
}

describe('createGlassRenderer — GL objects', () => {
  it('dispose frees every shader and program it made', () => {
    const f = fakeGl(() => false)
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getContext').mockReturnValue(f.gl)
    const r = createGlassRenderer(canvas, GLASS_FIXTURE, COLORS, vi.fn())
    expect(r).not.toBeNull()
    r?.dispose()
    expect(f.shaders.size).toBe(0)
    expect(f.programs.size).toBe(0)
  })

  it('a shader that fails after others compiled frees them all and logs glass_shader_failed', () => {
    const f = fakeGl((src) => src.includes('u_radius')) // the pre-blur shader fails
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getContext').mockReturnValue(f.gl)
    const log = vi.fn()
    expect(createGlassRenderer(canvas, GLASS_FIXTURE, COLORS, log)).toBeNull()
    expect(log).toHaveBeenCalledWith('glass_shader_failed')
    expect(f.shaders.size).toBe(0)
    expect(f.programs.size).toBe(0)
  })
})

describe('hexToUnitRgb', () => {
  it('reads #rrggbb as 0..1 channels', () =>
    expect(hexToUnitRgb('#2a2414')).toEqual([42 / 255, 36 / 255, 20 / 255]))
})
