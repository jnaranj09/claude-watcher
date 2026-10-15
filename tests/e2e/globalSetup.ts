// Runs once before any e2e worker starts. It FAILS the run, never skips a test, when the run
// could not mean anything:
//   1. the built app in out/ is older than src/ (the specs would test the old bundle). `npm run
//      test:e2e` builds first; `CW_E2E_ALLOW_STALE=1` runs an old bundle on purpose.
//   2. the e2e profile's hook or API port is already held. No other profile uses them, so the
//      holder is a leaked e2e app, and the app under test would bind nothing.
// Then every e2e app opens on a hidden display (tests/headless/headlessDisplay.mjs), never on the
// desktop. The runner's env is changed BEFORE the workers start, so each launch's
// `{ ...process.env }` inherits it. The returned function is the teardown.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { E2E_PROFILE } from '../../src/main/profile'
import { startHeadlessDisplay } from '../headless/headlessDisplay.mjs'

const ROOT = path.resolve(__dirname, '../..')

/** Newest mtime of every file under `dir`. */
function newestUnder(dir: string): number {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    newest = Math.max(newest, statSync(path.join(entry.parentPath, entry.name)).mtimeMs)
  }
  return newest
}

function assertFreshBuild(): void {
  if (process.env.CW_E2E_ALLOW_STALE === '1') return
  const configs = readdirSync(ROOT)
    .filter((n) => n.startsWith('electron.vite.config.'))
    .map((n) => statSync(path.join(ROOT, n)).mtimeMs)
  const newestSource = Math.max(newestUnder(path.join(ROOT, 'src')), ...configs)
  const preload = path.join(ROOT, 'out/preload')
  const built = [
    path.join(ROOT, 'out/main/index.js'),
    path.join(ROOT, 'out/renderer/index.html'),
    ...(existsSync(preload) ? readdirSync(preload).map((n) => path.join(preload, n)) : [preload])
  ]
  const oldestBuilt = Math.min(
    ...built.map((f) => (existsSync(f) ? statSync(f).mtimeMs : Number.NEGATIVE_INFINITY))
  )
  if (oldestBuilt < newestSource) {
    throw new Error(
      'e2e: out/ is older than src/ — run `npx electron-vite build` (npm run test:e2e does it)'
    )
  }
}

/** True when something accepts a connection on 127.0.0.1:port. */
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    let settled = false
    const done = (result: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1000, () => done(false))
  })
}

/** Who listens on the port, as `ss` reports it (process name and pid when it can see them). */
function portHolder(port: number): string {
  const out = spawnSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' }).stdout ?? ''
  const users = out.match(/users:\(\((.*)\)\)/)?.[1]
  return users ?? (out.trim() || 'an unknown process')
}

async function assertPortsFree(): Promise<void> {
  for (const port of [E2E_PROFILE.hookPort, E2E_PROFILE.apiPort]) {
    if (await portInUse(port)) {
      throw new Error(
        `e2e: port ${port} is held by ${portHolder(port)} — a leaked e2e app; kill it`
      )
    }
  }
}

export default async function globalSetup(): Promise<() => void> {
  assertFreshBuild()
  await assertPortsFree()
  const display = await startHeadlessDisplay()
  const env = display.env(process.env)
  if (!('DISPLAY' in env)) delete process.env.DISPLAY
  if (env.WAYLAND_DISPLAY !== undefined) process.env.WAYLAND_DISPLAY = env.WAYLAND_DISPLAY
  return display.stop
}
