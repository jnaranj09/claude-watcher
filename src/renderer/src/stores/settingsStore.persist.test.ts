// Action feedback (spec 2026-09-29 §2.1) — persistSettingsPatch rolls a refused write back to the
// last value MAIN returned (`authoritative`) and rethrows a CODE, so the optimistic value never
// outlives a refused write and the caller can say so.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { persistSettingsPatch, settingsStore, SETTINGS_PERSIST_FAILED } from './settingsStore'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/schemas/settings'
import { deferred } from '../test/deferred'

function stubSet(set: (patch: unknown) => Promise<Settings>): void {
  ;(window as unknown as { settings: unknown }).settings = { get: vi.fn(), set: vi.fn(set) }
}

afterEach(() => {
  settingsStore.getState().hydrate(DEFAULT_SETTINGS)
  vi.restoreAllMocks()
})

describe('persistSettingsPatch — authoritative + rollback', () => {
  it('hydrate records what main returned as the authoritative settings', () => {
    const stored: Settings = { ...DEFAULT_SETTINGS, terminalFontSize: 20 }
    settingsStore.getState().hydrate(stored)
    expect(settingsStore.getState().authoritative).toEqual(stored)
  })

  it('a stored patch re-hydrates from main answer and resolves', async () => {
    stubSet(() => Promise.resolve({ ...DEFAULT_SETTINGS, soundEnabled: false }))
    await persistSettingsPatch({ soundEnabled: false })
    expect(settingsStore.getState().soundEnabled).toBe(false)
    expect(settingsStore.getState().authoritative.soundEnabled).toBe(false)
  })

  it('a refused patch rolls back to main last answer and rejects with the code', async () => {
    settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, soundEnabled: true })
    stubSet(() => Promise.reject(new Error('EACCES /home/op/.config/claude-watcher')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pending = persistSettingsPatch({ soundEnabled: false })
    expect(settingsStore.getState().soundEnabled).toBe(false) // optimistic, at once
    await expect(pending).rejects.toThrow(SETTINGS_PERSIST_FAILED)
    expect(settingsStore.getState().soundEnabled).toBe(true)
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).toContain('code=settings_persist_failed')
    expect(logged).not.toContain('/home/op')
  })

  it('write A refused while write B is in flight: B lands, A does not', async () => {
    settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, soundEnabled: true })
    const a = deferred<Settings>()
    const b = deferred<Settings>()
    stubSet((patch) =>
      (patch as { soundEnabled?: boolean }).soundEnabled !== undefined ? a.promise : b.promise
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pendingA = persistSettingsPatch({ soundEnabled: false })
    const pendingB = persistSettingsPatch({ terminalFontSize: 20 })
    a.reject(new Error('refused'))
    await expect(pendingA).rejects.toThrow(SETTINGS_PERSIST_FAILED)
    // Main stored B and not A: its answer is what the projection ends on.
    b.resolve({ ...DEFAULT_SETTINGS, soundEnabled: true, terminalFontSize: 20 })
    await pendingB
    expect(settingsStore.getState().terminalFontSize).toBe(20)
    expect(settingsStore.getState().soundEnabled).toBe(true)
  })
})
