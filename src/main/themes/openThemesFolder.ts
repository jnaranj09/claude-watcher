// Settings → Appearance → Open themes folder. `mkdir -p` first so there is always something to
// open, then hand the folder to the OS — and return WITHOUT waiting for the opener.
//
// Why not await it: on Linux, Electron 39's `shell.openPath` runs `xdg-open` with
// `wait_for_exit=false` and drops its callback, so the promise NEVER settles
// (`shell/common/platform_util_linux.cc`). Awaited inside an `ipcMain.handle`, the invoke stayed
// pending until its reply channel was garbage-collected (~30 s), then rejected with "reply was
// never sent" — and the renderer showed "Could not open the themes folder." over a folder that
// had opened at once (drive run 2026-10-01). On macOS/Windows it does settle; a problem there is
// logged, as before.
//
// Logs carry `code=` only: an errno message and openPath's error string both quote the absolute
// path.

const LOG_PREFIX = '[claude-watcher][themes]'

export function openThemesFolder(
  dir: string,
  deps: {
    mkdir: (dir: string) => void
    openPath: (dir: string) => Promise<string>
    log?: (message: string) => void
  }
): void {
  const log = deps.log ?? ((message: string): void => console.warn(message))
  try {
    deps.mkdir(dir)
  } catch {
    log(`${LOG_PREFIX} code=themes_open_folder_mkdir_failed`)
    return
  }
  deps.openPath(dir).then(
    (problem) => {
      if (problem !== '') log(`${LOG_PREFIX} code=themes_open_folder_failed`)
    },
    () => log(`${LOG_PREFIX} code=themes_open_folder_failed`)
  )
}
