// Terminal colours (spec 2026-09-30): the `terminalScheme` setting re-themes every LIVE terminal
// — palette, contrast floor and the frame's ground — without recreating it (terminal.md / F3).
// The xterm / fit / webgl mocks are the ones EmbeddedTerminal.webgl.test.tsx uses; the Terminal
// stays REAL (wrapped only to capture the instance), so `options` is xterm's own.
import type { Terminal as XtermTerminal } from '@xterm/xterm'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { act } from 'react'
import { EmbeddedTerminal } from './EmbeddedTerminal'
import { settingsStore } from '../stores/settingsStore'
import { themeStore } from '../stores/themeStore'
import { DEFAULT_SETTINGS } from '../../../shared/schemas/settings'
import { DEFAULT_THEME_BUNDLE } from '../../../shared/schemas/theme'
import { xtermTheme, xtermLightTheme } from '../styles/xtermTheme'

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

function frameOf(container: HTMLElement): HTMLElement {
  const frame = container.querySelector<HTMLElement>('[data-testid="embedded-terminal"]')
  if (frame === null) throw new Error('no frame')
  return frame
}

describe('EmbeddedTerminal — terminal colours', () => {
  afterEach(() => {
    act(() => {
      settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS })
      themeStore.getState().setBundle(DEFAULT_THEME_BUNDLE)
    })
  })

  it('a light theme under "theme" gets the contrast floor at creation; the frame keeps its token', () => {
    act(() => themeStore.getState().setBundle({ ...DEFAULT_THEME_BUNDLE, colorScheme: 'light' }))
    const { container } = render('t-1')
    const term = capturedTerminals[0]
    expect(term).toBeDefined()
    if (!term) return
    expect(term.options.minimumContrastRatio).toBe(7)
    expect(frameOf(container).style.getPropertyValue('--bg-terminal')).toBe('')
  })

  it('switching the scheme re-themes the SAME live terminal and paints the frame ground', () => {
    const { container } = render('t-1')
    const term = capturedTerminals[0]
    expect(term).toBeDefined()
    if (!term) return
    expect(term.options.minimumContrastRatio).toBe(1)

    act(() => settingsStore.getState().applyPatch({ terminalScheme: 'light' }))
    expect(capturedTerminals.length).toBe(1)
    expect(term.options.theme).toEqual(xtermLightTheme)
    expect(term.options.minimumContrastRatio).toBe(7)
    expect(term.options.fontWeight).toBe(500)
    expect(frameOf(container).style.getPropertyValue('--bg-terminal')).toBe(
      xtermLightTheme.background
    )

    act(() => settingsStore.getState().applyPatch({ terminalScheme: 'dark' }))
    expect(term.options.theme).toEqual(xtermTheme)
    expect(term.options.minimumContrastRatio).toBe(1)
    expect(term.options.fontWeight).toBe(400)
    expect(frameOf(container).style.getPropertyValue('--bg-terminal')).toBe(xtermTheme.background)

    act(() => settingsStore.getState().applyPatch({ terminalScheme: 'theme' }))
    expect(frameOf(container).style.getPropertyValue('--bg-terminal')).toBe('')
    expect(capturedTerminals.length).toBe(1)
  })

  // liquid-glass under "dark": an opaque xterm ground covered the frame's inset glow and showed a
  // darker square-cornered rectangle in the rounded frame (operator, 2026-10-01).
  // Checked after mount, i.e. after the live re-theme effect (it runs right after creation).
  it('a transparent terminal leaves the built-in ground to the frame', () => {
    const glass = {
      ...DEFAULT_THEME_BUNDLE,
      terminal: { background: 'rgba(0,0,0,0)', allowTransparency: true }
    }
    act(() => {
      themeStore.getState().setBundle(glass)
      settingsStore.getState().applyPatch({ terminalScheme: 'dark' })
    })
    const { container } = render('t-1')
    const term = capturedTerminals[0]
    expect(term).toBeDefined()
    if (!term) return
    expect(term.options.allowTransparency).toBe(true)
    expect(term.options.theme).toEqual({
      ...xtermTheme,
      background: `${String(xtermTheme.background)}00`
    })
    expect(frameOf(container).style.getPropertyValue('--bg-terminal')).toBe(xtermTheme.background)

    act(() => settingsStore.getState().applyPatch({ terminalScheme: 'light' }))
    expect(term.options.theme).toEqual({
      ...xtermLightTheme,
      background: `${String(xtermLightTheme.background)}00`
    })
  })

  // A terminal born under liquid-glass kept `allowTransparency` after a switch to paper: the WebGL
  // atlas still drew its glyphs on see-through tiles, so paper's Medium text came out thin. A
  // terminal born under paper was fine (operator, 2026-10-02). The option follows the theme live.
  it('allowTransparency follows the theme live, both ways', () => {
    const glass = {
      ...DEFAULT_THEME_BUNDLE,
      terminal: { background: 'rgba(0,0,0,0)', allowTransparency: true }
    }
    act(() => {
      themeStore.getState().setBundle(glass)
      settingsStore.getState().applyPatch({ terminalScheme: 'dark' })
    })
    render('t-1')
    const term = capturedTerminals[0]
    expect(term).toBeDefined()
    if (!term) return
    expect(term.options.allowTransparency).toBe(true)

    act(() => themeStore.getState().setBundle(DEFAULT_THEME_BUNDLE))
    expect(term.options.allowTransparency).toBe(false)
    expect(term.options.theme).toEqual(xtermTheme)

    act(() => themeStore.getState().setBundle(glass))
    expect(term.options.allowTransparency).toBe(true)
    expect(term.options.theme).toEqual({
      ...xtermTheme,
      background: `${String(xtermTheme.background)}00`
    })
    expect(capturedTerminals.length).toBe(1)
  })

  it('a hidden kept-alive terminal follows too', () => {
    const first = renderComponent(<EmbeddedTerminal terminalId="t-1" />)
    const second = renderComponent(<EmbeddedTerminal terminalId="t-2" active={false} />)
    cleanup = () => {
      first.unmount()
      second.unmount()
    }
    act(() => settingsStore.getState().applyPatch({ terminalScheme: 'light' }))
    expect(capturedTerminals).toHaveLength(2)
    for (const term of capturedTerminals) expect(term.options.theme).toEqual(xtermLightTheme)
  })
})
