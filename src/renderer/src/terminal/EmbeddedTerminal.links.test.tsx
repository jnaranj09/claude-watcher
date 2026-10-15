// Terminal links — a link in terminal output opens in the OS default browser on Ctrl+click
// (Cmd+click on macOS), through the `window.links` bridge. Two kinds of link, one activator:
//   - OSC 8 hyperlinks (claude prints these) → xterm's `linkHandler` option. Without it xterm
//     falls back to a browser `confirm()` and an empty `window.open()` that never carries the URL.
//   - plain-text URLs → @xterm/addon-web-links.
// The Terminal stays REAL (wrapped only to capture the instance), so `options.linkHandler` is the
// genuine xterm option; the web-links addon is faked to capture the handler it was given.
import type { Terminal as XtermTerminal } from '@xterm/xterm'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderTracked, unmountRendered } from '../test/renderComponent'
import { capturedTerminals, stubTerminalBridge } from '../test/terminalHarness'
import { EmbeddedTerminal } from './EmbeddedTerminal'

vi.mock('@xterm/xterm', async () => (await import('../test/terminalHarness')).xtermMock())

type LinkActivate = (event: MouseEvent, uri: string) => void
interface WebLinksOptions {
  hover?: (event: MouseEvent, text: string) => void
  leave?: (event: MouseEvent, text: string) => void
}
const webLinksHandlers: (LinkActivate | undefined)[] = []
const webLinksOptions: (WebLinksOptions | undefined)[] = []

vi.mock('@xterm/addon-web-links', () => {
  class FakeWebLinksAddon {
    constructor(handler?: LinkActivate, options?: WebLinksOptions) {
      webLinksHandlers.push(handler)
      webLinksOptions.push(options)
    }
    activate(): void {
      /* no-op: the real addon registers a link provider */
    }
    dispose(): void {
      /* no-op */
    }
  }
  return { WebLinksAddon: FakeWebLinksAddon }
})

let openExternal: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>

beforeEach(() => {
  stubTerminalBridge()
  webLinksHandlers.length = 0
  webLinksOptions.length = 0
  openExternal = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve())
  ;(window as unknown as { links: unknown }).links = { openExternal }
})

afterEach(() => {
  unmountRendered()
  vi.restoreAllMocks()
})

function mount(): { term: XtermTerminal; webLinks: LinkActivate } {
  renderTracked(<EmbeddedTerminal terminalId="t-1" />)
  const term = capturedTerminals[0]
  const webLinks = webLinksHandlers[0]
  if (term === undefined) throw new Error('no Terminal constructed')
  if (webLinks === undefined) throw new Error('no WebLinksAddon handler')
  return { term, webLinks }
}

const click = (init: MouseEventInit = {}): MouseEvent => new MouseEvent('click', init)

describe('EmbeddedTerminal — links open in the OS browser', () => {
  it('an OSC 8 link opens on Ctrl+click, through the links bridge', () => {
    const { term } = mount()
    const activate = term.options.linkHandler?.activate
    expect(activate).toBeDefined()
    activate?.(click({ ctrlKey: true }), 'https://github.com/org/repo/pull/7', {
      start: { x: 1, y: 1 },
      end: { x: 2, y: 1 }
    })
    expect(openExternal).toHaveBeenCalledWith('https://github.com/org/repo/pull/7')
  })

  it('a plain click on an OSC 8 link opens nothing (it is left to text selection)', () => {
    const { term } = mount()
    term.options.linkHandler?.activate(click(), 'https://example.com/', {
      start: { x: 1, y: 1 },
      end: { x: 2, y: 1 }
    })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('a plain-text URL opens on Ctrl+click through the web-links addon', () => {
    const { webLinks } = mount()
    webLinks(click({ ctrlKey: true }), 'https://example.com/docs')
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
    webLinks(click(), 'https://example.com/other')
    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  it('never uses a browser confirm() or window.open()', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const { term, webLinks } = mount()
    const range = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } }
    term.options.linkHandler?.activate(click({ ctrlKey: true }), 'https://a.example/', range)
    webLinks(click({ ctrlKey: true }), 'https://b.example/')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })
})

// The claude double-open: a Ctrl+click on a link must reach the app ONLY. claude turns on mouse
// reporting, so a click that reaches xterm is also reported to claude, which opened the link a
// second time. The frame takes the click in the CAPTURE phase, before xterm's own element.
describe('EmbeddedTerminal — a Ctrl+click on a link never reaches xterm (or claude)', () => {
  const range = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } }
  const press = (target: Element, init: MouseEventInit): MouseEvent => {
    const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init })
    target.dispatchEvent(e)
    return e
  }
  function xtermElement(term: XtermTerminal): HTMLElement {
    const el = term.element
    if (el === undefined) throw new Error('terminal not opened')
    return el
  }

  it('over an OSC 8 link: opens once and xterm never sees the mousedown', () => {
    const { term } = mount()
    const el = xtermElement(term)
    const seenByXterm = vi.fn()
    el.addEventListener('mousedown', seenByXterm)
    term.options.linkHandler?.hover?.(new MouseEvent('mousemove'), 'https://a.example/', range)
    press(el, { ctrlKey: true })
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith('https://a.example/')
    expect(seenByXterm).not.toHaveBeenCalled()
  })

  it('over a plain-text URL (web-links addon): opens once and xterm never sees it', () => {
    const { term } = mount()
    const el = xtermElement(term)
    const seenByXterm = vi.fn()
    el.addEventListener('mousedown', seenByXterm)
    webLinksOptions[0]?.hover?.(new MouseEvent('mousemove'), 'https://b.example/')
    press(el, { ctrlKey: true })
    expect(openExternal).toHaveBeenCalledWith('https://b.example/')
    expect(seenByXterm).not.toHaveBeenCalled()
  })

  it('after the mouse leaves the link, a Ctrl+click reaches xterm as usual', () => {
    const { term } = mount()
    const el = xtermElement(term)
    const seenByXterm = vi.fn()
    el.addEventListener('mousedown', seenByXterm)
    const hoverEvent = new MouseEvent('mousemove')
    term.options.linkHandler?.hover?.(hoverEvent, 'https://a.example/', range)
    term.options.linkHandler?.leave?.(hoverEvent, 'https://a.example/', range)
    press(el, { ctrlKey: true })
    expect(openExternal).not.toHaveBeenCalled()
    expect(seenByXterm).toHaveBeenCalledTimes(1)
  })
})
