import { app } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'os'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { CH } from '../../shared/ipc/contract'
import type { PtyResizeRequest, SmokeConfig, SmokeReport } from '../../shared/ipc/contract'
import { buildPtyEnv } from '../pty/ptyEnv'
import type { ApiLifecycle } from '../api/apiLifecycle'
import { createThemeScanner } from '../themes/themeScanner'
import { BUNDLED_THEME_IDS } from '../themes/bundledThemes'
import { containSmokeReport, registerSmokeIpc } from '../smoke/smokeIpc'
import type { TrustedIpc } from './trustedIpc'

/** What the Story-0.1 PTY spike and the smoke verdict read from the app. `ptys` is owned by
 *  index.ts (a window close kills its PTY); the API lifecycle is a GETTER (built after app-ready). */
export interface PtyIpcDeps {
  ipc: TrustedIpc
  smoke: boolean
  /** Where the smoke verdict is written (`C9_SMOKE_OUT`); empty = stdout only. */
  smokeOut: string
  /** The default spawn shell (`$SHELL`). */
  shell: string
  ptys: Map<Electron.WebContents, IPty>
  getApiLifecycle: () => ApiLifecycle | null
  bundledThemes: () => { dir: string; ids: typeof BUNDLED_THEME_IDS }
}

// Build the child env for the PTY (Review F7): drop undefined-valued keys (the
// process.env type lies about this) and strip the test/harness vars (C9_SMOKE* and the
// Story-5.4 C9_TEST_PICK_DIR picker seam) so they do not leak into the spawned shell or
// anything it launches (e.g. claude).
export function registerPtyIpc(deps: PtyIpcDeps): void {
  const {
    ipc,
    smoke: SMOKE,
    smokeOut: SMOKE_OUT,
    shell: SHELL,
    ptys,
    getApiLifecycle,
    bundledThemes
  } = deps
  // Renderer asks for the PTY once the terminal element is mounted & sized.
  const ptyStart = (evt: Electron.IpcMainEvent): void => {
    const wc = evt.sender
    if (ptys.has(wc)) return
    const term = pty.spawn(SHELL, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: buildPtyEnv()
    })
    ptys.set(wc, term)

    // ABI proof for the record (AC-2 / AC-5): a successful spawn means node-pty
    // is ABI-matched to this Electron. Surface the ABI in a log line.
    console.log(
      `[c9watch][pty] spawned pid=${term.pid} shell=${SHELL} ` +
        `electron=${process.versions.electron} abi(process.versions.modules)=${process.versions.modules}`
    )

    term.onData((data) => {
      if (!wc.isDestroyed()) wc.send(CH.ptyData, data)
    })

    term.onExit(({ exitCode }) => {
      console.log(`[c9watch][pty] exited code=${exitCode}`)
      if (!wc.isDestroyed()) wc.send(CH.ptyExit, { exitCode })
      ptys.delete(wc)
    })
  }

  const ptyInput = (evt: Electron.IpcMainEvent, data: string): void => {
    ptys.get(evt.sender)?.write(data)
  }

  // Resize ordering (Guardrail #8): the renderer computes cols/rows, then the
  // PTY is resized. We resize the pty here on receipt; the renderer fits after.
  const ptyResize = (evt: Electron.IpcMainEvent, size: PtyResizeRequest): void => {
    const term = ptys.get(evt.sender)
    if (term && size && size.cols > 0 && size.rows > 0) {
      try {
        term.resize(size.cols, size.rows)
      } catch (e) {
        console.error('[c9watch][pty] resize error', e)
      }
    }
  }

  // Smoke harness wiring (AC-3). Renderer asks whether smoke mode is on, and
  // posts its verdict here; main persists it and exits.
  const config = (): SmokeConfig => ({
    enabled: SMOKE,
    electron: process.versions.electron,
    abi: process.versions.modules,
    node: process.versions.node
  })

  const smokeReport = async (evt: Electron.IpcMainEvent, report: SmokeReport): Promise<void> => {
    const term = ptys.get(evt.sender)
    // Programmatic API — the packaged-docs check. The listener was forced up on an ephemeral
    // port at app-ready (SMOKE), so a 200 from these routes proves the docs serve from INSIDE
    // the packaged asar, not just in dev.
    //
    // THREE routes, because they fail for three different reasons: `/openapi.json` builds the
    // document, `/docs` only proves `swagger-ui-dist` RESOLVES (it answers 200 the moment
    // `swaggerDistDir !== null` and reads nothing), and the ASSET is the only one that opens a
    // packaged file — the case the electron-builder `files` negations could trim without
    // anything else noticing.
    const port = getApiLifecycle()?.port() ?? null
    let api: { docs: number; openapi: number; asset: number; pass: boolean } = {
      docs: 0,
      openapi: 0,
      asset: 0,
      pass: false
    }
    if (port !== null) {
      // TIMEBOXED. This runs inside the verdict path: the handler writes the verdict file and
      // then app.exit()s, and the runner's failure mode for a missing verdict file is exit 3.
      // A hung fetch would turn a passing smoke into "no verdict file written" — so a timeout
      // is a FAILED CHECK (status 0 → pass false), never a hang.
      const status = async (path: string): Promise<number> => {
        try {
          return (
            await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) })
          ).status
        } catch {
          return 0
        }
      }
      const docs = await status('/docs')
      const openapi = await status('/openapi.json')
      // One of the three allow-listed names — the bundle, the biggest of them. A 404 here is a
      // packaged read that failed (`code=docs_read_failed`), not a routing miss.
      const asset = await status('/docs/swagger-ui-bundle.js')
      api = { docs, openapi, asset, pass: docs === 200 && openapi === 200 && asset === 200 }
    }
    // Bundled themes (spec 2026-09-25) — the packaged read. `scan()` must list every bundled id
    // clean and `load('liquid-glass')` must compose (CSS + a ~1 MB wallpaper) from
    // <resourcesPath>/themes — the only check that opens a theme file inside a real package.
    // A PROBE scanner over an EMPTY user folder, not the app's own: the smoke runs on the default
    // profile, and an operator's hand copy in <userData>/themes would pass the check with a
    // package that carries no theme at all (seen on the first run).
    let themes = { listed: [] as string[], liquidGlass: false, pass: false }
    try {
      const probeDir = mkdtempSync(join(os.tmpdir(), 'claude-watcher-smoke-themes-'))
      try {
        const probe = createThemeScanner({ dir: probeDir, bundled: bundledThemes(), log: () => {} })
        const listed = probe
          .scan()
          .filter((t) => t.error === undefined)
          .map((t) => t.id)
        const liquidGlass = probe.load('liquid-glass').ok
        themes = {
          listed,
          liquidGlass,
          pass: liquidGlass && BUNDLED_THEME_IDS.every((id) => listed.includes(id))
        }
      } finally {
        rmSync(probeDir, { recursive: true, force: true })
      }
    } catch {
      console.error('[claude-watcher][themes] code=smoke_probe_failed')
    }
    const full = {
      ...report,
      main: {
        electron: process.versions.electron,
        abi: process.versions.modules,
        node: process.versions.node,
        ptyPid: term?.pid ?? null,
        api,
        themes
      }
    }
    const json = JSON.stringify(full, null, 2)
    console.log('[c9watch][smoke] REPORT ' + json)
    // Review F10: a verdict we cannot persist must NOT look like a pass. If the
    // write fails, exit non-zero so the gate can never silently pass without a
    // persisted verdict the runner can read.
    let writeFailed = false
    if (SMOKE_OUT) {
      try {
        writeFileSync(SMOKE_OUT, json)
      } catch (e) {
        console.error('[c9watch][smoke] failed to write report', e)
        writeFailed = true
      }
    }
    term?.kill()
    ptys.delete(evt.sender)
    const passed = !writeFailed && full && (full as { pass?: boolean }).pass === true
    const code = passed ? 0 : 4
    // Review (smoke termination): `app.exit()` can fail to tear the process down
    // promptly under Electron+Wayland here (GPU/compositor teardown lingers),
    // which would hang the smoke runner until its external timeout and surface a
    // genuine pass as ETIMEDOUT/exit-2. The verdict is already persisted above,
    // so in smoke mode force a hard process exit as a fallback.
    app.exit(code)
    setTimeout(() => process.exit(code), 250)
  }

  // SEC-8: outside smoke only `smokeConfig` exists (App.tsx asks it on every start).
  registerSmokeIpc(ipc, SMOKE, {
    config,
    ptyStart,
    ptyInput,
    ptyResize,
    // A rejected report must not vanish: log a code and exit non-zero (the runner reads a fail).
    report: (evt, report: SmokeReport) =>
      void containSmokeReport(() => smokeReport(evt, report), {
        log: (m) => console.error(m),
        exit: (code) => {
          // The same hard fallback smokeReport's own exit uses (Wayland teardown can linger).
          app.exit(code)
          setTimeout(() => process.exit(code), 250)
        }
      })
  })
}
