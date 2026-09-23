// The app-wide run profile: which data dir and which localhost ports this process uses.
//
// `npm run dev` gets its OWN profile so it can run beside the installed app. Without it both
// read and write the same `~/.config/claude-watcher` (the unpackaged app takes its name from
// package.json, the same name the package uses) and both want 127.0.0.1:9279 — the second one
// to start logs `code=eaddrinuse`, binds nothing, and its hook POSTs land on the OTHER instance.
//
// The profile is decided ONCE, at import, from the environment. `ELECTRON_RENDERER_URL` is the
// signal: electron-vite sets it only for `electron-vite dev` (it is the HMR server's URL), so a
// packaged app, `npm run smoke` and the drive/e2e runs of the BUILT app (`out/main/index.js`)
// all stay on the default profile and keep the ports their harnesses POST to.
//
// This module is pure (no electron import) so `hookContract.ts` — imported by main-unit tests —
// can read its port from here without loading electron.

export type ProfileName = 'default' | 'dev'

export interface Profile {
  readonly name: ProfileName
  /** The folder under `app.getPath('appData')` that holds userData. */
  readonly userDataDirName: string
  /** The hook ingest port every launched claude POSTs to (`--settings` carries the URL). */
  readonly hookPort: number
  /** The API port a FRESH settings file starts with. An existing file keeps its own value. */
  readonly apiPort: number
  /** Appended to the window title, so the two windows are told apart in the taskbar. */
  readonly titleSuffix: string
}

export const DEFAULT_PROFILE: Profile = {
  name: 'default',
  userDataDirName: 'claude-watcher',
  hookPort: 9279,
  apiPort: 9281,
  titleSuffix: ''
}

// 1xxxx mirrors of the default ports: easy to recognise, and clear of 9280 (the operator's
// `kubectl-radar`, see .claude/rules/api.md).
export const DEV_PROFILE: Profile = {
  name: 'dev',
  userDataDirName: 'claude-watcher-dev',
  hookPort: 19279,
  apiPort: 19281,
  titleSuffix: ' (dev)'
}

export function resolveProfile(env: NodeJS.ProcessEnv): Profile {
  const rendererUrl = env['ELECTRON_RENDERER_URL']
  return rendererUrl !== undefined && rendererUrl !== '' ? DEV_PROFILE : DEFAULT_PROFILE
}

export const PROFILE: Profile = resolveProfile(process.env)
