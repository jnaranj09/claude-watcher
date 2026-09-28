// The application menu — or rather its absence. Electron installs a default menu whose
// accelerators (Ctrl+R reload, Ctrl+M minimize, F11, Ctrl+0, Ctrl+Shift+I, …) fire before the
// page sees the key, and `autoHideMenuBar` only hides the bar: on Linux a tap of Alt still
// brings it up and takes focus away from the terminal. Ctrl+R reloading the renderer is the
// worst of them — the reloaded page never gets a board snapshot again (UX-16 / R2 in
// docs/reports/2026-09-23-bug-hunt).
//
// So there is no menu, and every key reaches the page (and so the terminal). `watchWindowShortcuts`
// from @electron-toolkit papered over the default menu by swallowing Ctrl+R in production, which
// is why claude's own Ctrl+R (history search) never arrived. Its one useful job, F12 toggling
// DevTools in dev, is `installDevToolsToggle` below.

import type { MenuItemConstructorOptions } from 'electron'

/** The menu to install, or null for none. macOS keeps the app menu (Cmd+Q, Hide) and the Edit
 *  menu: there, Cmd+C / Cmd+V reach a text field only through the Edit menu's roles. There is
 *  no View menu anywhere, so no Cmd+R / Ctrl+R reload. */
export function applicationMenuTemplate(
  platform: NodeJS.Platform
): MenuItemConstructorOptions[] | null {
  if (platform !== 'darwin') return null
  return [{ role: 'appMenu' }, { role: 'editMenu' }]
}

/** The part of a WebContents the toggle uses — narrow so a test can drive it by hand. */
export interface DevToolsTarget {
  on(
    event: 'before-input-event',
    listener: (event: { preventDefault: () => void }, input: { type: string; code: string }) => void
  ): void
  isDevToolsOpened(): boolean
  openDevTools(options: { mode: 'undocked' }): void
  closeDevTools(): void
}

/** Dev only: F12 opens / closes DevTools. The key is taken, so it never reaches the terminal. */
export function installDevToolsToggle(wc: DevToolsTarget): void {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.code !== 'F12') return
    event.preventDefault()
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'undocked' })
  })
}
