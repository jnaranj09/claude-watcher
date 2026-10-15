// The e2e profile refuses to start without its data folder (src/main/index.ts, src/main/profile.ts):
// with `CLAUDE_WATCHER_PROFILE=e2e` and no `CLAUDE_WATCHER_E2E_DATA_DIR` it would otherwise run on
// the default userData, which may be the operator's. It exits 1 with
// `code=e2e_data_dir_missing`, before it claims the single-instance lock or builds anything.
// `XDG_CONFIG_HOME` points at a temp folder, so even a regression that ran on the default userData
// would not touch the operator's.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { E2E_DATA_DIR_ENV } from '../../src/main/profile'
import { test, expect, spawnApp, killGroup } from './fixtures'

test('the e2e profile without a data folder exits 1 with code=e2e_data_dir_missing', async () => {
  const configHome = mkdtempSync(path.join(tmpdir(), 'cw-e2e-config-'))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_WATCHER_PROFILE: 'e2e',
    XDG_CONFIG_HOME: configHome
  }
  delete env[E2E_DATA_DIR_ENV]
  const app = spawnApp(env)
  try {
    const code = await Promise.race([
      app.exited,
      new Promise<'still running'>((resolve) => setTimeout(() => resolve('still running'), 10_000))
    ])
    const log = app.log.text()
    expect(code, `the refused app must exit 1. Its log:\n${log}`).toBe(1)
    expect(log).toContain('[claude-watcher][profile] code=e2e_data_dir_missing')
    // A refused start reports the refusal only, not a profile it never ran on.
    expect(log).not.toContain('[claude-watcher][profile] name=')
  } finally {
    await killGroup(app.proc)
    rmSync(configHome, { recursive: true, force: true })
  }
})
