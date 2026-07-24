// Story 2.3 — the tray controller tests (main-unit / node project).
//
// Inject a FAKE trayFactory + FAKE iconPainter (the DI seams, AC-7) so NO real `Tray`, NO real
// display, and NO Electron import are loaded on the test path. Asserts:
//   - AC-1: setCount paints the right count; repaints on change; setCount(0) clears to base.
//   - AC-1 repaint-only-on-change: the same count twice → painter called ONCE.
//   - AC-8 never-crash: a throwing painter / throwing tray.setImage does NOT throw out of
//     setCount; logs a `code=` ONLY (no session value). An unsupported tray (factory → null)
//     makes every method a working no-op.
//   - destroy() tears the tray down and is idempotent; never throws.
// [Source: story 2.3 Task 2.7; AC-1/2/7/8; .claude/rules/state.md; notifications.test.ts style]
import { describe, it, expect, vi } from 'vitest'
import { createTrayController, type TrayLike, type IconPainter, type TrayFactory } from './tray'
import type { NativeImage } from 'electron'

/** A sentinel "image" — the controller never inspects the image, it just forwards it. We tag it
 *  with the count it was painted for so the fake tray can record which count reached setImage.
 *  JUSTIFIES the `as unknown as NativeImage` casts throughout this file: the controller treats
 *  the painter's return value opaquely (only ever passes it to `setImage`), so NO NativeImage
 *  method is ever called on the sentinel — the cast is sound for the test path. */
interface FakeImage {
  __count: number
}

/** A capturing fake painter: records every count it was asked to paint, returns a sentinel
 *  image tagged with that count (cast to NativeImage — the controller treats it opaquely). */
function makeFakePainter(): {
  painter: IconPainter
  counts: number[]
  callCount: number
} {
  const counts: number[] = []
  const painter: IconPainter = (count) => {
    counts.push(count)
    return { __count: count } as unknown as NativeImage
  }
  return {
    painter,
    counts,
    get callCount(): number {
      return counts.length
    }
  }
}

/** A capturing fake tray: records the images set on it (so we can read the painted count via the
 *  sentinel), tooltip updates, and destroy calls. */
function makeFakeTray(): {
  tray: TrayLike
  imagesSet: FakeImage[]
  tooltips: string[]
  destroyed: number
} {
  const imagesSet: FakeImage[] = []
  const tooltips: string[] = []
  let destroyed = 0
  const tray: TrayLike = {
    setImage(image): void {
      imagesSet.push(image as unknown as FakeImage)
    },
    setToolTip(tip): void {
      tooltips.push(tip)
    },
    destroy(): void {
      destroyed++
    }
  }
  return {
    tray,
    imagesSet,
    tooltips,
    get destroyed(): number {
      return destroyed
    }
  }
}

describe('tray controller — paints the count, repaints only on change (AC-1)', () => {
  it('setCount paints the icon with the right count', () => {
    const painter = makeFakePainter()
    const fakeTray = makeFakeTray()
    const trayFactory: TrayFactory = () => fakeTray.tray
    const ctrl = createTrayController({ trayFactory, iconPainter: painter.painter })

    // The count is the NEEDS-YOU-only count (Jose 2026-06-19 / UX-DR3): 3 here = 3 genuine
    // needs-you sessions, so "3 sessions need you" is now literally accurate (idle excluded).
    ctrl.setCount(3)
    expect(painter.counts).toEqual([3])
    expect(fakeTray.imagesSet).toHaveLength(1)
    expect(fakeTray.imagesSet[0]?.__count).toBe(3)
    // The tooltip reflects the needs-you count (informational; never a window-raise).
    expect(fakeTray.tooltips[0]).toBe('3 sessions need you')
  })

  it('repaints when the count CHANGES', () => {
    const painter = makeFakePainter()
    const fakeTray = makeFakeTray()
    const ctrl = createTrayController({
      trayFactory: () => fakeTray.tray,
      iconPainter: painter.painter
    })
    ctrl.setCount(1)
    ctrl.setCount(2)
    ctrl.setCount(5)
    expect(painter.counts).toEqual([1, 2, 5])
    expect(fakeTray.imagesSet.map((i) => i.__count)).toEqual([1, 2, 5])
  })

  it('repaint-only-on-change: the SAME count twice → painter called ONCE (no thrash)', () => {
    const painter = makeFakePainter()
    const fakeTray = makeFakeTray()
    const ctrl = createTrayController({
      trayFactory: () => fakeTray.tray,
      iconPainter: painter.painter
    })
    ctrl.setCount(4)
    ctrl.setCount(4)
    ctrl.setCount(4)
    expect(painter.callCount).toBe(1)
    expect(fakeTray.imagesSet).toHaveLength(1)
  })

  it('setCount(0) clears to the base icon (paints with count 0)', () => {
    const painter = makeFakePainter()
    const fakeTray = makeFakeTray()
    const ctrl = createTrayController({
      trayFactory: () => fakeTray.tray,
      iconPainter: painter.painter
    })
    ctrl.setCount(2)
    ctrl.setCount(0)
    expect(painter.counts).toEqual([2, 0])
    expect(fakeTray.imagesSet[1]?.__count).toBe(0)
    // At zero the tooltip reverts to the plain app name (no "N sessions need you").
    expect(fakeTray.tooltips[1]).toBe('Claude Watcher')
  })

  it('a negative / NaN count is normalized to 0 (defensive)', () => {
    const painter = makeFakePainter()
    const fakeTray = makeFakeTray()
    const ctrl = createTrayController({
      trayFactory: () => fakeTray.tray,
      iconPainter: painter.painter
    })
    ctrl.setCount(-5)
    expect(painter.counts).toEqual([0])
    // A subsequent NaN is also normalized to 0 → unchanged → no extra paint.
    ctrl.setCount(Number.NaN)
    expect(painter.callCount).toBe(1)
  })
})

describe('tray controller — unsupported tray = working no-op (AC-8)', () => {
  it('a factory returning null makes setCount/destroy working no-ops (no throw)', () => {
    const painter = makeFakePainter()
    const ctrl = createTrayController({
      trayFactory: () => null,
      iconPainter: painter.painter
    })
    expect(() => ctrl.setCount(3)).not.toThrow()
    expect(() => ctrl.destroy()).not.toThrow()
    // Nothing was painted — there is no tray to paint onto.
    expect(painter.callCount).toBe(0)
  })

  it('a THROWING factory degrades to a no-op controller (logs code only, no throw)', () => {
    const log = vi.fn()
    const throwingFactory: TrayFactory = () => {
      throw new Error('Tray unavailable: no display')
    }
    const ctrl = createTrayController({ trayFactory: throwingFactory, log })
    expect(() => ctrl.setCount(2)).not.toThrow()
    // Logged a code on construction; no session value present (there is none on this path).
    expect(log).toHaveBeenCalled()
    const logged = String(log.mock.calls[0]?.[0] ?? '')
    expect(logged).toContain('code=tray_create_failed')
  })
})

describe('tray controller — never-crash on paint/setImage failure (AC-8)', () => {
  it('a painter that THROWS does NOT throw out of setCount; logs code ONLY', () => {
    const log = vi.fn()
    const fakeTray = makeFakeTray()
    const throwingPainter: IconPainter = () => {
      throw new Error('nativeImage paint exploded')
    }
    const ctrl = createTrayController({
      trayFactory: () => fakeTray.tray,
      iconPainter: throwingPainter,
      log
    })
    expect(() => ctrl.setCount(7)).not.toThrow()
    expect(fakeTray.imagesSet).toHaveLength(0) // nothing reached the tray
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0]?.[0])).toContain('code=tray_paint_failed')
  })

  it('a painter returning null degrades (no setImage, logs code, no throw, retries next time)', () => {
    const log = vi.fn()
    const fakeTray = makeFakeTray()
    let returnNull = true
    const painter: IconPainter = (count) =>
      returnNull ? null : ({ __count: count } as unknown as NativeImage)
    const ctrl = createTrayController({
      trayFactory: () => fakeTray.tray,
      iconPainter: painter,
      log
    })
    ctrl.setCount(3) // painter returns null → degraded, lastCount NOT advanced
    expect(fakeTray.imagesSet).toHaveLength(0)
    expect(String(log.mock.calls[0]?.[0])).toContain('code=tray_paint_failed')
    // The same count retries because lastCount wasn't advanced on the degraded paint.
    returnNull = false
    ctrl.setCount(3)
    expect(fakeTray.imagesSet).toHaveLength(1)
    expect(fakeTray.imagesSet[0]?.__count).toBe(3)
  })

  it('a tray.setImage that THROWS is caught (degrades, never crashes); logs code only', () => {
    const log = vi.fn()
    const throwingTray: TrayLike = {
      setImage(): void {
        throw new Error('setImage failed')
      },
      setToolTip(): void {
        // no-op
      },
      destroy(): void {
        // no-op
      }
    }
    const ctrl = createTrayController({
      trayFactory: () => throwingTray,
      iconPainter: (count) => ({ __count: count }) as unknown as NativeImage,
      log
    })
    expect(() => ctrl.setCount(1)).not.toThrow()
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0]?.[0])).toContain('code=tray_paint_failed')
  })

  it('NO session value is ever logged — only a code (never-log-the-value)', () => {
    const log = vi.fn()
    const fakeTray = makeFakeTray()
    const throwingPainter: IconPainter = () => {
      throw new Error('boom')
    }
    const ctrl = createTrayController({
      trayFactory: () => fakeTray.tray,
      iconPainter: throwingPainter,
      log
    })
    ctrl.setCount(9)
    const logged = String(log.mock.calls[0]?.[0] ?? '')
    // Only a code + the [c9watch][tray] tag — no session name/path/status/tool value.
    expect(logged).toMatch(/^\[c9watch]\[tray] code=\w+$/)
  })
})

describe('tray controller — destroy (AC: no leaked Tray)', () => {
  it('destroy() tears the tray down and is idempotent (never throws)', () => {
    const fakeTray = makeFakeTray()
    const ctrl = createTrayController({
      trayFactory: () => fakeTray.tray,
      iconPainter: (count) => ({ __count: count }) as unknown as NativeImage
    })
    ctrl.destroy()
    expect(fakeTray.destroyed).toBe(1)
    // Idempotent: a second destroy does nothing (no double-destroy on the real Tray).
    expect(() => ctrl.destroy()).not.toThrow()
    expect(fakeTray.destroyed).toBe(1)
  })

  it('setCount after destroy is a working no-op (no paint, no throw)', () => {
    const painter = makeFakePainter()
    const fakeTray = makeFakeTray()
    const ctrl = createTrayController({
      trayFactory: () => fakeTray.tray,
      iconPainter: painter.painter
    })
    ctrl.destroy()
    expect(() => ctrl.setCount(5)).not.toThrow()
    expect(painter.callCount).toBe(0)
  })
})
