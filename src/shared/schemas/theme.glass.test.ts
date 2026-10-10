import { describe, expect, it } from 'vitest'
import { GLASS_SURFACES, GlassSpecSchema, ThemeManifestSchema } from './theme'

// Local copy on purpose: the test mutates it (structuredClone). src/__fixtures__/glassSpec.ts
// holds the same values for the other tests.
const material = {
  refract: 14,
  edge: 16,
  blur: 12,
  chroma: 0.25,
  tint: '#0e0e10',
  tintAmount: 0.3,
  rim: 0.35,
  exposure: 1.6,
  lift: 0.05,
  glow: 0.08,
  lightFollowsCursor: true
}
const spec = {
  renderer: 'webgl',
  surfaces: {
    // A copy each: structuredClone keeps shared references, so one shared object would make a
    // mutation of `card` show up first under `header`.
    header: { ...material, lightFollowsCursor: false },
    column: { ...material, tintNeedsYou: '#2a2414' },
    card: { ...material },
    control: { ...material },
    field: { ...material }
  }
}

describe('glass spec', () => {
  it('parses the canvas values', () => {
    expect(GlassSpecSchema.parse(spec)).toEqual(spec)
  })

  // Owner, 2026-10-08: the moving light is fine on columns, cards and controls but not on the
  // header — so it is a per-surface choice, not one switch for the whole theme.
  it('takes lightFollowsCursor per surface, required, and no longer at the top', () => {
    const missing: Record<string, unknown> = { ...material }
    Reflect.deleteProperty(missing, 'lightFollowsCursor')
    const r = GlassSpecSchema.safeParse({ ...spec, surfaces: { ...spec.surfaces, card: missing } })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.path).toEqual(['surfaces', 'card', 'lightFollowsCursor'])
    expect(GlassSpecSchema.safeParse({ ...spec, lightFollowsCursor: true }).success).toBe(false)
  })

  it('lists exactly five surfaces', () => {
    expect([...GLASS_SURFACES]).toEqual(['header', 'column', 'card', 'control', 'field'])
  })

  it.each([
    ['refract', 41],
    ['edge', 0],
    ['blur', 41],
    ['chroma', 1.1],
    ['tintAmount', -0.1],
    ['rim', 2],
    ['exposure', 0.9],
    ['exposure', 3.1],
    ['lift', 0.31],
    ['glow', 0.31]
  ])('fails closed on card.%s = %s with its path', (field, value) => {
    const bad = structuredClone(spec)
    ;(bad.surfaces.card as Record<string, unknown>)[field] = value
    const r = GlassSpecSchema.safeParse(bad)
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.path).toEqual(['surfaces', 'card', field])
  })

  it.each(['#fff', 'red', '#12345g', 'url(x)'])('rejects the colour %s', (tint) => {
    const bad = structuredClone(spec)
    bad.surfaces.header.tint = tint
    expect(GlassSpecSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an unknown key at every level', () => {
    expect(GlassSpecSchema.safeParse({ ...spec, extra: 1 }).success).toBe(false)
    expect(
      GlassSpecSchema.safeParse({ ...spec, surfaces: { ...spec.surfaces, popover: material } })
        .success
    ).toBe(false)
    expect(
      GlassSpecSchema.safeParse({
        ...spec,
        surfaces: { ...spec.surfaces, card: { ...material, x: 1 } }
      }).success
    ).toBe(false)
  })

  it('rejects a missing field (no schema defaults)', () => {
    const noGlow: Record<string, unknown> = { ...material }
    Reflect.deleteProperty(noGlow, 'glow')
    expect(
      GlassSpecSchema.safeParse({ ...spec, surfaces: { ...spec.surfaces, field: noGlow } }).success
    ).toBe(false)
  })

  it('allows tintNeedsYou on column only', () => {
    const bad = structuredClone(spec)
    ;(bad.surfaces.card as Record<string, unknown>).tintNeedsYou = '#2a2414'
    expect(GlassSpecSchema.safeParse(bad).success).toBe(false)
  })

  it('is optional on the manifest', () => {
    const base = { version: 1, name: 'X' }
    expect(ThemeManifestSchema.parse(base).glass).toBeUndefined()
    expect(ThemeManifestSchema.parse({ ...base, glass: spec }).glass).toEqual(spec)
  })
})
