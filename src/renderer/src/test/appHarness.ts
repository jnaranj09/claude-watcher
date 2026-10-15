// The App test harness: the fake preload (`window.*` bridges) every `App.*.test.tsx` renders the
// real App against, and the mount/unmount pair. No Electron.
//
// Usage:
//   beforeEach(() => {
//     resetBoardView()
//     stubAppBridges({ launch: { rename: renameSpy }, quit: {} })
//   })
//   afterEach(() => unmountRendered())
//   const r = await renderApp()
//
// The CORE bridges (pty, watch, attention, settings, terminal, launch, templates) are always
// installed. The OPTIONAL ones (quit, tags, rules, shortcuts, themes, pastSessions, workspaces) are
// installed only when named in `overrides`, so each suite keeps the bridge set it had before the
// harness: App skips `window.quit` and `window.themes` when they are absent (App.tsx), and these
// suites are what reach that path. An override is merged over the bridge's defaults member by
// member, so `quit: {}` installs the default quit bridge.
import { act, createElement } from 'react'
import { vi } from 'vitest'
import App from '../App'
import { boardStore } from '../stores/boardStore'
import { renderTracked, type RenderResult } from './renderComponent'
import { stubXtermBrowserApis } from './terminalHarness'

type Bridge = Record<string, unknown>

const OPTIONAL_BRIDGES = [
  'quit',
  'tags',
  'rules',
  'shortcuts',
  'themes',
  'pastSessions',
  'workspaces'
] as const

type CoreBridgeName =
  | 'pty'
  | 'watch'
  | 'attention'
  | 'settings'
  | 'terminal'
  | 'launch'
  | 'templates'
type OptionalBridgeName = (typeof OPTIONAL_BRIDGES)[number]

type AppBridgeOverrides = Partial<Record<CoreBridgeName | OptionalBridgeName, Bridge>>

/** What main's settings store holds for these suites (the fields App reads at mount). */
const SETTINGS = {
  version: 1,
  soundEnabled: true,
  terminalFontSize: 14,
  reminderCount: 3,
  reminderFirstDelayMinutes: 2
}

function coreBridges(): Record<CoreBridgeName, Bridge> {
  return {
    pty: {
      smokeConfig: vi.fn(() => Promise.resolve({ enabled: false, electron: '', abi: '', node: '' }))
    },
    watch: { onEvents: vi.fn(() => () => {}), onStatus: vi.fn(() => () => {}) },
    attention: {
      onActivate: vi.fn(() => () => {}),
      onReminder: vi.fn(() => () => {}),
      reportFocusedTerminal: vi.fn()
    },
    settings: {
      get: vi.fn(() => Promise.resolve(SETTINGS)),
      set: vi.fn(() => Promise.resolve(SETTINGS))
    },
    terminal: {
      open: vi.fn(() => () => {}),
      resize: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
      onExit: vi.fn(() => () => {})
    },
    launch: {
      pickDirectory: vi.fn(() => Promise.resolve(null)),
      launch: vi.fn(() =>
        Promise.resolve({ terminalId: 'launch-term-xyz', workspaceId: 'default' })
      ),
      launchFromTemplate: vi.fn(() =>
        Promise.resolve({ terminalId: 'launch-term-tpl', workspaceId: 'default' })
      ),
      rename: vi.fn(() => Promise.resolve()),
      setTags: vi.fn(() => Promise.resolve()),
      archiveSession: vi.fn(() => Promise.resolve(undefined)),
      deleteSession: vi.fn(() => Promise.resolve(undefined)),
      onCorrelated: vi.fn(() => () => {}),
      markSeen: vi.fn(() => Promise.resolve(undefined))
    },
    templates: { list: vi.fn(() => Promise.resolve([])), save: vi.fn(), remove: vi.fn() }
  }
}

/** Defaults for the optional bridges that more than one suite installs. */
function optionalBridgeDefaults(): Partial<Record<OptionalBridgeName, Bridge>> {
  return {
    quit: {
      requestQuit: vi.fn(() => Promise.resolve()),
      confirm: vi.fn(() => Promise.resolve()),
      cancel: vi.fn(() => Promise.resolve()),
      onGuardShow: vi.fn(() => () => {})
    },
    tags: { list: vi.fn(() => Promise.resolve([])), save: vi.fn(), remove: vi.fn() },
    rules: {
      list: vi.fn(() => Promise.resolve({ rules: [], brokenIds: [] })),
      save: vi.fn(),
      remove: vi.fn(),
      move: vi.fn()
    },
    shortcuts: { list: vi.fn(() => Promise.resolve([])), save: vi.fn(), remove: vi.fn() }
  }
}

/** Reset the singleton boardStore's view-state (App uses the app singleton) to its initial values. */
export function resetBoardView(): void {
  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null,
    sessionsById: {},
    acknowledgedById: {},
    terminalIdBySessionId: {},
    launchedTerminals: {},
    sessionNamePrompt: null,
    sessionNamePromptBusy: false,
    sessionNamePromptError: null,
    sessionsDialog: null,
    tagsDialog: null,
    settingsDialogOpen: false,
    shortcutsDialogOpen: false,
    workspacesDialogOpen: false,
    quitGuard: null,
    stopConfirm: null
  })
}

/** Install the fake preload, plus the browser APIs jsdom omits that xterm needs (matchMedia,
 *  ResizeObserver), and clear the hash so no earlier test steers App into the terminal-host view. */
export function stubAppBridges(overrides: AppBridgeOverrides = {}): void {
  stubXtermBrowserApis()
  const w = window as unknown as Record<string, unknown>
  const core = coreBridges()
  for (const [name, bridge] of Object.entries(core)) {
    w[name] = { ...bridge, ...overrides[name as CoreBridgeName] }
  }
  const optional = optionalBridgeDefaults()
  for (const name of OPTIONAL_BRIDGES) {
    const override = overrides[name]
    if (override === undefined) delete w[name]
    else w[name] = { ...optional[name], ...override }
  }
  window.location.hash = ''
}

/** Mount the real App and settle smokeConfig → the board view (the non-smoke subscriptions mount
 *  here). Unmount in afterEach with `unmountRendered()` (renderComponent.ts). */
export async function renderApp(): Promise<RenderResult> {
  const r = renderTracked(createElement(App))
  await act(async () => {
    for (let i = 0; i < 3; i++) await Promise.resolve()
  })
  return r
}
