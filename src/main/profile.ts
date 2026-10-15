// The app-wide run profile: which data dir and which localhost ports this process uses.
//
// `npm run dev` gets its OWN profile so it can run beside the installed app. Without it both
// read and write the same `~/.config/claude-watcher` (the unpackaged app takes its name from
// package.json, the same name the package uses) and both want 127.0.0.1:9279 — the second one
// to start logs `code=eaddrinuse`, binds nothing, and its hook POSTs land on the OTHER instance.
//
// The profile is decided ONCE, at import, from the environment. `ELECTRON_RENDERER_URL` is the
// signal: electron-vite sets it only for `electron-vite dev` (it is the HMR server's URL), so a
// packaged app and `npm run smoke` stay on the default profile and keep the ports their harnesses
// POST to. The drive runs set `CLAUDE_WATCHER_PROFILE=drive` and get DRIVE_PROFILE (below); the e2e
// runs of the BUILT app (`out/main/index.js`) set `CLAUDE_WATCHER_PROFILE=e2e` and get E2E_PROFILE.
//
// This module is pure (no electron import) so `hookContract.ts` — imported by main-unit tests —
// can read its port from here without loading electron.

import { isAbsolute } from 'node:path'

export type ProfileName = 'default' | 'dev' | 'drive' | 'e2e'

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

// The scripted runs of the BUILT app (`tests/drive/driveApp.mjs`) get their own profile too, so a
// screenshot run works beside the installed app AND beside `npm run dev` — with the default profile
// it fought the installed app for 9279 and the operator had to close it every time. The built app
// has no renderer URL, so the signal is an explicit env var the driver sets. 2xxxx mirrors, same
// reason as the dev ports.
export const DRIVE_PROFILE: Profile = {
  name: 'drive',
  userDataDirName: 'claude-watcher-drive',
  hookPort: 29279,
  apiPort: 29281,
  titleSuffix: ' (drive)'
}

// The e2e runs of the BUILT app (`tests/e2e`) get their own profile: before it they ran on the
// default profile, so with the installed app running they skipped (port 9279 taken) and read and
// wrote the operator's own userData. 3xxxx mirrors, same reason as the dev and drive ports. Its
// userData is a fresh temp folder per launch (`e2eDataDir`), never a shared one.
export const E2E_PROFILE: Profile = {
  name: 'e2e',
  userDataDirName: 'claude-watcher-e2e',
  hookPort: 39279,
  apiPort: 39281,
  titleSuffix: ' (e2e)'
}

export const E2E_DATA_DIR_ENV = 'CLAUDE_WATCHER_E2E_DATA_DIR'

/** The absolute data dir an e2e app must use, or null when missing or relative. */
export function e2eDataDir(env: NodeJS.ProcessEnv): string | null {
  const dir = env[E2E_DATA_DIR_ENV]
  return dir !== undefined && isAbsolute(dir) ? dir : null
}

export function resolveProfile(env: NodeJS.ProcessEnv): Profile {
  // Exact match only: this var selects `drive` or `e2e` and nothing else, so it can never move a
  // packaged app onto another profile's ports by accident.
  if (env['CLAUDE_WATCHER_PROFILE'] === 'drive') return DRIVE_PROFILE
  if (env['CLAUDE_WATCHER_PROFILE'] === 'e2e') return E2E_PROFILE
  const rendererUrl = env['ELECTRON_RENDERER_URL']
  return rendererUrl !== undefined && rendererUrl !== '' ? DEV_PROFILE : DEFAULT_PROFILE
}

export const PROFILE: Profile = resolveProfile(process.env)
