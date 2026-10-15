// Terminal colours (spec 2026-09-30): the `terminalScheme` setting re-themes every LIVE terminal
// — palette, contrast floor and the frame's ground — without recreating it (terminal.md / F3).
// The xterm / fit / webgl mocks are test/terminalHarness.ts's (as in the webgl test); the Terminal
// stays REAL (wrapped only to capture the instance), so `options` is xterm's own.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderTracked, unmountRendered, type RenderResult } from '../test/renderComponent'
import { capturedTerminals, stubTerminalBridge } from '../test/terminalHarness'
import { act } from 'react'
import { EmbeddedTerminal } from './EmbeddedTerminal'
import { settingsStore } from '../stores/settingsStore'
import { themeStore } from '../stores/themeStore'
import { DEFAULT_SETTINGS } from '../../../shared/schemas/settings'
import { DEFAULT_THEME_BUNDLE } from '../../../shared/schemas/theme'
import { xtermTheme, xtermLightTheme } from '../styles/xtermTheme'

// The real Terminal (wrapped to capture each instance), a fake FitAddon and a fake WebglAddon whose
// context-loss listener the test fires by hand (test/terminalHarness.ts).
vi.mock('@xterm/xterm', async () => (await import('../test/terminalHarness')).xtermMock())
vi.mock('@xterm/addon-fit', async () => (await import('../test/terminalHarness')).fitAddonMock())
vi.mock('@xterm/addon-webgl', async () =>
  (await import('../test/terminalHarness')).webglAddonMock()
)

beforeEach(() => {
  stubTerminalBridge()
})

afterEach(() => {
  unmountRendered()
  vi.restoreAllMocks()
})

function render(terminalId: string): RenderResult {
  return renderTracked(<EmbeddedTerminal terminalId={terminalId} />)
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
    render('t-1')
    renderTracked(<EmbeddedTerminal terminalId="t-2" active={false} />)
    act(() => settingsStore.getState().applyPatch({ terminalScheme: 'light' }))
    expect(capturedTerminals).toHaveLength(2)
    for (const term of capturedTerminals) expect(term.options.theme).toEqual(xtermLightTheme)
  })
})
