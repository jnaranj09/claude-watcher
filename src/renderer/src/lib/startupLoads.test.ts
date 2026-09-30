// Action feedback (spec 2026-09-29 §2.6) — the six startup loads push ONE error toast naming every
// store that failed (six sticky toasts would pass the cap of 3), and nothing when all load.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runStartupLoads, startupLoadFailedCopy } from './startupLoads'
import { toastStore } from '../stores/toastStore'
import { loadTemplates, selectTemplatesLoadFailed, templatesStore } from '../stores/templatesStore'
import { loadShortcuts, selectShortcutsLoadFailed, shortcutsStore } from '../stores/shortcutsStore'
import {
  loadWorkspaces,
  selectWorkspacesLoadFailed,
  workspacesStore
} from '../stores/workspacesStore'
import { loadTags, selectTagsLoadFailed, tagsStore } from '../stores/tagsStore'
import { loadRules, selectRulesLoadFailed, rulesStore } from '../stores/rulesStore'
import { loadSettings } from '../stores/settingsStore'
import { deferred } from '../test/deferred'
import { DEFAULT_SETTINGS } from '../../../shared/schemas/settings'

function stubAll(fail: readonly string[]): void {
  const answer =
    <T>(name: string, value: T) =>
    (): Promise<T> =>
      fail.includes(name) ? Promise.reject(new Error('x')) : Promise.resolve(value)
  const w = window as unknown as Record<string, unknown>
  w['settings'] = { get: answer('settings', DEFAULT_SETTINGS) }
  w['templates'] = { list: answer('templates', []) }
  w['shortcuts'] = { list: answer('shortcuts', []) }
  w['workspaces'] = { list: answer('workspaces', { activeId: 'default', workspaces: [] }) }
  w['tags'] = { list: answer('tags', []) }
  w['rules'] = { list: answer('rules', { rules: [], brokenIds: [] }) }
}

beforeEach(() => {
  toastStore.setState({ toasts: [] })
  templatesStore.setState({ templates: [], loaded: false, loadFailed: false })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

const toasts = (): string[][] => toastStore.getState().toasts.map((t) => [t.kind, t.title])

describe('startupLoadFailedCopy', () => {
  it('names one, two, or many stores in plain English', () => {
    expect(startupLoadFailedCopy(['templates'])).toBe(
      'Could not load templates. Reopen the app to try again.'
    )
    expect(startupLoadFailedCopy(['tags', 'rules'])).toBe(
      'Could not load tags and rules. Reopen the app to try again.'
    )
    expect(startupLoadFailedCopy(['templates', 'tags', 'rules'])).toBe(
      'Could not load templates, tags and rules. Reopen the app to try again.'
    )
  })
})

describe('runStartupLoads', () => {
  it('pushes ONE error toast naming every failed store', async () => {
    stubAll(['templates', 'tags', 'rules'])
    await runStartupLoads()
    expect(toasts()).toEqual([
      ['error', 'Could not load templates, tags and rules. Reopen the app to try again.']
    ])
    expect(templatesStore.getState().loadFailed).toBe(true)
  })

  it('names settings too, and all six in one toast when everything fails', async () => {
    stubAll(['settings', 'templates', 'shortcuts', 'workspaces', 'tags', 'rules'])
    await runStartupLoads()
    expect(toasts()).toEqual([
      [
        'error',
        'Could not load settings, templates, shortcuts, workspaces, tags and rules. Reopen the app to try again.'
      ]
    ])
  })

  it('pushes nothing when everything loads', async () => {
    stubAll([])
    await runStartupLoads()
    expect(toasts()).toEqual([])
    expect(templatesStore.getState().loadFailed).toBe(false)
  })

  it('waits for every load, and names the stores in load order, not settle order', async () => {
    stubAll(['tags'])
    const held = deferred<unknown[]>()
    ;(window as unknown as Record<string, unknown>)['templates'] = { list: () => held.promise }
    const run = runStartupLoads()
    for (let i = 0; i < 6; i++) await Promise.resolve()
    expect(toasts()).toEqual([])
    held.reject(new Error('x'))
    await run
    expect(toasts()).toEqual([
      ['error', 'Could not load templates and tags. Reopen the app to try again.']
    ])
  })
})

// Each catalog store remembers a failed load; the selector is true only while nothing has loaded,
// and any later hydrate clears the flag itself (not just the selector).
const catalog = [
  {
    name: 'templates',
    load: loadTemplates,
    select: () => selectTemplatesLoadFailed(templatesStore.getState()),
    flag: () => templatesStore.getState().loadFailed,
    reset: () => templatesStore.setState({ templates: [], loaded: false, loadFailed: false }),
    loadedButFlagged: () => templatesStore.setState({ loaded: true, loadFailed: true }),
    hydrate: () => templatesStore.getState().hydrate([])
  },
  {
    name: 'shortcuts',
    load: loadShortcuts,
    select: () => selectShortcutsLoadFailed(shortcutsStore.getState()),
    flag: () => shortcutsStore.getState().loadFailed,
    reset: () => shortcutsStore.setState({ shortcuts: [], loaded: false, loadFailed: false }),
    loadedButFlagged: () => shortcutsStore.setState({ loaded: true, loadFailed: true }),
    hydrate: () => shortcutsStore.getState().hydrate([])
  },
  {
    name: 'workspaces',
    load: loadWorkspaces,
    select: () => selectWorkspacesLoadFailed(workspacesStore.getState()),
    flag: () => workspacesStore.getState().loadFailed,
    reset: () => workspacesStore.setState({ workspaces: [], loaded: false, loadFailed: false }),
    loadedButFlagged: () => workspacesStore.setState({ loaded: true, loadFailed: true }),
    hydrate: () => workspacesStore.getState().hydrate({ activeId: 'default', workspaces: [] })
  },
  {
    name: 'tags',
    load: loadTags,
    select: () => selectTagsLoadFailed(tagsStore.getState()),
    flag: () => tagsStore.getState().loadFailed,
    reset: () => tagsStore.setState({ tags: [], loaded: false, loadFailed: false }),
    loadedButFlagged: () => tagsStore.setState({ loaded: true, loadFailed: true }),
    hydrate: () => tagsStore.getState().hydrate([])
  },
  {
    name: 'rules',
    load: loadRules,
    select: () => selectRulesLoadFailed(rulesStore.getState()),
    flag: () => rulesStore.getState().loadFailed,
    reset: () =>
      rulesStore.setState({ rules: [], brokenIds: [], loaded: false, loadFailed: false }),
    loadedButFlagged: () => rulesStore.setState({ loaded: true, loadFailed: true }),
    hydrate: () => rulesStore.getState().hydrate({ rules: [], brokenIds: [] })
  }
] as const

describe.each(catalog)('the $name store remembers a failed load', (c) => {
  beforeEach(() => c.reset())

  it('a failed load resolves false, logs, and sets the flag', async () => {
    stubAll([c.name])
    await expect(c.load()).resolves.toBe(false)
    expect(c.flag()).toBe(true)
    expect(c.select()).toBe(true)
    expect(console.warn).toHaveBeenCalledWith(
      `[claude-watcher][${c.name}] code=${c.name}_load_failed`
    )
  })

  it('a good load resolves true and leaves the flag clear', async () => {
    stubAll([])
    await expect(c.load()).resolves.toBe(true)
    expect(c.flag()).toBe(false)
  })

  it('a later hydrate clears the flag', async () => {
    stubAll([c.name])
    await c.load()
    c.hydrate()
    expect(c.flag()).toBe(false)
  })

  it('the selector is false once something loaded, even with the flag still set', () => {
    c.loadedButFlagged()
    expect(c.select()).toBe(false)
  })
})

describe('loadSettings', () => {
  it('resolves false on a failed load and true on a good one (never rejects)', async () => {
    stubAll(['settings'])
    await expect(loadSettings()).resolves.toBe(false)
    stubAll([])
    await expect(loadSettings()).resolves.toBe(true)
  })
})
