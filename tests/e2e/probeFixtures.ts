// The UI probe's fixture (`uiProbe.e2e.ts`, design.md "UI pipeline" stage 7): tests/e2e/fixtures.ts
// plus a window width and three IPC seams.
//
// WIDTH: `probeWidth` is a project option (`playwright.config.ts` projects `w900` and `w1400`).
// `page` here sets the window's CONTENT size to that width (so `innerWidth` is exactly it, whatever
// frame the window manager draws) and waits until the renderer reports it. axe.e2e.ts cannot get
// the width: it uses fixtures.ts, and an option only reaches the fixtures its test was built
// from. So the probe runs axe itself at each width, and axe.e2e.ts stays at the default size.
//
// IPC: `failIpc`, `slowIpc` and `countIpc` replace the main-process handler of one `CH` channel
// from inside main (`app.evaluate`): `failIpc` throws `probe_failed` (what a 500 is to a web
// app), `slowIpc` never answers (the control must stay busy), and both count the invokes, which
// `countIpc` reads. The replacement skips the trusted-sender wrapper of `ipc/trustedIpc.ts`; it
// lives only as long as this test's app.
//
// CLAUDE: every app launches a stand-in `claude` (`CLAUDE_WATCHER_CLAUDE_BIN`, the operator's
// override in src/main/pty/claudeBin.ts): a shell script that answers `--version` with a version
// past every floor and otherwise waits. Its argv carries `--session-id` and `--settings`, so
// `hookPathOf` (tests/e2e/support/proc.ts) finds its channel path. CI has no real claude.
import type { ElectronApplication, Page } from '@playwright/test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { E2E_PROFILE } from '../../src/main/profile'
import type { Channel } from '../../src/shared/ipc/contract'
import { test as base, expect } from './fixtures'

export { expect } from './fixtures'

/** The window height every probe runs at (the width is the project's). */
const PROBE_HEIGHT = 800

/** Wait until the renderer is the app (its menu button), not the skeleton or a blank frame. */
export async function waitForBoard(page: Page): Promise<void> {
  await expect(page.getByTestId('app-menu')).toBeVisible({ timeout: 20000 })
}

/** Resize the window's content to `width` × PROBE_HEIGHT and wait for `innerWidth` to match. */
export async function resizeTo(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      for (const w of BrowserWindow.getAllWindows()) w.setContentSize(size.width, size.height)
    },
    { width, height: PROBE_HEIGHT }
  )
  await expect
    .poll(() => page.evaluate(() => window.innerWidth), {
      message: `the window never reached ${width} px (the display may be narrower)`
    })
    .toBe(width)
}

type IpcMode = 'fail' | 'slow'

/** Replace `channel`'s handler in main with one that counts, then throws or never answers. */
async function replaceIpc(
  app: ElectronApplication,
  channel: Channel,
  mode: IpcMode
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, arg) => {
      const g = globalThis as { __probeIpcCount?: Record<string, number> }
      const counts = (g.__probeIpcCount ??= {})
      counts[arg.channel] = 0
      ipcMain.removeHandler(arg.channel)
      ipcMain.handle(arg.channel, () => {
        counts[arg.channel] = (counts[arg.channel] ?? 0) + 1
        if (arg.mode === 'fail') throw new Error('probe_failed')
        return new Promise<never>(() => {})
      })
    },
    { channel, mode }
  )
}

/** `channel` answers every invoke with an error (the probe's 500). */
export const failIpc = (app: ElectronApplication, channel: Channel): Promise<void> =>
  replaceIpc(app, channel, 'fail')

/** `channel` never answers (the probe's slow response). */
export const slowIpc = (app: ElectronApplication, channel: Channel): Promise<void> =>
  replaceIpc(app, channel, 'slow')

/** How many invokes reached `channel` since `failIpc` / `slowIpc` replaced it. */
export function countIpc(app: ElectronApplication, channel: Channel): Promise<number> {
  return app.evaluate(
    (_electron, ch) =>
      (globalThis as { __probeIpcCount?: Record<string, number> }).__probeIpcCount?.[ch] ?? 0,
    channel
  )
}

/** POST one hook body to the e2e profile's hook listener at the session's channel path (the
 *  same request claude sends, as tests/e2e/native-engine.e2e.ts does). Resolves the status. */
export function postHook(hookPath: string, body: Record<string, unknown>): Promise<number> {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: E2E_PROFILE.hookPort,
        method: 'POST',
        path: hookPath,
        headers: { 'content-type': 'application/json', 'content-length': payload.length }
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

/** The stand-in claude: a version past every floor, then it waits until it is killed (a loop, not
 *  `exec sleep`, so its own argv, with the session id, stays in /proc). */
const STAND_IN_CLAUDE = [
  '#!/bin/sh',
  'if [ "$1" = "--version" ]; then echo "2.1.999 (Claude Code)"; exit 0; fi',
  'while :; do sleep 1; done',
  ''
].join('\n')

export const test = base.extend<{ probeWidth: number }>({
  // The content width the probe runs at. Set per project in playwright.config.ts.
  probeWidth: [1000, { option: true }],
  appEnv: async ({ appEnv }, provide) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cw-e2e-standin-'))
    const bin = path.join(dir, 'claude')
    writeFileSync(bin, STAND_IN_CLAUDE)
    chmodSync(bin, 0o755)
    try {
      await provide({ ...appEnv, env: { ...appEnv.env, CLAUDE_WATCHER_CLAUDE_BIN: bin } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  page: async ({ app, page, probeWidth }, provide) => {
    await waitForBoard(page)
    await resizeTo(app, page, probeWidth)
    await provide(page)
  }
})
