// External links — the ONE gate between a clicked link and the OS default browser.
// main-unit (node) project. Electron's `shell.openExternal` is injected, so nothing here
// launches a browser.
import { describe, it, expect, vi } from 'vitest'
import { createExternalLinks, installLinkGuards } from './externalLinks'

function setup(): {
  links: ReturnType<typeof createExternalLinks>
  openExternal: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>
  logs: string[]
} {
  const logs: string[] = []
  const openExternal = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve())
  const links = createExternalLinks({ openExternal, log: (m) => logs.push(m) })
  return { links, openExternal, logs }
}

describe('createExternalLinks().open', () => {
  it('hands an https URL to the OS opener', () => {
    const { links, openExternal } = setup()
    expect(links.open('https://example.com/a?b=1')).toBe(true)
    expect(openExternal).toHaveBeenCalledWith('https://example.com/a?b=1')
  })

  it('hands an http URL to the OS opener', () => {
    const { links, openExternal } = setup()
    expect(links.open('http://localhost:3000/')).toBe(true)
    expect(openExternal).toHaveBeenCalledWith('http://localhost:3000/')
  })

  it('refuses every scheme other than http and https', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'mailto:a@b.c',
      'vscode://file/x',
      'smb://host/share'
    ]) {
      const { links, openExternal, logs } = setup()
      expect(links.open(url)).toBe(false)
      expect(openExternal).not.toHaveBeenCalled()
      expect(logs).toEqual(['[claude-watcher][links] code=link_scheme_refused'])
    }
  })

  it('refuses an empty string as malformed', () => {
    const { links, openExternal, logs } = setup()
    expect(links.open('')).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
    expect(logs).toEqual(['[claude-watcher][links] code=link_invalid'])
  })

  it('refuses a file: URL, never calls the opener, and logs a code only', () => {
    const { links, openExternal, logs } = setup()
    expect(links.open('file:///home/me/.ssh/id_rsa')).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
    expect(logs).toEqual(['[claude-watcher][links] code=link_scheme_refused'])
  })

  it('refuses a malformed URL without throwing', () => {
    const { links, openExternal, logs } = setup()
    expect(links.open('::nope::')).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
    expect(logs).toEqual(['[claude-watcher][links] code=link_invalid'])
  })

  it('logs a code, never the URL, when the OS opener rejects', async () => {
    const logs: string[] = []
    const openExternal = vi.fn(() => Promise.reject(new Error('xdg-open https://secret.example')))
    const links = createExternalLinks({ openExternal, log: (m) => logs.push(m) })
    expect(links.open('https://secret.example/?token=abc')).toBe(true)
    await vi.waitFor(() => expect(logs).toEqual(['[claude-watcher][links] code=link_open_failed']))
  })

  it('never logs the URL', () => {
    const { links, logs } = setup()
    links.open('file:///secret-path?token=abc')
    links.open('::secret::')
    expect(logs.join('\n')).not.toContain('secret')
  })
})

// A fake webContents: the two hooks installLinkGuards registers, driven by hand.
function fakeWebContents(currentUrl: string): {
  wc: Parameters<typeof installLinkGuards>[0]
  windowOpen: (url: string) => { action: string }
  navigate: (url: string) => boolean
} {
  let openHandler: ((d: { url: string }) => { action: 'deny' }) | undefined
  let navListener: ((e: { url: string; preventDefault: () => void }) => void) | undefined
  const wc = {
    setWindowOpenHandler(h: (d: { url: string }) => { action: 'deny' }): void {
      openHandler = h
    },
    on(_event: 'will-navigate', l: (e: { url: string; preventDefault: () => void }) => void): void {
      navListener = l
    },
    getURL: (): string => currentUrl
  }
  return {
    wc,
    windowOpen: (url) => {
      if (openHandler === undefined) throw new Error('no window-open handler installed')
      return openHandler({ url })
    },
    navigate: (url) => {
      if (navListener === undefined) throw new Error('no will-navigate listener installed')
      let prevented = false
      navListener({ url, preventDefault: () => (prevented = true) })
      return prevented
    }
  }
}

describe('installLinkGuards', () => {
  it('window.open never makes an in-app window, and an https URL goes to the browser', () => {
    const { links, openExternal } = setup()
    const f = fakeWebContents('file:///app/out/renderer/index.html')
    installLinkGuards(f.wc, links)
    expect(f.windowOpen('https://example.com/')).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://example.com/')
  })

  it('window.open of a file: URL is denied and never reaches the OS opener', () => {
    const { links, openExternal } = setup()
    const f = fakeWebContents('file:///app/out/renderer/index.html')
    installLinkGuards(f.wc, links)
    expect(f.windowOpen('file:///etc/passwd')).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('a navigation away from the app is stopped and an https target opens in the browser', () => {
    const { links, openExternal } = setup()
    const f = fakeWebContents('http://localhost:5173/')
    installLinkGuards(f.wc, links)
    expect(f.navigate('https://example.com/docs')).toBe(true)
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('a navigation to a file: URL is stopped and opens nothing', () => {
    const { links, openExternal } = setup()
    const f = fakeWebContents('file:///app/out/renderer/index.html')
    installLinkGuards(f.wc, links)
    expect(f.navigate('file:///etc/passwd')).toBe(true)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('a same-origin dev page (Vite HMR reload) is NOT stopped', () => {
    const { links, openExternal } = setup()
    const f = fakeWebContents('http://localhost:5173/')
    installLinkGuards(f.wc, links)
    expect(f.navigate('http://localhost:5173/')).toBe(false)
    expect(f.navigate('http://localhost:5173/#x')).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('the packaged page reloading itself is NOT stopped, but another file: page is', () => {
    const { links } = setup()
    const f = fakeWebContents('file:///app/out/renderer/index.html')
    installLinkGuards(f.wc, links)
    expect(f.navigate('file:///app/out/renderer/index.html')).toBe(false)
    expect(f.navigate('file:///app/out/renderer/other.html')).toBe(true)
  })
})
