import { describe, it, expect } from 'vitest'
import { createTemplatesStore } from './templates'
import { createTemplatesIpcHandlers } from './templatesIpc'

const ROW = { name: 'blog', cwd: '/home/op/blog', model: null, permissionMode: null, effort: null }

describe('templates IPC handler logic — parse-and-throw on the arg (untrusted cross-process input)', () => {
  it('list returns the store list directly (no envelope)', () => {
    const store = createTemplatesStore({ newId: () => 'id-1' })
    const h = createTemplatesIpcHandlers(store)
    expect(h.list()).toEqual([])
    h.save(ROW)
    expect(h.list()).toEqual([{ id: 'id-1', ...ROW }])
  })
  it('save returns { saved, templates } and trims the name at the boundary', () => {
    const h = createTemplatesIpcHandlers(createTemplatesStore({ newId: () => 'id-1' }))
    expect(h.save({ ...ROW, name: '  blog ' })).toEqual({
      saved: { id: 'id-1', ...ROW },
      templates: [{ id: 'id-1', ...ROW }]
    })
  })
  it('save with a MALFORMED arg throws and does NOT mutate', () => {
    const h = createTemplatesIpcHandlers(createTemplatesStore())
    expect(() => h.save({ ...ROW, permissionMode: 'yolo' })).toThrow()
    // `ultracode` is a real claude alias but deliberately NOT in EFFORT_LEVELS (design §3):
    // an enum-locked CLI arg we generate fails closed at the seam.
    expect(() => h.save({ ...ROW, effort: 'ultracode' })).toThrow()
    // An unknown key is NOT a throw case: TemplateSaveSchema (Task 1) has no `.strict()`,
    // matching the codebase-wide convention (settings.ts's SettingsSchema doc comment;
    // template.test.ts's "strips an unknown key" case) — unknown keys are silently
    // STRIPPED, not failed closed. So `{ ...ROW, extra: 1 }` is NOT asserted here.
    expect(() => h.save('nope')).toThrow()
    expect(() => h.save(null)).toThrow()
    expect(h.list()).toEqual([])
  })
  it('remove parses { id } and returns the remaining list; a malformed arg throws', () => {
    const h = createTemplatesIpcHandlers(createTemplatesStore({ newId: () => 'id-1' }))
    h.save(ROW)
    expect(h.remove({ id: 'id-1' })).toEqual([])
    expect(() => h.remove({ id: '' })).toThrow()
    expect(() => h.remove('id-1')).toThrow()
  })
})
