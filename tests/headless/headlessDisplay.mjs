// Every app a test opens (e2e, drive, packaged smoke) runs on a HIDDEN display, so it never
// takes the operator's focus or keys (operator, 2026-10-05: typing landed in test windows).
//
// The display is a private KWin compositor (`kwin_wayland --virtual`): it renders to memory, shows
// nothing on screen, and Electron still gets the real GPU (measured: ANGLE on the host's radeonsi),
// so a drive screenshot looks like the real app. The app is pointed at it by env: WAYLAND_DISPLAY
// names its socket and DISPLAY is dropped, so nothing falls back to the desktop's Xwayland.
//
// `CW_HEADED=1` opts out (watch a run on the desktop). No `kwin_wayland`, or not Linux ⇒ the old
// visible window, with one warning line.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const START_TIMEOUT_MS = 5000

/** The env without the desktop's display, pointed at `socket`. */
function onSocket(env, socket) {
  const out = { ...env, WAYLAND_DISPLAY: socket }
  delete out.DISPLAY
  return out
}

const visible = (why) => {
  if (why) console.warn(`[headless] ${why}; the app window opens on the desktop`)
  return { env: (env) => ({ ...env }), stop: () => {} }
}

/**
 * Start a hidden display. `env(base)` returns `base` pointed at it; `stop()` ends it (also run
 * when this process exits).
 * @returns {Promise<{ env: (base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv, stop: () => void }>}
 */
export async function startHeadlessDisplay() {
  if (process.env.CW_HEADED === '1') return visible(null)
  if (process.platform !== 'linux') return visible(null)
  const runtimeDir = process.env.XDG_RUNTIME_DIR
  if (!runtimeDir) return visible('no XDG_RUNTIME_DIR')
  if (spawnSync('sh', ['-c', 'command -v kwin_wayland'], { stdio: 'ignore' }).status !== 0) {
    return visible('kwin_wayland not found')
  }

  const socket = `cw-headless-${process.pid}`
  const kwin = spawn(
    'kwin_wayland',
    [
      '--virtual',
      '--socket',
      socket,
      '--width',
      '1920',
      '--height',
      '1080',
      '--no-lockscreen',
      '--no-global-shortcuts',
      '--no-kactivities'
    ],
    { env: onSocket(process.env, ''), detached: true, stdio: 'ignore' }
  )
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    try {
      process.kill(-kwin.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
  process.once('exit', stop)

  const socketPath = path.join(runtimeDir, socket)
  const deadline = Date.now() + START_TIMEOUT_MS
  while (!existsSync(socketPath)) {
    if (kwin.exitCode !== null || Date.now() > deadline) {
      stop()
      return visible('the hidden display did not start')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return { env: (base) => onSocket(base, socket), stop }
}
