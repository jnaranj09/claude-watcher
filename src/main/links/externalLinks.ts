// External links — the ONE gate between a clicked link and the OS default browser. Every path
// a link can take ends here: the terminal's links (CH.linkOpenExternal), a `window.open`, and a
// navigation of the main window itself. Only http(s) passes; anything else (`file:`,
// `javascript:`, a custom app scheme) is refused, because `shell.openExternal` hands the URL
// to the OS, which would happily open a local file or launch another app.
//
// Cross-platform by construction: the opener is Electron's `shell.openExternal`, which is
// `xdg-open` on Linux, `open` on macOS and `ShellExecute` on Windows. No per-OS code here.
//
// Logs carry `code=` only — never the URL (a query string can carry a token).

const LOG_PREFIX = '[claude-watcher][links]'
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export interface ExternalLinks {
  /** Open `url` in the OS default browser. True when it was handed to the OS (the OS may still
   *  fail, which is logged); false when it was refused. Never throws. */
  open(url: string): boolean
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

export function isExternalUrl(raw: string): boolean {
  const url = parse(raw)
  return url !== null && ALLOWED_PROTOCOLS.has(url.protocol)
}

export function createExternalLinks(opts: {
  openExternal: (url: string) => Promise<void>
  log?: (message: string) => void
}): ExternalLinks {
  const log = opts.log ?? ((message: string): void => console.warn(message))
  return {
    open(raw) {
      const url = parse(raw)
      if (url === null) {
        log(`${LOG_PREFIX} code=link_invalid`)
        return false
      }
      if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
        log(`${LOG_PREFIX} code=link_scheme_refused`)
        return false
      }
      // Never the error: the OS opener's message can quote the URL.
      opts.openExternal(raw).catch(() => log(`${LOG_PREFIX} code=link_open_failed`))
      return true
    }
  }
}

/** The part of a WebContents the guards use — narrow so a test can drive it by hand. */
export interface LinkGuardTarget {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(
    event: 'will-navigate',
    listener: (event: { url: string; preventDefault: () => void }) => void
  ): void
  getURL(): string
}

function withoutHash(raw: string): string {
  const i = raw.indexOf('#')
  return i === -1 ? raw : raw.slice(0, i)
}

/** The app is a single page: it never opens a window and never navigates away. A `window.open`
 *  is always denied (an http(s) target goes to the browser instead), and so is a navigation to
 *  any page other than the one loaded — only the page reloading itself (a dev HMR reload) goes
 *  through. */
export function installLinkGuards(wc: LinkGuardTarget, links: ExternalLinks): void {
  wc.setWindowOpenHandler(({ url }) => {
    links.open(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (event) => {
    if (withoutHash(event.url) === withoutHash(wc.getURL())) return
    event.preventDefault()
    links.open(event.url)
  })
}
