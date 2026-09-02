// Story 2.4 — settings IPC handler-LOGIC tests (main-unit / node project).
//
// Byte transport over IPC is packaged-smoke-only (no MessagePortMain/ipcMain wire in node) —
// so we assert the HANDLER LOGIC the main `registerSettingsIpc` wires, exactly as it runs:
//   - settings:get → returns the store's current value (the value directly, no envelope).
//   - settings:set → `SettingsPatchSchema.parse(raw)` THROWS on malformed input (untrusted
//     cross-process arg, parse-and-throw), and on valid input returns the new validated value.
// This mirrors the handler bodies in src/main/index.ts (registerSettingsIpc) without importing
// electron (which the bare-node runtime lacks). [Source: story 2.4 Task 3.4; AC-5/7;
//  .claude/rules/zod-boundaries.md IPC-arg row]
import { describe, it, expect } from 'vitest'
import { createSettingsStore, type SettingsStore } from './settings'
import { SettingsPatchSchema, DEFAULT_SETTINGS } from '../../shared/schemas/settings'

/** Re-create the EXACT handler logic the main process wires (sans the ipcMain plumbing). */
function makeHandlers(store: SettingsStore): {
  get: () => unknown
  set: (raw: unknown) => unknown
} {
  return {
    get: () => store.get(),
    // The untrusted-arg parse-and-throw boundary (identical to index.ts's ipcMain.handle body).
    set: (raw: unknown) => store.set(SettingsPatchSchema.parse(raw))
  }
}

describe('settings IPC handler logic — get/set round-trip + parse-and-throw (AC-5/7)', () => {
  it('settings:get returns the current settings value directly (no envelope)', () => {
    const store = createSettingsStore()
    const { get } = makeHandlers(store)
    expect(get()).toEqual(DEFAULT_SETTINGS)
  })

  it('settings:set with a VALID patch returns the new validated value and updates get', () => {
    const store = createSettingsStore()
    const { get, set } = makeHandlers(store)

    const result = set({ soundEnabled: false, terminalFontSize: 18 })
    expect(result).toEqual({
      version: 1,
      soundEnabled: false,
      terminalFontSize: 18
    })
    expect(get()).toEqual(result)
  })

  it('settings:set with a MALFORMED arg THROWS (untrusted cross-process input fails closed)', () => {
    const store = createSettingsStore()
    const { set } = makeHandlers(store)

    // Out-of-range font-size, non-boolean sound, junk object — each rejects at the boundary.
    expect(() => set({ terminalFontSize: 9999 })).toThrow()
    expect(() => set({ soundEnabled: 'on' })).toThrow()
    expect(() => set('not even an object')).toThrow()
    expect(() => set(null)).toThrow()
  })

  it('a rejected settings:set does NOT mutate the stored value', () => {
    const store = createSettingsStore()
    const { get, set } = makeHandlers(store)
    const before = get()
    expect(() => set({ terminalFontSize: -5 })).toThrow()
    expect(get()).toEqual(before)
  })
})
