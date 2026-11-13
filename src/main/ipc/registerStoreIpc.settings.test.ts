// `settings:set` and Memory off (R51): the patch that switches `Memory` off tells the extractor,
// which cancels the save call in flight; no other patch does. A real settings store in memory.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CH, type Channel } from '../../shared/ipc/contract'
import { createSettingsStore } from '../persistence/settings'
import { createStoreIpc, type StoreIpcDeps } from './registerStoreIpc'

vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, dialog: {}, shell: {} }))

type Listener = (event: unknown, ...args: unknown[]) => unknown

let handlers: Map<Channel, Listener>
let memoryTurnedOff: ReturnType<typeof vi.fn>
const set = (patch: unknown): unknown => handlers.get(CH.settingsSet)?.({}, patch)

beforeEach(() => {
  handlers = new Map()
  memoryTurnedOff = vi.fn()
  const settings = createSettingsStore({ log: () => undefined })
  const deps = {
    ipc: {
      handle: (channel: Channel, listener: Listener) => handlers.set(channel, listener),
      on: () => undefined
    },
    getSettingsStore: () => settings,
    getApiLifecycle: () => null,
    getThemeLifecycle: () => null,
    memoryTurnedOff
  }
  // Only the settings registrar runs: it reads nothing else from the deps.
  createStoreIpc(deps as unknown as StoreIpcDeps).registerSettingsIpc()
})

describe('settings:set and Memory off (R51)', () => {
  it('switching Memory off tells the extractor once', () => {
    set({ memoryEnabled: false })
    expect(memoryTurnedOff).toHaveBeenCalledTimes(1)
  })

  it('a patch that leaves Memory off, or turns it on, tells it nothing', () => {
    set({ memoryEnabled: false })
    set({ memoryEnabled: false })
    set({ memoryEnabled: true })
    set({ terminalFontSize: 14 })
    expect(memoryTurnedOff).toHaveBeenCalledTimes(1)
  })
})
