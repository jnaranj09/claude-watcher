// UX-06 / UX-07 — what every store does when its file cannot be written or read.
//
// A dialog's Save / Delete that the disk refused is UNDONE and throws `store_write_failed`, so the
// dialog never shows a row the next start will not have. Every other write (a cascade, a workspace
// switch, the history, settings) keeps the change for this run and reports `write_failed` to
// storage health. A damaged file reports `corrupt_reset`.
import { describe, expect, it, vi } from 'vitest'
import { STORE_WRITE_FAILED, type StorageProblemCode } from '../../shared/schemas/storageHealth'
import type { PersistedBlobStore } from './persistedBlob'
import { createTemplatesStore } from './templates'
import { createShortcutsStore } from './shortcuts'
import { createTagsStore } from './tags'
import { createWorkspacesStore } from './workspaces'
import { createRulesStore } from './rules'
import { createPastSessionsStore } from './pastSessions'
import { createSettingsStore } from './settings'

/** A blob whose writes succeed until `fail()` is called. */
function blob<T>(seed?: unknown): {
  store: PersistedBlobStore<T>
  fail: () => void
} {
  let failing = false
  let current: unknown = seed
  return {
    store: {
      read: () => current,
      write: (value: T) => {
        if (failing) throw new Error('ENOSPC')
        current = value
      },
      backup: () => {}
    },
    fail: () => {
      failing = true
    }
  }
}

function reporter(): { report: (code: StorageProblemCode) => void; codes: StorageProblemCode[] } {
  const codes: StorageProblemCode[] = []
  return { report: (code) => void codes.push(code), codes }
}

const log = (): void => {}
const TEMPLATE = {
  name: 'api',
  cwd: '/w/api',
  model: null,
  permissionMode: null,
  effort: null,
  workspaceId: 'w1',
  initialPrompt: null,
  params: []
}

describe('a dialog Save / Delete the disk refused is undone (UX-06)', () => {
  it('templates: an edit keeps the old row, a delete keeps the row', () => {
    const b = blob()
    const s = createTemplatesStore({ blobStore: b.store, log, newId: () => 't1' })
    s.save(TEMPLATE)
    b.fail()
    expect(() => s.save({ ...TEMPLATE, id: 't1', name: 'renamed' })).toThrow(STORE_WRITE_FAILED)
    expect(s.get('t1')?.name).toBe('api')
    expect(() => s.remove('t1')).toThrow(STORE_WRITE_FAILED)
    expect(s.get('t1')).not.toBeNull()
  })

  it('shortcuts: a delete keeps the row', () => {
    const b = blob()
    const s = createShortcutsStore({ blobStore: b.store, log, newId: () => 'sc1' })
    s.save({ name: 'go', alias: 'go', text: 'continue', workspaceId: null })
    b.fail()
    expect(() => s.remove('sc1')).toThrow(STORE_WRITE_FAILED)
    expect(s.get('sc1')).not.toBeNull()
  })

  it('tags: an edit keeps the old row, a delete keeps the row', () => {
    const b = blob()
    const s = createTagsStore({ blobStore: b.store, log, newId: () => 'tg1' })
    s.save({ name: 'prod', color: 'rose', workspaceId: null })
    b.fail()
    expect(() => s.save({ id: 'tg1', name: 'dev', color: 'rose', workspaceId: null })).toThrow(
      STORE_WRITE_FAILED
    )
    expect(s.get('tg1')?.name).toBe('prod')
    expect(() => s.remove('tg1')).toThrow(STORE_WRITE_FAILED)
    expect(s.get('tg1')).not.toBeNull()
  })

  it('rules: an edit, a delete and a move all keep the old list', () => {
    const b = blob()
    let n = 0
    const s = createRulesStore({ blobStore: b.store, log, newId: () => `r${++n}` })
    const req = {
      name: 'a',
      workspaceId: null,
      trigger: { kind: 'launched' as const },
      conditions: [],
      actions: []
    }
    s.save(req)
    s.save({ ...req, name: 'b' })
    b.fail()
    expect(() => s.save({ ...req, id: 'r1', name: 'renamed' })).toThrow(STORE_WRITE_FAILED)
    expect(() => s.remove('r1')).toThrow(STORE_WRITE_FAILED)
    expect(() => s.move('r2', 0)).toThrow(STORE_WRITE_FAILED)
    expect(s.list().map((r) => r.name)).toEqual(['a', 'b'])
  })

  it('workspaces: a refused delete keeps the workspace AND never cascades', () => {
    const b = blob()
    const cascade = vi.fn()
    const s = createWorkspacesStore({ blobStore: b.store, log, newId: () => 'w1', cascade })
    s.save({ name: 'Ops', color: 'blue', defaultCwd: null })
    s.setActive('w1')
    b.fail()
    expect(() => s.remove('w1')).toThrow(STORE_WRITE_FAILED)
    expect(s.get('w1')).not.toBeNull()
    expect(s.activeId()).toBe('w1')
    expect(cascade).not.toHaveBeenCalled()
  })

  it('past sessions: a refused Forget keeps the record', () => {
    const b = blob()
    const s = createPastSessionsStore({ blobStore: b.store, log })
    s.archive({
      id: 's1',
      name: 'n',
      cwd: '/w',
      workspaceId: 'default',
      tagIds: [],
      launchedAt: 1,
      endedAt: 2
    })
    b.fail()
    expect(() => s.remove('s1')).toThrow(STORE_WRITE_FAILED)
    expect(s.list()).toHaveLength(1)
  })
})

describe('every other write keeps the change and tells storage health (UX-06)', () => {
  it('a cascade reports write_failed and does not throw', () => {
    const b = blob()
    const r = reporter()
    const s = createTemplatesStore({ blobStore: b.store, log, report: r.report, newId: () => 't1' })
    s.save(TEMPLATE)
    b.fail()
    expect(s.removeByWorkspace('w1')).toBe(1)
    expect(r.codes).toEqual(['write_failed'])
  })

  it('a workspace switch holds for the run and reports write_failed', () => {
    const b = blob()
    const r = reporter()
    const s = createWorkspacesStore({
      blobStore: b.store,
      log,
      report: r.report,
      newId: () => 'w1'
    })
    s.save({ name: 'Ops', color: 'blue', defaultCwd: null })
    b.fail()
    s.setActive('w1')
    expect(s.activeId()).toBe('w1')
    expect(r.codes).toEqual(['write_failed'])
  })

  it('an archive reports write_failed and never throws (a removal path must not crash)', () => {
    const b = blob()
    const r = reporter()
    const s = createPastSessionsStore({ blobStore: b.store, log, report: r.report })
    b.fail()
    const record = {
      id: 's1',
      name: 'n',
      cwd: '/w',
      workspaceId: 'default',
      tagIds: [],
      launchedAt: 1,
      endedAt: 2
    }
    expect(() => s.archive(record)).not.toThrow()
    expect(() => s.markLive(record)).not.toThrow()
    expect(r.codes).toContain('write_failed')
  })

  it('settings: a patch holds for the run and reports write_failed', () => {
    const b = blob()
    const r = reporter()
    const s = createSettingsStore({ blobStore: b.store, log, report: r.report })
    b.fail()
    const next = s.set({ soundEnabled: false })
    expect(next.soundEnabled).toBe(false)
    expect(r.codes).toEqual(['write_failed'])
  })
})

describe('a file that cannot be read is reported (UX-07)', () => {
  it('a damaged file reports corrupt_reset', () => {
    const r = reporter()
    createTagsStore({ blobStore: blob({ version: 1, tags: 'nope' }).store, log, report: r.report })
    expect(r.codes).toEqual(['corrupt_reset'])
  })

  it('an unreadable file reports read_failed', () => {
    const r = reporter()
    const store: PersistedBlobStore<never> = {
      read: () => {
        throw new Error('EACCES')
      },
      write: () => {},
      backup: () => {}
    }
    createShortcutsStore({ blobStore: store, log, report: r.report })
    expect(r.codes).toEqual(['read_failed'])
  })

  it('a damaged settings file reports corrupt_reset', () => {
    const r = reporter()
    createSettingsStore({ blobStore: blob({ version: 'x' }).store, log, report: r.report })
    expect(r.codes).toEqual(['corrupt_reset'])
  })
})
