import { describe, it, expect } from 'vitest'
import {
  emptyDraft,
  toDraft,
  draftToSaveRequest,
  isDraftDirty,
  shortcutErrorCode,
  SHORTCUT_ERROR_COPY
} from './shortcutForm'

const SC = {
  id: 'sc-1',
  name: 'approve',
  alias: 'oa',
  text: 'I explicitly approve',
  workspaceId: null,
  favorite: false
}

// NOTE: the chordFromEvent / chordProblem tables that used to live here moved to
// src/renderer/src/shortcuts/chord.test.ts — chord parsing is now ONE shared function used by
// both the recorder and the terminal matcher, and there is no reserved-letter problem any more.

describe('emptyDraft / toDraft', () => {
  it('starts with an empty alias and no id', () => {
    expect(emptyDraft().alias).toBe('')
    expect(emptyDraft().id).toBeNull()
  })

  it('round-trips a shortcut', () => {
    expect(toDraft(SC)).toEqual({
      id: 'sc-1',
      name: SC.name,
      alias: SC.alias,
      text: SC.text,
      workspaceId: null
    })
  })

  // Fix round 1, Finding 1 — the clobber this guards against: main's save() has no
  // partial-update path, so an edit that does not carry the existing scope resets it to
  // GLOBAL. toDraft must carry a NON-null scope through unchanged (a null-only assertion
  // would pass even if toDraft hardcoded null).
  it('carries a SCOPED shortcut workspaceId through unchanged', () => {
    expect(toDraft({ ...SC, workspaceId: 'w1' }).workspaceId).toBe('w1')
  })

  it('copies the alias', () => {
    const draft = toDraft(SC)
    expect(draft.alias).toBe('oa')
  })
})

describe('draftToSaveRequest', () => {
  it('builds a create request when the draft has no id', () => {
    const r = draftToSaveRequest({
      id: null,
      name: 'approve',
      alias: 'ap',
      text: 'yes',
      workspaceId: null
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.req).toEqual({
        name: 'approve',
        alias: 'ap',
        text: 'yes',
        workspaceId: null
      })
    }
  })

  it('includes the id when updating', () => {
    const r = draftToSaveRequest({
      id: 'sc-1',
      name: 'approve',
      alias: 'ap',
      text: 'yes',
      workspaceId: null
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.req.id).toBe('sc-1')
  })

  // Fix round 1, Finding 1 — THE test that pins the fix: editing a SCOPED shortcut must
  // preserve its scope, not reset it to GLOBAL. Hardcoding `workspaceId: null` in
  // draftToSaveRequest's candidate (the reverted defect) would turn this red.
  it('editing a SCOPED shortcut preserves the scope (does not clobber it to GLOBAL)', () => {
    const r = draftToSaveRequest({
      id: 'sc-1',
      name: 'approve',
      alias: 'ap',
      text: 'yes',
      workspaceId: 'w1'
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.req.workspaceId).toBe('w1')
  })

  it('lowercases the alias on the way out', () => {
    const r = draftToSaveRequest({
      id: null,
      name: 'x',
      alias: 'HT',
      text: 'y',
      workspaceId: null
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.req.alias).toBe('ht')
  })

  it.each([
    ['a blank name', { id: null, name: '  ', alias: 'ap', text: 'yes', workspaceId: null }],
    ['a blank phrase', { id: null, name: 'x', alias: 'ap', text: '', workspaceId: null }],
    ['a blank alias', { id: null, name: 'x', alias: '', text: 'yes', workspaceId: null }],
    [
      'an alias with a space',
      { id: null, name: 'x', alias: 'a b', text: 'yes', workspaceId: null }
    ],
    ['a placeholder gap', { id: null, name: 'x', alias: 'ap', text: 'do $2', workspaceId: null }],
    ['a submitting phrase', { id: null, name: 'x', alias: 'ap', text: 'yes\r', workspaceId: null }]
  ])('rejects %s', (_label, draft) => {
    expect(draftToSaveRequest(draft).ok).toBe(false)
  })
})

describe('isDraftDirty', () => {
  it('is false for an unchanged alias (compared by VALUE, not reference)', () => {
    expect(isDraftDirty(toDraft(SC), SC)).toBe(false)
    expect(isDraftDirty(emptyDraft(), null)).toBe(false)
  })

  it('detects a changed phrase', () => {
    expect(isDraftDirty({ ...toDraft(SC), text: 'other' }, SC)).toBe(true)
  })

  it('is true when the alias changes', () => {
    const draft = { ...toDraft(SC), alias: 'different' }
    expect(isDraftDirty(draft, SC)).toBe(true)
  })

  // `toDraft` round-trips workspaceId UNCHANGED, so an already-scoped shortcut that nobody
  // edited must still read clean. (The companion test below covers the other direction — an
  // actual scope CHANGE does make the draft dirty.)
  it('an unchanged SCOPED shortcut draft stays clean', () => {
    const scoped = { ...SC, workspaceId: 'w1' }
    expect(isDraftDirty(toDraft(scoped), scoped)).toBe(false)
  })
  // Task 11 — the scope select IS a real control now, so isDraftDirty must compare workspaceId.
  // Reverting that comparison (the pre-Task-11 state) must turn this red.
  it('changing only the scope (workspaceId) makes the draft dirty', () => {
    expect(isDraftDirty(toDraft(SC), SC)).toBe(false)
    expect(isDraftDirty({ ...toDraft(SC), workspaceId: 'w1' }, SC)).toBe(true)
  })
})

describe('shortcutErrorCode', () => {
  it('maps the known store errors and falls back for anything else', () => {
    expect(shortcutErrorCode(new Error('shortcut_alias_taken'))).toBe('shortcut_alias_taken')
    expect(shortcutErrorCode(new Error('shortcut_not_found'))).toBe('shortcut_not_found')
    expect(shortcutErrorCode(new Error('kaboom'))).toBe('unknown')
    expect(shortcutErrorCode('not an error')).toBe('unknown')
  })

  it('sees through the Electron IPC wrapper around the thrown message', () => {
    expect(
      shortcutErrorCode(
        new Error("Error invoking remote method 'shortcuts:save': Error: shortcut_alias_taken")
      )
    ).toBe('shortcut_alias_taken')
  })

  it('has copy for the taken alias error', () => {
    expect(SHORTCUT_ERROR_COPY.shortcut_alias_taken).toBe(
      'That alias is already used by another shortcut.'
    )
  })
})
