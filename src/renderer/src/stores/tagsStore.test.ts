import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createTagsViewStore,
  effectiveTagFilter,
  loadTags,
  removeTag,
  resetTagFilterIfHidden,
  saveTag,
  setSessionTags,
  setTagFilter,
  tagsForIds,
  tagsStore
} from './tagsStore'
import type { Tag } from '../../../shared/ipc/contract'

const GLOBAL: Tag = { id: 'g', name: 'deploy', color: 'amber', workspaceId: null }
const IN_A: Tag = { id: 'a', name: 'prod', color: 'rose', workspaceId: 'wa' }

interface Bridge {
  list: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}
function stubBridge(overrides: Partial<Bridge> = {}): Bridge {
  const bridge: Bridge = {
    list: vi.fn(() => Promise.resolve([GLOBAL, IN_A])),
    save: vi.fn(() => Promise.resolve({ saved: GLOBAL, tags: [GLOBAL] })),
    remove: vi.fn(() => Promise.resolve([IN_A])),
    ...overrides
  }
  ;(window as unknown as { tags: Bridge }).tags = bridge
  return bridge
}

afterEach(() => {
  delete (window as unknown as { launch?: unknown }).launch
  tagsStore.setState({ tags: [], loaded: false, activeTagId: null })
  vi.restoreAllMocks()
})

describe('tagsStore — projection', () => {
  it('starts empty and unfiltered; hydrate REPLACES the list and marks it loaded', () => {
    const s = createTagsViewStore()
    expect(s.getState()).toMatchObject({ tags: [], loaded: false, activeTagId: null })
    s.getState().hydrate([GLOBAL])
    s.getState().hydrate([IN_A])
    expect(s.getState().tags).toEqual([IN_A])
    expect(s.getState().loaded).toBe(true)
  })

  it('hydrate drops a filter whose tag is gone (a control never sits on a value it does not offer)', () => {
    const s = createTagsViewStore()
    s.getState().hydrate([GLOBAL, IN_A])
    s.getState().setActiveTag('a')
    s.getState().hydrate([GLOBAL])
    expect(s.getState().activeTagId).toBeNull()
  })

  it('tagsForIds returns catalog rows in TAG-LIST order, skipping unknown ids', () => {
    expect(tagsForIds([GLOBAL, IN_A], ['a', 'ghost', 'g']).map((t) => t.id)).toEqual(['g', 'a'])
    expect(tagsForIds([GLOBAL, IN_A], [])).toEqual([])
  })
})

describe('tagsStore — the filter (spec §4.1)', () => {
  it('effectiveTagFilter is the chosen tag only where that workspace can see it', () => {
    const s = createTagsViewStore()
    s.getState().hydrate([GLOBAL, IN_A])
    s.getState().setActiveTag('a')
    expect(effectiveTagFilter(s.getState(), 'wa')).toBe('a')
    expect(effectiveTagFilter(s.getState(), 'wb')).toBeNull()
    s.getState().setActiveTag(null)
    expect(effectiveTagFilter(s.getState(), 'wa')).toBeNull()
  })

  it('resetTagFilterIfHidden clears a filter the new workspace cannot see, and keeps a visible one', () => {
    tagsStore.getState().hydrate([GLOBAL, IN_A])
    setTagFilter('g')
    resetTagFilterIfHidden('wb')
    expect(tagsStore.getState().activeTagId).toBe('g')
    setTagFilter('a')
    resetTagFilterIfHidden('wb')
    expect(tagsStore.getState().activeTagId).toBeNull()
  })
})

describe('tagsStore — IPC', () => {
  it('loadTags hydrates from the bridge; a failure logs a code and keeps the projection', async () => {
    stubBridge()
    await loadTags()
    expect(tagsStore.getState().tags).toEqual([GLOBAL, IN_A])

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubBridge({ list: vi.fn(() => Promise.reject(new Error('boom'))) })
    await loadTags()
    expect(tagsStore.getState().tags).toEqual([GLOBAL, IN_A])
    expect(warn).toHaveBeenCalledWith('[claude-watcher][tags] code=tags_load_failed')
  })

  it('saveTag hydrates from the result and returns the saved row; a rejection rethrows', async () => {
    stubBridge()
    await expect(saveTag({ name: 'deploy', color: 'amber', workspaceId: null })).resolves.toEqual(
      GLOBAL
    )
    expect(tagsStore.getState().tags).toEqual([GLOBAL])
    stubBridge({ save: vi.fn(() => Promise.reject(new Error('tag_name_taken'))) })
    await expect(saveTag({ name: 'deploy', color: 'amber', workspaceId: null })).rejects.toThrow(
      'tag_name_taken'
    )
  })

  it('removeTag hydrates from the result; a rejection rethrows (tag_in_use is operator-facing)', async () => {
    stubBridge()
    await removeTag('g')
    expect(tagsStore.getState().tags).toEqual([IN_A])
    stubBridge({ remove: vi.fn(() => Promise.reject(new Error('tag_in_use'))) })
    await expect(removeTag('a')).rejects.toThrow('tag_in_use')
  })

  it('setSessionTags calls window.launch.setTags and logs a code on a rejection', async () => {
    tagsStore.setState({ tags: [GLOBAL, IN_A], pendingBySession: new Map() })
    const setTags = vi.fn(() => Promise.resolve())
    ;(window as unknown as { launch: { setTags: unknown } }).launch = { setTags }
    await setSessionTags('s1', ['g'], () => [])
    expect(setTags).toHaveBeenCalledWith('s1', ['g'])

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setTags.mockReturnValueOnce(Promise.reject(new Error('tag_out_of_scope')))
    await setSessionTags('s1', ['a'], () => [])
    expect(warn).toHaveBeenCalledWith('[claude-watcher][tags] code=set_tags_failed')
  })
})
