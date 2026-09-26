// Terminal links — which click opens a link in the OS default browser. ONE activator serves both
// kinds of terminal link: xterm's `linkHandler` (OSC 8 hyperlinks, which claude prints) and
// @xterm/addon-web-links (plain-text URLs). The URL goes to MAIN over the `window.links` bridge;
// main decides which schemes may open (`src/main/links/externalLinks.ts`).
//
// The gesture is the platform's "open link" modifier, as in VS Code: Ctrl+click on Linux and
// Windows, Cmd+click on macOS (where Ctrl+click is the context-menu click). A plain click stays
// free for selecting text.

const LOG_PREFIX = '[claude-watcher][links]'

export type LinkActivate = (event: MouseEvent, uri: string) => void

/** The sandboxed renderer has no `process.platform`; Chromium's user agent names macOS as
 *  `Macintosh` on every Mac build. */
export function isMacUserAgent(userAgent: string): boolean {
  return userAgent.includes('Macintosh')
}

export function isOpenGesture(
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>,
  isMac: boolean
): boolean {
  return isMac ? event.metaKey : event.ctrlKey
}

export function createLinkActivator(opts: {
  open: (url: string) => Promise<void>
  isMac: boolean
}): LinkActivate {
  return (event, uri) => {
    if (!isOpenGesture(event, opts.isMac)) return
    // Never the URL or the error in the log: a URL can carry a token.
    opts.open(uri).catch(() => console.warn(`${LOG_PREFIX} code=link_open_failed`))
  }
}

export interface LinkClickGuard {
  /** The link under the mouse — fed by xterm's `linkHandler.hover` and the web-links addon. */
  hover(uri: string): void
  leave(): void
  /** CAPTURE-phase listeners on the terminal frame, so they run before xterm sees the click. */
  onMouseDown(event: MouseEvent): void
  onMouseUp(event: MouseEvent): void
}

/** A gesture click on a link belongs to the APP alone. claude turns on mouse reporting, so xterm
 *  forwards every click to it too — and claude opened the same link a second time on a Ctrl+click
 *  (2026-09-25: one xdg-open under electron, one under claude). So a gesture mousedown over a link
 *  opens it here and is stopped before xterm can report it, and so is its mouseup. Every other
 *  click — plain, right, middle, or a gesture click off a link — passes through untouched. */
export function createLinkClickGuard(opts: {
  open: (url: string) => Promise<void>
  isMac: boolean
}): LinkClickGuard {
  let hovered: string | null = null
  let takenPress = false
  const take = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
  }
  return {
    hover(uri) {
      hovered = uri
    },
    leave() {
      hovered = null
    },
    onMouseDown(event) {
      takenPress = false
      if (event.button !== 0 || hovered === null || !isOpenGesture(event, opts.isMac)) return
      take(event)
      takenPress = true
      // Never the URL or the error in the log: a URL can carry a token.
      opts.open(hovered).catch(() => console.warn(`${LOG_PREFIX} code=link_open_failed`))
    },
    onMouseUp(event) {
      if (!takenPress) return
      takenPress = false
      take(event)
    }
  }
}
