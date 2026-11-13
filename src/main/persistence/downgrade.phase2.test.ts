// Going back to the phase-2 build: the settings file memory phase 3 writes must still parse with the
// schema that build reads it with. `SettingsSchema` is a plain `z.object` (not `.strict()`), so
// phase 2 keeps every other value and drops the one key it does not know at its next write.
// Phase 3 persists no other new state (the plan's "A rollback").
import { describe, expect, it } from 'vitest'
import { createSettingsStore } from './settings'
import { SettingsSchema, type SettingsPatch } from '../../shared/schemas/settings'

function blob(): {
  blobStore: { read: () => unknown; write: (value: unknown) => void; backup: () => void }
  current: () => unknown
} {
  let value: unknown
  return {
    blobStore: {
      read: () => value,
      write: (next: unknown) => {
        value = next
      },
      backup: () => undefined
    },
    current: () => value
  }
}

// The phase-2 settings schema: memory phase 3 only ADDS `memoryRecallEnabled` to `SettingsSchema`,
// so the current schema without it is that schema, field for field.
const Phase2SettingsSchema = SettingsSchema.omit({ memoryRecallEnabled: true })
type Phase2Settings = ReturnType<typeof Phase2SettingsSchema.parse>

// What the phase-2 settings store does with a file, on its schema (today's store has no schema
// seam): read it once through the schema, and on a set write the merged, parsed value back.
function phase2Store(file: ReturnType<typeof blob>): {
  get: () => Phase2Settings
  set: (patch: Omit<SettingsPatch, 'memoryRecallEnabled'>) => void
} {
  let current = Phase2SettingsSchema.parse(file.blobStore.read())
  return {
    get: () => current,
    set: (patch) => {
      current = Phase2SettingsSchema.parse({ ...current, ...patch })
      file.blobStore.write(current)
    }
  }
}

describe('going back to the phase-2 build', () => {
  it('the phase 2 build reads a settings file phase 3 wrote, keeps every other value and drops memoryRecallEnabled at its next write', () => {
    const file = blob()
    const today = createSettingsStore({ blobStore: file.blobStore, log: () => undefined })
    today.set({ memoryRecallEnabled: false, soundEnabled: false })
    expect(file.current()).toMatchObject({ memoryRecallEnabled: false, soundEnabled: false })

    const phase2 = phase2Store(file)
    expect(phase2.get().soundEnabled).toBe(false)
    phase2.set({ terminalFontSize: 15 })
    expect(Object.keys(file.current() ?? {})).not.toContain('memoryRecallEnabled')
    expect(file.current()).toMatchObject({ soundEnabled: false, terminalFontSize: 15 })
  })
})
