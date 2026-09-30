// WebGL context-loss recovery (terminal.md — "WebGL is the ACTIVE renderer; canvas/dom is
// fallback only ... on context loss dispose the addon and flip to canvas").
//
// WHY this file exists (a real incident, 2026-07-31): the amdgpu driver hit a page fault and
// reset `ring gfx_0.0.0`, which killed the app's GPU process. Every live xterm lost its WebGL
// context. The addon WAS disposed and the DOM renderer took over — but the DOM renderer only
// paints DIRTY cells, so every row already on screen stayed black. Two healthy claude sessions
// looked dead: the PTYs were alive, the buffers were intact, keystrokes still reached claude,
// and only a window resize (which forces a full refresh) brought the text back.
//
// The fix is the pair of calls asserted below. Remove either one and this test goes red.
//
// jsdom has no WebGL2, so a REAL WebglAddon always throws into the catch branch and the
// context-loss handler is unreachable. This file therefore mocks @xterm/addon-webgl with a
// fake that lets the test fire the loss callback by hand. The Terminal itself stays REAL
// (wrapped only to capture the instance) so `refresh`/`clearTextureAtlas` are the genuine
// xterm API — a rename upstream breaks this test rather than passing vacuously.
import type { Terminal as XtermTerminal } from '@xterm/xterm'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { EmbeddedTerminal } from './EmbeddedTerminal'

// Every Terminal EmbeddedTerminal constructs, in creation order. Reset per test.
const capturedTerminals: XtermTerminal[] = []

vi.mock('@xterm/xterm', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await vi.importActual<Record<string, any>>('@xterm/xterm')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OriginalTerminal: new (...args: any[]) => XtermTerminal = actual['Terminal']
  class TerminalCapture extends OriginalTerminal {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      capturedTerminals.push(this as unknown as XtermTerminal)
    }
  }
  return { ...actual, Terminal: TerminalCapture }
})

// The captured context-loss listeners + dispose spies, one entry per constructed addon.
const webglAddons: { fireContextLoss: () => void; dispose: ReturnType<typeof vi.fn> }[] = []

// Every FitAddon EmbeddedTerminal constructs, in creation order. The REAL FitAddon needs a live
// render service to measure a cell (jsdom has no layout), so it is faked here — the assertion is
// that the context-loss handler RE-FITS at all, not what dimensions it computes.
const fitAddons: { fit: ReturnType<typeof vi.fn> }[] = []

vi.mock('@xterm/addon-fit', () => {
  class FakeFitAddon {
    public fit = vi.fn()
    public dispose = vi.fn()
    constructor() {
      fitAddons.push({ fit: this.fit })
    }
    // xterm calls activate() from term.loadAddon() — a no-op is enough here.
    activate(): void {
      /* no-op: the real addon would measure a cell jsdom cannot lay out */
    }
    proposeDimensions(): undefined {
      return undefined
    }
  }
  return { FitAddon: FakeFitAddon }
})

vi.mock('@xterm/addon-webgl', () => {
  class FakeWebglAddon {
    private listener: (() => void) | null = null
    public dispose = vi.fn()
    constructor() {
      webglAddons.push({
        fireContextLoss: () => this.listener?.(),
        dispose: this.dispose
      })
    }
    // xterm calls activate() from term.loadAddon() — a no-op is enough here.
    activate(): void {
      /* no-op: the real addon would take a WebGL2 context jsdom cannot give */
    }
    onContextLoss(cb: () => void): { dispose: () => void } {
      this.listener = cb
      return { dispose: (): void => {} }
    }
  }
  return { WebglAddon: FakeWebglAddon }
})

let cleanup: (() => void) | undefined

beforeEach(() => {
  capturedTerminals.length = 0
  webglAddons.length = 0
  fitAddons.length = 0

  // xterm assumes a real browser: shim matchMedia + ResizeObserver (jsdom omits both).
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {
      /* no-op shim — jsdom has no layout */
    }
    unobserve(): void {
      /* no-op shim */
    }
    disconnect(): void {
      /* no-op shim */
    }
  }
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    // The component only needs an unsubscribe back; this file never drives an exit.
    onExit: vi.fn(() => () => {})
  }
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

function render(terminalId: string): RenderResult {
  const r = renderComponent(<EmbeddedTerminal terminalId={terminalId} />)
  cleanup = r.unmount
  return r
}

describe('EmbeddedTerminal — WebGL context loss (GPU-process crash recovery)', () => {
  it('disposes the addon AND forces a full redraw so the fallback repaints the whole screen', () => {
    render('t-1')

    const term = capturedTerminals[0]
    const addon = webglAddons[0]
    expect(term).toBeDefined()
    expect(addon).toBeDefined()
    if (!term || !addon) return

    const clearTextureAtlas = vi.spyOn(term, 'clearTextureAtlas')
    const refresh = vi.spyOn(term, 'refresh')

    addon.fireContextLoss()

    // 1. the dead addon is disposed → xterm falls back to canvas/dom (terminal.md)
    expect(addon.dispose).toHaveBeenCalledTimes(1)
    // 2. the glyph cache the dead context owned is dropped
    expect(clearTextureAtlas).toHaveBeenCalledTimes(1)
    // 3. EVERY row is repainted — not just the dirty ones. Without this the terminal
    //    stays black until an unrelated resize damages the screen.
    expect(refresh).toHaveBeenCalledWith(0, term.rows - 1)
  })

  it('recovers each terminal independently (every kept-alive terminal loses its own context)', () => {
    // Two terminals mounted together: a GPU crash hits BOTH, so BOTH must repaint.
    const first = renderComponent(<EmbeddedTerminal terminalId="t-1" />)
    const second = renderComponent(<EmbeddedTerminal terminalId="t-2" active={false} />)
    cleanup = () => {
      first.unmount()
      second.unmount()
    }

    expect(capturedTerminals.length).toBe(2)
    expect(webglAddons.length).toBe(2)

    const refreshSpies = capturedTerminals.map((t) => vi.spyOn(t, 'refresh'))
    webglAddons.forEach((a) => a.fireContextLoss())

    refreshSpies.forEach((spy, i) => {
      const term = capturedTerminals[i]
      expect(term).toBeDefined()
      if (!term) return
      expect(spy).toHaveBeenCalledWith(0, term.rows - 1)
    })
  })

  // Second incident, same trigger (2026-08-03): after a context loss the terminal recovered its
  // pixels but kept the cols it had measured under WebGL. The canvas/dom fallback measures its
  // OWN cell size, so cols × cellWidth no longer fit the frame. xterm parks its focused helper
  // textarea on the CURSOR CELL in px — so every keystroke pushed that focused element further
  // past the right edge, the browser scrolled the frame to reveal it, and the left columns went
  // off-screen with no way to scroll back. Re-fitting on loss keeps cols honest for the renderer
  // that is actually painting. (The frame is `overflow: clip` now too, so it is not even a scroll
  // container — but that is the guard; THIS is the cause.)
  it('re-fits after the fallback swap so cols match the new renderer (and resizes the PTY)', () => {
    const { container } = render('t-1')

    const term = capturedTerminals[0]
    const addon = webglAddons[0]
    const fit = fitAddons[0]
    expect(term).toBeDefined()
    expect(addon).toBeDefined()
    expect(fit).toBeDefined()
    if (!term || !addon || !fit) return

    // doFit() bails on a 0×0 box (fit() on 0×0 corrupts sizing — terminal.md), and jsdom has no
    // layout, so give the host a non-zero box for this test only.
    const host = container.querySelector(
      '[data-testid="embedded-terminal"] > [data-testid="terminal-main"] > div'
    )
    expect(host).not.toBeNull()
    if (!host) return
    Object.defineProperty(host, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 600, configurable: true })

    const resize = (window as unknown as { terminal: { resize: ReturnType<typeof vi.fn> } })
      .terminal.resize
    const refresh = vi.spyOn(term, 'refresh')

    // Nothing has fitted yet: the port never paired and the ResizeObserver is a no-op shim.
    expect(fit.fit).not.toHaveBeenCalled()

    addon.fireContextLoss()

    // 1. the geometry is recomputed for the renderer that is now painting
    expect(fit.fit).toHaveBeenCalledTimes(1)
    // 2. main resizes the PTY FIRST, then the terminal reflows (resize ordering — terminal.md)
    expect(resize).toHaveBeenCalledWith('t-1', term.cols, term.rows)
    // 3. the re-fit lands BEFORE the full repaint, so the repaint covers the corrected geometry
    const fitOrder = fit.fit.mock.invocationCallOrder[0]
    const refreshOrder = refresh.mock.invocationCallOrder[0]
    expect(fitOrder).toBeDefined()
    expect(refreshOrder).toBeDefined()
    expect(fitOrder).toBeLessThan(refreshOrder as number)
  })
})
