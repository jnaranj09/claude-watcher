import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createTemplatesStore,
  templatesStore,
  selectTemplates,
  selectTemplatesLoaded,
  makeSelectVisibleTemplates,
  loadTemplates,
  saveTemplate,
  removeTemplate
} from './templatesStore'
import type { Template } from '../../../shared/ipc/contract'

const T1: Template = {
  id: 'a',
  name: 'api',
  cwd: '/api',
  model: 'opus',
  permissionMode: null,
  effort: null,
  workspaceId: null,
  initialPrompt: null,
  params: [],
  favorite: false
}
const T2: Template = {
  id: 'b',
  name: 'blog',
  cwd: '/blog',
  model: null,
  permissionMode: 'plan',
  effort: null,
  workspaceId: null,
  initialPrompt: null,
  params: [],
  favorite: false
}

interface Bridge {
  list: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}
function stubBridge(overrides: Partial<Bridge> = {}): Bridge {
  const bridge: Bridge = {
    list: vi.fn(() => Promise.resolve([T1, T2])),
    save: vi.fn(() => Promise.resolve({ saved: T1, templates: [T1] })),
    remove: vi.fn(() => Promise.resolve([T2])),
    ...overrides
  }
  ;(window as unknown as { templates: Bridge }).templates = bridge
  return bridge
}
afterEach(() => {
  templatesStore.getState().hydrate([])
  templatesStore.setState({ loaded: false })
  vi.restoreAllMocks()
})

describe('templatesStore — projection', () => {
  it('starts empty and not loaded; hydrate REPLACES the list and marks loaded', () => {
    const s = createTemplatesStore()
    expect(selectTemplates(s.getState())).toEqual([])
    expect(selectTemplatesLoaded(s.getState())).toBe(false)
    s.getState().hydrate([T1])
    s.getState().hydrate([T2])
    expect(selectTemplates(s.getState())).toEqual([T2])
    expect(selectTemplatesLoaded(s.getState())).toBe(true)
  })
})

describe('makeSelectVisibleTemplates', () => {
  const GLOBAL: Template = { ...T1, id: 'g', workspaceId: null }
  const OWN: Template = { ...T1, id: 'own', workspaceId: 'w1' }
  const OTHER: Template = { ...T1, id: 'other', workspaceId: 'w2' }
  const ORPHAN: Template = { ...T1, id: 'orphan', workspaceId: 'gone' }

  it('keeps global rows and the active workspace’s own rows; drops every other scope', () => {
    const s = createTemplatesStore()
    s.getState().hydrate([GLOBAL, OWN, OTHER, ORPHAN])
    const visible = makeSelectVisibleTemplates('w1')(s.getState())
    expect(visible.map((t) => t.id)).toEqual(['g', 'own'])
  })

  it('a row scoped to a workspace that no longer exists is visible in NO workspace', () => {
    const s = createTemplatesStore()
    s.getState().hydrate([ORPHAN])
    expect(makeSelectVisibleTemplates('w1')(s.getState())).toEqual([])
    expect(makeSelectVisibleTemplates('w9')(s.getState())).toEqual([])
  })
})

describe('templatesStore — bridge helpers', () => {
  it('loadTemplates hydrates from window.templates.list', async () => {
    stubBridge()
    await loadTemplates()
    expect(selectTemplates(templatesStore.getState())).toEqual([T1, T2])
  })
  it('loadTemplates failure logs a code and leaves the store untouched', async () => {
    stubBridge({ list: vi.fn(() => Promise.reject(new Error('ipc'))) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loadTemplates()
    expect(selectTemplates(templatesStore.getState())).toEqual([])
    expect(warn).toHaveBeenCalledWith('[claude-watcher][templates] code=templates_load_failed')
  })
  it('saveTemplate hydrates with the returned list and resolves the saved row', async () => {
    const bridge = stubBridge()
    const saved = await saveTemplate({
      name: 'api',
      cwd: '/api',
      model: 'opus',
      permissionMode: null,
      effort: null,
      workspaceId: null,
      initialPrompt: null,
      params: []
    })
    expect(bridge.save).toHaveBeenCalledWith({
      name: 'api',
      cwd: '/api',
      model: 'opus',
      permissionMode: null,
      effort: null,
      workspaceId: null,
      initialPrompt: null,
      params: []
    })
    expect(saved).toEqual(T1)
    expect(selectTemplates(templatesStore.getState())).toEqual([T1])
  })
  it('saveTemplate RETHROWS so the form can show the reason', async () => {
    stubBridge({ save: vi.fn(() => Promise.reject(new Error('template_name_taken'))) })
    await expect(
      saveTemplate({
        name: 'x',
        cwd: '/x',
        model: null,
        permissionMode: null,
        effort: null,
        workspaceId: null,
        initialPrompt: null,
        params: []
      })
    ).rejects.toThrow('template_name_taken')
  })
  it('removeTemplate hydrates with the returned list; a failure RETHROWS (template_in_use is operator-facing)', async () => {
    const bridge = stubBridge()
    await removeTemplate('a')
    expect(bridge.remove).toHaveBeenCalledWith('a')
    expect(selectTemplates(templatesStore.getState())).toEqual([T2])
    stubBridge({ remove: vi.fn(() => Promise.reject(new Error('template_in_use'))) })
    await expect(removeTemplate('b')).rejects.toThrow('template_in_use')
  })
})
