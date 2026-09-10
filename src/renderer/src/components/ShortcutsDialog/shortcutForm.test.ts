import { describe, it, expect } from 'vitest'
import {
  emptyDraft,
  toDraft,
  draftToSaveRequest,
  isDraftDirty,
  shortcutErrorCode
} from './shortcutForm'

const SC = {
  id: 'sc-1',
  name: 'approve',
  keys: ['Ctrl+Alt+O', 'Ctrl+Alt+A'],
  text: 'I explicitly approve',
  workspaceId: null
}

// NOTE: the chordFromEvent / chordProblem tables that used to live here moved to
// src/renderer/src/shortcuts/chord.test.ts — chord parsing is now ONE shared function used by
// both the recorder and the terminal matcher, and there is no reserved-letter problem any more.

describe('emptyDraft / toDraft', () => {
  it('starts with an empty sequence and no id', () => {
    expect(emptyDraft().keys).toEqual([])
    expect(emptyDraft().id).toBeNull()
  })

  it('round-trips a shortcut', () => {
    expect(toDraft(SC)).toEqual({
      id: 'sc-1',
      name: SC.name,
      keys: SC.keys,
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

  it('copies the sequence rather than aliasing it', () => {
    const draft = toDraft(SC)
    expect(draft.keys).toEqual(['Ctrl+Alt+O', 'Ctrl+Alt+A'])
    expect(draft.keys).not.toBe(SC.keys)
  })
})

describe('draftToSaveRequest', () => {
  it('builds a create request when the draft has no id', () => {
    const r = draftToSaveRequest({
      id: null,
      name: 'approve',
      keys: ['Ctrl+Alt+A'],
      text: 'yes',
      workspaceId: null
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.req).toEqual({
        name: 'approve',
        keys: ['Ctrl+Alt+A'],
        text: 'yes',
        workspaceId: null
      })
    }
  })

  it('includes the id when updating', () => {
    const r = draftToSaveRequest({
      id: 'sc-1',
      name: 'approve',
      keys: ['Ctrl+Alt+A'],
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
      keys: ['Ctrl+Alt+A'],
      text: 'yes',
      workspaceId: 'w1'
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.req.workspaceId).toBe('w1')
  })

  it('accepts a 2-chord sequence', () => {
    const r = draftToSaveRequest({
      id: null,
      name: 'n',
      keys: ['Ctrl+Alt+O', 'Ctrl+Alt+A'],
      text: 't',
      workspaceId: null
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.req.keys).toEqual(['Ctrl+Alt+O', 'Ctrl+Alt+A'])
  })

  it('accepts a formerly reserved letter', () => {
    expect(
      draftToSaveRequest({
        id: null,
        name: 'n',
        keys: ['Ctrl+Alt+N'],
        text: 't',
        workspaceId: null
      }).ok
    ).toBe(true)
  })

  it.each([
    [
      'a blank name',
      { id: null, name: '  ', keys: ['Ctrl+Alt+A'], text: 'yes', workspaceId: null }
    ],
    ['a blank phrase', { id: null, name: 'x', keys: ['Ctrl+Alt+A'], text: '', workspaceId: null }],
    ['an empty sequence', { id: null, name: 'x', keys: [], text: 'yes', workspaceId: null }],
    [
      'four chords',
      {
        id: null,
        name: 'x',
        keys: ['Ctrl+Alt+A', 'Ctrl+Alt+B', 'Ctrl+Alt+C', 'Ctrl+Alt+D'],
        text: 'yes',
        workspaceId: null
      }
    ],
    [
      'the old Ctrl+Shift namespace',
      { id: null, name: 'x', keys: ['Ctrl+Shift+A'], text: 'yes', workspaceId: null }
    ],
    [
      'a malformed chord',
      { id: null, name: 'x', keys: ['Ctrl+A'], text: 'yes', workspaceId: null }
    ],
    [
      'a submitting phrase',
      { id: null, name: 'x', keys: ['Ctrl+Alt+A'], text: 'yes\r', workspaceId: null }
    ]
  ])('rejects %s', (_label, draft) => {
    expect(draftToSaveRequest(draft).ok).toBe(false)
  })
})

describe('isDraftDirty', () => {
  it('is false for an unchanged sequence (compared by VALUE, not reference)', () => {
    expect(isDraftDirty(toDraft(SC), SC)).toBe(false)
    expect(isDraftDirty(emptyDraft(), null)).toBe(false)
  })

  it('detects a changed phrase', () => {
    expect(isDraftDirty({ ...toDraft(SC), text: 'other' }, SC)).toBe(true)
  })

  it('is true when a chord is appended', () => {
    const draft = { ...toDraft(SC), keys: ['Ctrl+Alt+O', 'Ctrl+Alt+A', 'Ctrl+Alt+Z'] }
    expect(isDraftDirty(draft, SC)).toBe(true)
  })

  it('is true when the sequence ORDER changes', () => {
    const draft = { ...toDraft(SC), keys: ['Ctrl+Alt+A', 'Ctrl+Alt+O'] }
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
    expect(shortcutErrorCode(new Error('shortcut_keys_taken'))).toBe('shortcut_keys_taken')
    expect(shortcutErrorCode(new Error('shortcut_not_found'))).toBe('shortcut_not_found')
    expect(shortcutErrorCode(new Error('kaboom'))).toBe('unknown')
    expect(shortcutErrorCode('not an error')).toBe('unknown')
  })

  it('sees through the Electron IPC wrapper around the thrown message', () => {
    expect(
      shortcutErrorCode(
        new Error("Error invoking remote method 'shortcuts:save': Error: shortcut_keys_taken")
      )
    ).toBe('shortcut_keys_taken')
  })
})
