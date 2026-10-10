// The approved canvas glass (canvas-capture.md "The glass"). Test data only: lives here, outside
// the renderer's hex guard (styles/noHexLiterals.test.ts walks src/renderer/src).
import type { GlassSpec } from '../shared/schemas/theme'

// The light follows the pointer everywhere but the header (owner, 2026-10-08).
const material = (
  m: Omit<GlassSpec['surfaces']['card'], 'tint' | 'lightFollowsCursor'>,
  lightFollowsCursor = true
): GlassSpec['surfaces']['card'] => ({ ...m, tint: '#0e0e10', lightFollowsCursor })

export const GLASS_FIXTURE: GlassSpec = {
  renderer: 'webgl',
  surfaces: {
    header: material(
      {
        refract: 14,
        edge: 16,
        blur: 12,
        chroma: 0.25,
        tintAmount: 0.3,
        rim: 0.35,
        exposure: 1.6,
        lift: 0.05,
        glow: 0.08
      },
      false
    ),
    column: {
      ...material({
        refract: 18,
        edge: 24,
        blur: 16,
        chroma: 0.2,
        tintAmount: 0.25,
        rim: 0.3,
        exposure: 1.5,
        lift: 0.04,
        glow: 0.06
      }),
      tintNeedsYou: '#2a2414'
    },
    card: material({
      refract: 8,
      edge: 12,
      blur: 8,
      chroma: 0.15,
      tintAmount: 0.36,
      rim: 0.3,
      exposure: 1.4,
      lift: 0.04,
      glow: 0.05
    }),
    control: material({
      refract: 5,
      edge: 9,
      blur: 6,
      chroma: 0.2,
      tintAmount: 0.22,
      rim: 0.32,
      exposure: 1.6,
      lift: 0.06,
      glow: 0.06
    }),
    field: material({
      refract: 5,
      edge: 9,
      blur: 6,
      chroma: 0.2,
      tintAmount: 0.4,
      rim: 0.32,
      exposure: 1.6,
      lift: 0.06,
      glow: 0.06
    })
  }
}
