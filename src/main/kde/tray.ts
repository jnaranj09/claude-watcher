// Story 2.3 — the tray + PAINTED-badge controller (MAIN process only).
//
// Mirrors the OS tray icon to the live needs-you+idle count: it PAINTS the count onto the
// tray `nativeImage` as a gold `rounded.full` chip with DARK numerals (AC-1/2). It does NOT
// use `app.setBadgeCount` — that is Unity-only on Linux and KDE's StatusNotifierItem exposes
// no Electron badge API, so the count is drawn onto the icon (FROZEN #1; AR-8; UX-DR12).
//
// BADGE + MENU ONLY (AC-4/5): the tray has a minimal context menu whose only item is a BASIC
// `Quit` (`app.quit()`). It wires NO `click`/`activate` handler that shows/focuses/restores the
// window — the app NEVER self-raises (FR-8 dropped, self-raise cut 2026-06-19). The
// don't-kill-live-sessions Quit-guard is Epic 4 (NOT here); the sound toggle is Story 2.4.
//
// DI seams (AC-7) — mirrors `createAttentionNotifier`:
//   - `trayFactory()` builds the `Tray` (default = real Electron `Tray` + base icon + menu);
//     returns `null` when `Tray` is unsupported (headless) → the controller is a working no-op.
//   - `iconPainter(count)` produces the badge image (default = the real nativeImage painter);
//     a fake painter lets the unit test assert the count per repaint with NO real display.
//   - `log` sinks failures as `code=` ONLY — never a session value (never-log-the-value).
//
// never-crash (AC-8 / PRECEDENCE #2): `Tray` construction + every paint/setImage is wrapped in
// try/catch; a failure logs a code ONLY and degrades to a no-op. A tray/paint failure must
// never take the board/feed down.
//
// The Electron-touching default factories below are NOT on the unit-test path — the tests
// inject fakes (the default bodies reference real Electron classes, which are undefined under
// the bare-node `main-unit` runtime, but the import does not throw and the bodies never run
// there). The packaged smoke proves the real classes load.
// [Source: story 2.3 Tasks 2/3; AC-1/2/4/5/7/8; FROZEN #1/#3/#4/#7; DESIGN.md tray-badge token
//  146-149; src/main/kde/notifications.ts (DI-seam + never-crash precedent)]
import { app, Tray, Menu, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import { join } from 'path'

// --- DESIGN.md `tray-badge` token (146-149) — DO NOT invent a new color (AC-2). ---------
/** The gold chip background — `needs-you` gold. Gold is light, so the numerals are DARK. */
const BADGE_BG_GOLD = '#ffcf29'
/** The numeral foreground — `bg-base` dark. White would fail contrast on gold (UX-DR12). */
const BADGE_FG_DARK = '#1a1a18'

/** Base tray icon dimensions (KDE StatusNotifierItem reads ~22–24px). The chip is painted on
 *  at runtime; `setCount(0)` shows this base icon with NO chip. */
const TRAY_ICON_SIZE = 24

/**
 * The minimal surface the controller needs off an Electron `Tray`. Kept tiny so the test fake
 * implements exactly this — and so NO Electron import sits on the unit-test path.
 */
export interface TrayLike {
  /** Repaint the tray icon (AC-1). The controller hands it the painted nativeImage (or the
   *  plain base icon at count 0). The fake records the image it received. */
  setImage(image: NativeImage): void
  /** Optional tooltip update (count as text) — purely informational, never a window-raise. */
  setToolTip(tip: string): void
  /** Tear down the tray (on window close — no leaked Tray). */
  destroy(): void
}

/** The injectable Tray factory seam (AC-7). Returns `null` when `Tray` is unsupported on this
 *  platform/headless box → the controller becomes a working no-op (never an error). */
export type TrayFactory = () => TrayLike | null

/** The injectable paint seam (AC-7). Given the count, returns the badge image to set on the
 *  tray — or `null` if it could not paint (treated as a degraded no-op for that repaint). At
 *  count 0 it returns the plain base icon (no chip, AC-2). */
export type IconPainter = (count: number) => NativeImage | null

export interface TrayControllerOptions {
  /** The Tray factory (DI seam). Defaults to the real Electron `Tray` + base icon + Quit menu. */
  trayFactory?: TrayFactory
  /** The icon painter (DI seam). Defaults to the real nativeImage painter below. */
  iconPainter?: IconPainter
  /** Log sink — a `code=` ONLY, NEVER a session value (Guardrail #6). Defaults to console.warn.
   *  (The COUNT, an integer, is safe; a session value is not — but we never log either here.) */
  log?: (message: string) => void
}

export interface TrayController {
  /** Set the badge count. Repaints ONLY when the count CHANGED (idempotent no-op otherwise, so
   *  a stream of board deltas that don't move the count doesn't thrash the icon). `setCount(0)`
   *  clears to the plain base icon. NEVER throws (never-crash, AC-8). */
  setCount(count: number): void
  /** Tear down the tray (on window close). Idempotent. NEVER throws. */
  destroy(): void
}

// --- Hand-rolled raster compositor (see the IMPLEMENTATION NOTE below) -------------------
// `#rrggbb` → [r,g,b] bytes. The two token colors are parsed ONCE at module load.
function hexToRgb(hex: string): readonly [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}
const GOLD_RGB = hexToRgb(BADGE_BG_GOLD)
const DARK_RGB = hexToRgb(BADGE_FG_DARK)

// A compact 3×5 bitmap font for the digits 0-9 plus '+', each a 5-row string of 3 cols
// ('1' = pixel on). Enough to render 1- and 2-digit counts (and '99+') legibly in a 24px chip.
// Hand-built so the painter needs NO font engine / canvas in the main process.
const GLYPHS_3x5: Readonly<Record<string, readonly string[]>> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000']
}
const GLYPH_W = 3
const GLYPH_H = 5

/**
 * Paint the count as a gold `full`-radius chip (a filled gold disc) with dark numerals, using
 * the DESIGN.md `tray-badge` token verbatim (gold `#ffcf29` ground, dark `#1a1a18` numerals —
 * UX-DR12: white fails contrast on gold). At count 0 it returns the plain base icon (no chip,
 * AC-2). This is the ONLY place a real `nativeImage` is constructed; it is NOT on the unit-test
 * path (the test injects a fake painter). Returns `null` on any failure (caller degrades).
 *
 * IMPLEMENTATION NOTE — why a hand-composited BGRA bitmap, not SVG/canvas:
 * the main process has no canvas, and THIS Electron build's `nativeImage.createFromDataURL`
 * does NOT rasterize an SVG data-URL (verified: it returns an empty image). So the chip is
 * composited pixel-by-pixel into a BGRA buffer and turned into a `nativeImage` via
 * `nativeImage.createFromBitmap` (verified to work headlessly). The disc is a simple
 * distance-fill; the digits come from the compact built-in bitmap font above (no font engine).
 */
export const electronIconPainter: IconPainter = (count) => {
  try {
    if (count <= 0) {
      // Plain base icon, no chip (AC-2: clears to zero → base icon). If the base art can't
      // load (all candidates empty → null), fall back to an empty image (same tolerance the
      // factory uses at construction) so the zero-paint SUCCEEDS — otherwise a missing icon
      // would make every zero-count delta (the empty-board steady state) re-walk the icon
      // load + re-log forever, never advancing lastCount. An empty image is a valid "no chip".
      return loadBaseTrayIcon() ?? nativeImage.createEmpty()
    }
    // Cap the rendered text so a runaway count never overflows the tiny chip.
    const label = count > 99 ? '99+' : String(count)
    const img = paintCountChip(label)
    return img !== null && !img.isEmpty() ? img : null
  } catch {
    return null
  }
}

/**
 * Composite a gold disc + dark `label` digits into a BGRA bitmap and wrap it in a `nativeImage`.
 * Scale is chosen per label length so 1-digit, 2-digit and `99+` all fit legibly. NOT on the
 * unit-test path. Returns `null` on failure.
 */
function paintCountChip(label: string): NativeImage | null {
  const S = TRAY_ICON_SIZE // 24
  const buf = Buffer.alloc(S * S * 4) // BGRA, zero-filled = transparent
  const cx = (S - 1) / 2
  const cy = (S - 1) / 2
  const r = S / 2
  const r2 = r * r
  // Fill the gold disc (the `full`-radius chip — roundness means "status").
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= r2) {
        const o = (y * S + x) * 4
        buf[o] = GOLD_RGB[2] // B
        buf[o + 1] = GOLD_RGB[1] // G
        buf[o + 2] = GOLD_RGB[0] // R
        buf[o + 3] = 0xff // A
      }
    }
  }
  // Pick a pixel scale for the glyphs so the label is as large as fits inside the 24px disc.
  // 1 char → scale 3 (text 9×15 px). 2- AND 3-char labels (the only 3-char value is `99+`) →
  // scale 2: 3 chars = 3·3·2 + 2·2 spacing = 22px wide, which fits inside 24px (verified legible
  // in the packaged Electron runtime). Both multi-char cases use the same scale by design.
  const scale = label.length <= 1 ? 3 : 2
  const spacing = 1 * scale
  const textW = label.length * GLYPH_W * scale + (label.length - 1) * spacing
  const textH = GLYPH_H * scale
  const startX = Math.round((S - textW) / 2)
  const startY = Math.round((S - textH) / 2)
  let penX = startX
  for (const ch of label) {
    // `label` only ever contains digits 0-9 or `+`, all of which are in GLYPHS_3x5, so this
    // guard is defensive (noUncheckedIndexedAccess types the lookup as possibly-undefined); an
    // unmapped char is simply skipped rather than crashing.
    const glyph = GLYPHS_3x5[ch]
    if (glyph) drawGlyph(buf, S, glyph, penX, startY, scale)
    penX += GLYPH_W * scale + spacing
  }
  const img = nativeImage.createFromBitmap(buf, { width: S, height: S })
  return img.isEmpty() ? null : img
}

/** Stamp one 3×5 glyph (dark numerals) into the BGRA buffer at (ox,oy), scaled by `scale`. */
function drawGlyph(
  buf: Buffer,
  stride: number,
  glyph: readonly string[],
  ox: number,
  oy: number,
  scale: number
): void {
  for (let gy = 0; gy < GLYPH_H; gy++) {
    const row = glyph[gy] ?? ''
    for (let gx = 0; gx < GLYPH_W; gx++) {
      if (row[gx] !== '1') continue
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const x = ox + gx * scale + sx
          const y = oy + gy * scale + sy
          if (x < 0 || y < 0 || x >= stride || y >= stride) continue
          const o = (y * stride + x) * 4
          buf[o] = DARK_RGB[2] // B
          buf[o + 1] = DARK_RGB[1] // G
          buf[o + 2] = DARK_RGB[0] // R
          buf[o + 3] = 0xff // A
        }
      }
    }
  }
}

/** Load the base (no-chip) tray icon from `resources/tray/`. Falls back to the app icon if the
 *  dedicated tray art is missing. Returns `null` on failure (degraded no-op). NOT on the
 *  unit-test path. */
function loadBaseTrayIcon(): NativeImage | null {
  try {
    // Packaged: resources are asarUnpack-ed under the app resources dir; in dev they resolve
    // from the source tree. `process.resourcesPath` is set in a packaged Electron build.
    const candidates = [
      join(process.resourcesPath ?? '', 'tray', 'tray.png'),
      join(__dirname, '../../resources/tray/tray.png'),
      join(process.resourcesPath ?? '', 'icon.png'),
      join(__dirname, '../../resources/icon.png')
    ]
    for (const p of candidates) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
    return null
  } catch {
    return null
  }
}

/**
 * The default Tray factory — the ONLY place Electron's `Tray`/`Menu` is constructed, gated on
 * `Tray` being available. It builds the tray with the base icon and a minimal context menu
 * whose sole item is a BASIC `Quit` → `app.quit()` (AC-5). It wires NO click/activate handler
 * (AC-4: no self-raise). Returns `null` if the `Tray` class is unavailable (headless) so the
 * controller degrades to a working no-op. NOT on the unit-test path.
 */
export const electronTrayFactory: TrayFactory = () => {
  // `Tray` is undefined under the bare-node test runtime; this default factory is never used
  // there (the test injects a fake). In a real main process it is the Electron class.
  if (typeof Tray !== 'function') return null
  const base = loadBaseTrayIcon()
  // An empty image still constructs a Tray (Electron tolerates it); pass what we have.
  const tray = new Tray(base ?? nativeImage.createEmpty())
  // Minimal menu: a single BASIC Quit (NO Quit-guard — Epic 4; NO sound toggle — Story 2.4).
  const menu = Menu.buildFromTemplate([
    {
      label: 'Quit',
      click: (): void => {
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  // NOTE (AC-4): we deliberately register NO `tray.on('click'/'double-click')` handler. The
  // tray is badge + menu only — it NEVER shows/focuses/restores the cockpit window.
  return tray
}

/**
 * Create the tray controller (AC-7). Builds the tray via the injectable factory, then repaints
 * the badge on each `setCount` whose value CHANGED (AC-1 live update; repaint-only-on-change).
 * Every Electron-touching step is wrapped in try/catch and degrades to a no-op on failure
 * (never-crash, AC-8). An unsupported tray (`trayFactory` → null) makes every method a working
 * no-op — the app still runs.
 */
export function createTrayController(options: TrayControllerOptions = {}): TrayController {
  const trayFactory = options.trayFactory ?? electronTrayFactory
  const iconPainter = options.iconPainter ?? electronIconPainter
  // never-log-the-value: a `code=` ONLY, never a session value (Guardrail #6).
  const log = options.log ?? ((message: string): void => console.warn(message))

  // Build the tray once. A throwing/null factory degrades to a no-op controller (AC-8).
  let tray: TrayLike | null = null
  try {
    tray = trayFactory()
  } catch {
    tray = null
    log('[c9watch][tray] code=tray_create_failed')
  }

  // Memoize the last painted count so repeated identical counts don't thrash the icon
  // (repaint-only-on-change). `null` = nothing painted yet, so the first setCount always paints.
  let lastCount: number | null = null

  function setCount(count: number): void {
    // never-crash: no tray (unsupported/failed) → working no-op.
    if (tray === null) return
    // Normalize to a non-negative integer; the count is always derived from a map size so this
    // is belt-and-suspenders.
    const next = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
    if (next === lastCount) return // repaint-only-on-change (idempotent no-op).
    try {
      const image = iconPainter(next)
      if (image === null) {
        // The painter degraded (could not produce an image) — log a code only, do NOT update
        // lastCount, so the next setCount with the same value retries. Never throw.
        log('[c9watch][tray] code=tray_paint_failed')
        return
      }
      tray.setImage(image)
      tray.setToolTip(next > 0 ? `${next} sessions need you` : 'Claude Watcher')
      lastCount = next
    } catch {
      // never-crash (AC-8): a setImage/paint failure must not take the feed/board down. Log a
      // code ONLY — never a session value. Leave lastCount unchanged so a later setCount retries.
      log('[c9watch][tray] code=tray_paint_failed')
    }
  }

  function destroy(): void {
    if (tray === null) return
    try {
      tray.destroy()
    } catch {
      log('[c9watch][tray] code=tray_destroy_failed')
    }
    tray = null
  }

  return { setCount, destroy }
}
