// Terminal links — which click opens a link, per OS. Pure; no xterm.
import { describe, it, expect, vi } from 'vitest'
import {
  createLinkActivator,
  createLinkClickGuard,
  isMacUserAgent,
  isOpenGesture
} from './terminalLinks'

const mods = (m: Partial<Pick<MouseEvent, 'ctrlKey' | 'metaKey'>>): MouseEvent =>
  new MouseEvent('click', m)

describe('isOpenGesture', () => {
  it('is Ctrl+click on Linux and Windows', () => {
    expect(isOpenGesture(mods({ ctrlKey: true }), false)).toBe(true)
    expect(isOpenGesture(mods({ metaKey: true }), false)).toBe(false)
    expect(isOpenGesture(mods({}), false)).toBe(false)
  })
  it('is Cmd+click on macOS (Ctrl+click there is the context-menu click)', () => {
    expect(isOpenGesture(mods({ metaKey: true }), true)).toBe(true)
    expect(isOpenGesture(mods({ ctrlKey: true }), true)).toBe(false)
  })
})

describe('isMacUserAgent', () => {
  it('reads macOS from the Chromium user agent', () => {
    expect(
      isMacUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    ).toBe(true)
    expect(isMacUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')).toBe(false)
    expect(isMacUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')).toBe(
      false
    )
  })
})

describe('createLinkActivator', () => {
  it('opens only on the gesture, and a rejected open is logged by code only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const open = vi.fn<(url: string) => Promise<void>>(() => Promise.reject(new Error('x')))
    const activate = createLinkActivator({ open, isMac: false })
    activate(mods({}), 'https://secret.example/')
    expect(open).not.toHaveBeenCalled()
    activate(mods({ ctrlKey: true }), 'https://secret.example/')
    expect(open).toHaveBeenCalledWith('https://secret.example/')
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[claude-watcher][links] code=link_open_failed')
    )
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secret')
  })
})

// The claude double-open (2026-09-25): claude turns on mouse reporting, so xterm ALSO forwards a
// Ctrl+click to claude — which opened the same link a second time (a process watch showed one
// xdg-open under electron, one under claude). The guard takes a gesture click on a link for the
// app ALONE: it opens the hovered link and stops the event before xterm can report it.
describe('createLinkClickGuard', () => {
  const press = (type: 'mousedown' | 'mouseup', init: MouseEventInit = {}): MouseEvent =>
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })

  function setup(isMac = false): {
    guard: ReturnType<typeof createLinkClickGuard>
    open: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>
  } {
    const open = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve())
    return { guard: createLinkClickGuard({ open, isMac }), open }
  }

  it('a Ctrl+click on a hovered link opens it once and stops both halves of the click', () => {
    const { guard, open } = setup()
    guard.hover('https://example.com/pr/1')
    const down = press('mousedown', { ctrlKey: true })
    const stopDown = vi.spyOn(down, 'stopPropagation')
    guard.onMouseDown(down)
    const up = press('mouseup', { ctrlKey: true })
    const stopUp = vi.spyOn(up, 'stopPropagation')
    guard.onMouseUp(up)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://example.com/pr/1')
    expect(stopDown).toHaveBeenCalled()
    expect(down.defaultPrevented).toBe(true)
    expect(stopUp).toHaveBeenCalled()
  })

  it('a plain click on a hovered link passes through untouched', () => {
    const { guard, open } = setup()
    guard.hover('https://example.com/')
    const down = press('mousedown')
    const stop = vi.spyOn(down, 'stopPropagation')
    guard.onMouseDown(down)
    guard.onMouseUp(press('mouseup'))
    expect(open).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    expect(down.defaultPrevented).toBe(false)
  })

  it('a Ctrl+click with no link under the mouse passes through (claude keeps its own clicks)', () => {
    const { guard, open } = setup()
    guard.hover('https://example.com/')
    guard.leave()
    const down = press('mousedown', { ctrlKey: true })
    const stop = vi.spyOn(down, 'stopPropagation')
    guard.onMouseDown(down)
    expect(open).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  it('only the mouseup that belongs to a taken mousedown is stopped', () => {
    const { guard } = setup()
    guard.hover('https://example.com/')
    const up = press('mouseup', { ctrlKey: true })
    const stop = vi.spyOn(up, 'stopPropagation')
    guard.onMouseUp(up)
    expect(stop).not.toHaveBeenCalled()
  })

  it('ignores a right or middle button', () => {
    const { guard, open } = setup()
    guard.hover('https://example.com/')
    guard.onMouseDown(press('mousedown', { ctrlKey: true, button: 2 }))
    guard.onMouseDown(press('mousedown', { ctrlKey: true, button: 1 }))
    expect(open).not.toHaveBeenCalled()
  })

  it('on macOS the gesture is Cmd, and Ctrl+click passes through', () => {
    const { guard, open } = setup(true)
    guard.hover('https://example.com/')
    guard.onMouseDown(press('mousedown', { ctrlKey: true }))
    expect(open).not.toHaveBeenCalled()
    guard.onMouseDown(press('mousedown', { metaKey: true }))
    expect(open).toHaveBeenCalledTimes(1)
  })
})
