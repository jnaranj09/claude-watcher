import { describe, it, expect } from 'vitest'
import { createShortcutsIpcHandlers } from './shortcutsIpc'
import { createShortcutsStore } from './shortcuts'

const A = { name: 'approve', keys: 'Ctrl+Shift+A', text: 'I explicitly approve' }

function handlers(): ReturnType<typeof createShortcutsIpcHandlers> {
  let n = 0
  return createShortcutsIpcHandlers(createShortcutsStore({ newId: () => `sc-${++n}` }))
}

describe('shortcuts IPC handlers — parse-and-throw on untrusted args', () => {
  it('list starts empty', () => {
    expect(handlers().list()).toEqual([])
  })

  it('save parses then stores, returning saved + list', () => {
    const h = handlers()
    const result = h.save(A)
    expect(result.saved.id).toBe('sc-1')
    expect(h.list()).toHaveLength(1)
  })

  it.each([
    ['a non-object', 'nope'],
    ['a missing field', { name: 'x', keys: 'Ctrl+Shift+A' }],
    ['an illegal chord', { ...A, keys: 'Ctrl+A' }],
    ['a reserved chord', { ...A, keys: 'Ctrl+Shift+N' }],
    ['a submitting phrase', { ...A, text: 'yes\r' }]
  ])('save throws on %s and does not mutate', (_label, raw) => {
    const h = handlers()
    expect(() => h.save(raw)).toThrow()
    expect(h.list()).toEqual([])
  })

  it('remove parses its arg and returns the remaining list', () => {
    const h = handlers()
    h.save(A)
    expect(h.remove({ id: 'sc-1' })).toEqual([])
    expect(() => h.remove({ id: '' })).toThrow()
  })
})
