import { describe, expect, it } from 'vitest'
import type { StorageHealth } from '../shared/schemas/storageHealth'
import { createStorageHealth } from './storageHealth'
import { storageCodeForLoad } from './persistence/persistedBlob'

describe('createStorageHealth (UX-06, UX-07)', () => {
  it('records each (store, code) once and pushes each new one', () => {
    const pushes: StorageHealth[] = []
    const h = createStorageHealth({ onChange: (s) => void pushes.push(s) })
    const templates = h.reporterFor('templates')
    templates('write_failed')
    templates('write_failed') // a full disk fails every write: one line, not one per write
    h.report('settings', 'corrupt_reset')
    expect(h.get().problems).toEqual([
      { store: 'templates', code: 'write_failed' },
      { store: 'settings', code: 'corrupt_reset' }
    ])
    expect(pushes).toHaveLength(2)
  })

  it('starts with no problems and pushes nothing', () => {
    const pushes: StorageHealth[] = []
    const h = createStorageHealth({ onChange: (s) => void pushes.push(s) })
    expect(h.get()).toEqual({ problems: [] })
    expect(pushes).toEqual([])
  })

  it('maps the load problems into the channel codes', () => {
    expect(storageCodeForLoad('corrupt_reset_to_defaults')).toBe('corrupt_reset')
    expect(storageCodeForLoad('read_failed')).toBe('read_failed')
    expect(storageCodeForLoad('backup_failed')).toBe('backup_failed')
  })
})
