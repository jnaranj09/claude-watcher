import { describe, it, expect } from 'vitest'
import {
  emptyDraft,
  toDraft,
  chordFromEvent,
  chordProblem,
  draftToSaveRequest,
  isDraftDirty,
  shortcutErrorCode
} from './shortcutForm'

const SC = { id: 'sc-1', name: 'approve', keys: 'Ctrl+Shift+A', text: 'I explicitly approve' }

function ev(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    ...init
  } as unknown as KeyboardEvent
}

describe('chordFromEvent', () => {
  it('canonicalizes a Ctrl+Shift letter regardless of reported case', () => {
    expect(chordFromEvent(ev({ key: 'A', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+A')
    expect(chordFromEvent(ev({ key: 'a', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+A')
  })

  it.each([
    ['no modifiers', { key: 'A' }],
    ['ctrl only', { key: 'A', ctrlKey: true }],
    ['shift only', { key: 'A', shiftKey: true }],
    ['with alt', { key: 'A', ctrlKey: true, shiftKey: true, altKey: true }],
    ['with meta', { key: 'A', ctrlKey: true, shiftKey: true, metaKey: true }],
    ['a digit', { key: '!', ctrlKey: true, shiftKey: true }],
    ['a named key', { key: 'Enter', ctrlKey: true, shiftKey: true }],
    ['a lone modifier', { key: 'Shift', ctrlKey: true, shiftKey: true }],
    ['a composing key', { key: 'A', ctrlKey: true, shiftKey: true, isComposing: true }]
  ])('returns null for %s', (_label, init) => {
    expect(chordFromEvent(ev(init as Partial<KeyboardEvent> & { key: string }))).toBeNull()
  })
})

describe('chordProblem', () => {
  it('accepts a legal chord', () => {
    expect(chordProblem('Ctrl+Shift+A')).toBeNull()
  })
  it('flags a reserved letter by name', () => {
    expect(chordProblem('Ctrl+Shift+N')).toBe('reserved')
  })
  it('flags a malformed chord', () => {
    expect(chordProblem('Ctrl+A')).toBe('shape')
    expect(chordProblem('')).toBe('shape')
  })
})

describe('draftToSaveRequest', () => {
  it('builds a create request when the draft has no id', () => {
    const r = draftToSaveRequest({ id: null, name: 'approve', keys: 'Ctrl+Shift+A', text: 'yes' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.req).toEqual({ name: 'approve', keys: 'Ctrl+Shift+A', text: 'yes' })
  })

  it('includes the id when updating', () => {
    const r = draftToSaveRequest({ id: 'sc-1', name: 'approve', keys: 'Ctrl+Shift+A', text: 'yes' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.req.id).toBe('sc-1')
  })

  it.each([
    ['a blank name', { id: null, name: '  ', keys: 'Ctrl+Shift+A', text: 'yes' }],
    ['a blank phrase', { id: null, name: 'x', keys: 'Ctrl+Shift+A', text: '' }],
    ['a reserved chord', { id: null, name: 'x', keys: 'Ctrl+Shift+N', text: 'yes' }],
    ['a malformed chord', { id: null, name: 'x', keys: 'Ctrl+A', text: 'yes' }],
    ['a submitting phrase', { id: null, name: 'x', keys: 'Ctrl+Shift+A', text: 'yes\r' }]
  ])('rejects %s', (_label, draft) => {
    expect(draftToSaveRequest(draft).ok).toBe(false)
  })
})

describe('toDraft / emptyDraft / isDraftDirty', () => {
  it('round-trips a shortcut', () => {
    expect(toDraft(SC)).toEqual({ id: 'sc-1', name: SC.name, keys: SC.keys, text: SC.text })
  })
  it('emptyDraft has no id', () => {
    expect(emptyDraft().id).toBeNull()
  })
  it('detects a changed field and no change', () => {
    expect(isDraftDirty(toDraft(SC), SC)).toBe(false)
    expect(isDraftDirty({ ...toDraft(SC), text: 'other' }, SC)).toBe(true)
    expect(isDraftDirty(emptyDraft(), null)).toBe(false)
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
