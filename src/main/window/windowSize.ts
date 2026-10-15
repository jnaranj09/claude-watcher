// Main window size, remembered across launches (owner, 2026-10-15) in `settings.windowSize`.
//
// Size and maximized state only, never the position: the window manager places the window. The
// saved width/height are the NORMAL bounds, so un-maximizing a restored window goes back to the
// size the operator picked. A save waits until resizing has been quiet for SAVE_DELAY_MS, so a
// drag writes the settings file once, not on every pointer move. A minimized window is not saved
// (the title-bar close minimizes, and that is not a size choice).
//
// No electron import: `createWindow.ts` passes the BrowserWindow in as `TrackedWindow`, so the
// `main-unit` test drives it with a fake.
import { WINDOW_SIZE_MAX, WINDOW_SIZE_MIN, type WindowSize } from '../../shared/schemas/settings'

export const DEFAULT_WINDOW_WIDTH = 1000
export const DEFAULT_WINDOW_HEIGHT = 700
export const SAVE_DELAY_MS = 500

/** The parts of a BrowserWindow the tracker uses. */
export interface TrackedWindow {
  on(event: 'resize' | 'maximize' | 'unmaximize' | 'closed', listener: () => void): unknown
  isMinimized(): boolean
  isMaximized(): boolean
  isDestroyed(): boolean
  getNormalBounds(): { width: number; height: number }
}

/** The size a new window opens at: the saved one, else the built-in default. */
export function initialWindowSize(saved: WindowSize | null): { width: number; height: number } {
  return saved === null
    ? { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT }
    : { width: saved.width, height: saved.height }
}

function clampSide(n: number): number {
  return Math.min(WINDOW_SIZE_MAX, Math.max(WINDOW_SIZE_MIN, Math.round(n)))
}

/** Saves the window's size after every resize, maximize and unmaximize (debounced). `save`
 *  failures are the caller's: it logs a code. */
export function trackWindowSize(
  win: TrackedWindow,
  save: (size: WindowSize) => void,
  delayMs: number = SAVE_DELAY_MS
): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    timer = null
    if (win.isDestroyed() || win.isMinimized()) return
    const b = win.getNormalBounds()
    save({ width: clampSide(b.width), height: clampSide(b.height), maximized: win.isMaximized() })
  }
  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, delayMs)
  }
  win.on('resize', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('closed', () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  })
}
