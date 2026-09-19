// Name-sync — the pending-title store. The whole point of this module is PUSH ONCE, so the
// load-bearing test is that a second read returns nothing: re-pushing the same name every
// prompt would fight claude's collision rule and re-suffix the session's name forever.
// [spec-claude-session-name-sync.md]

import { describe, it, expect } from 'vitest'
import { createPendingTitles } from './pendingTitles'
import { titleReadBackRename } from './titleReadBack'
import type { HookEvent } from '../../shared/schemas/hookEvent'

describe('createPendingTitles', () => {
  it('take() returns the set name, then CLEARS it — the push-once guarantee', () => {
    const p = createPendingTitles()
    p.set('sess-1', 'billing api')

    expect(p.take('sess-1')).toBe('billing api')
    // Second prompt for the same session must NOT re-push. Delete this clear and claude
    // re-collides on every prompt, minting a fresh suffix each time.
    expect(p.take('sess-1')).toBeNull()
    expect(p.size()).toBe(0)
  })

  it('take() on a session with nothing pending is null (the common case)', () => {
    const p = createPendingTitles()
    expect(p.take('never-renamed')).toBeNull()
  })

  it('a second set() before the push OVERWRITES — the latest rename wins, no queue', () => {
    const p = createPendingTitles()
    p.set('sess-1', 'first')
    p.set('sess-1', 'second')

    expect(p.take('sess-1')).toBe('second')
    expect(p.take('sess-1')).toBeNull()
  })

  it('keeps sessions independent — taking one does not disturb another', () => {
    const p = createPendingTitles()
    p.set('sess-1', 'one')
    p.set('sess-2', 'two')

    expect(p.take('sess-1')).toBe('one')
    expect(p.take('sess-2')).toBe('two')
  })

  it('has() reports a pending push WITHOUT consuming it — the read-back depends on this', () => {
    const p = createPendingTitles()
    expect(p.has('sess-1')).toBe(false)

    p.set('sess-1', 'billing api')
    expect(p.has('sess-1')).toBe(true)
    expect(p.has('sess-1')).toBe(true) // still there — has() must not consume

    // The read-back calls has() on the SAME event the server later pushes on. If has()
    // consumed, the push would silently vanish and the rename would never reach claude.
    expect(p.take('sess-1')).toBe('billing api')
    expect(p.has('sess-1')).toBe(false)
  })

  it('forget() drops a pending name without pushing it (rename raced a stop/exit)', () => {
    const p = createPendingTitles()
    p.set('sess-1', 'about to die')
    p.forget('sess-1')

    expect(p.take('sess-1')).toBeNull()
    expect(p.size()).toBe(0)
  })

  it('forget() on an unknown id is a silent no-op (idempotent removal path)', () => {
    const p = createPendingTitles()
    expect(() => p.forget('never-existed')).not.toThrow()
    expect(p.size()).toBe(0)
  })

  it('refuses to record a blank id or a blank name — never push an empty title at claude', () => {
    const p = createPendingTitles()
    p.set('', 'a name')
    p.set('sess-1', '')

    expect(p.size()).toBe(0)
    expect(p.take('sess-1')).toBeNull()
  })
})

describe('rebind() — the /clear fix (a rename, then /clear before the next prompt)', () => {
  it('moves the pending name from the OLD id to the NEW one', () => {
    const p = createPendingTitles()
    p.set('sess-old', 'renamed in app')
    p.rebind('sess-old', 'sess-new')

    expect(p.has('sess-old')).toBe(false)
    expect(p.has('sess-new')).toBe(true)
    expect(p.take('sess-new')).toBe('renamed in app')
    expect(p.size()).toBe(0)
  })

  it('is a no-op when nothing is pending under the old id', () => {
    const p = createPendingTitles()
    p.rebind('sess-old', 'sess-new')
    expect(p.size()).toBe(0)
    expect(p.has('sess-new')).toBe(false)
  })

  it('a rename pending under the old id WINS over one already under the new id (it is the later act)', () => {
    const p = createPendingTitles()
    p.set('sess-new', 'stale')
    p.set('sess-old', 'latest')
    p.rebind('sess-old', 'sess-new')
    expect(p.take('sess-new')).toBe('latest')
  })

  // The bug this pins: WITHOUT the move, the new id has nothing pending, so the read-back on the
  // next prompt believes claude's stale `session_title` and reverts the card. WITH the move the
  // read-back is suppressed (a push is pending) and the push then delivers the rename.
  it('without the move the read-back reverts the card; with it the read-back is suppressed', () => {
    const evt: HookEvent = {
      session_id: 'sess-new',
      hook_event_name: 'UserPromptSubmit',
      session_title: 'name before the rename'
    }

    const broken = createPendingTitles()
    broken.set('sess-old', 'renamed in app')
    // no rebind — the card was re-keyed to sess-new but the pending title stayed on sess-old
    expect(titleReadBackRename(evt, 'renamed in app', broken.has('sess-new'))).toBe(
      'name before the rename'
    )

    const fixed = createPendingTitles()
    fixed.set('sess-old', 'renamed in app')
    fixed.rebind('sess-old', 'sess-new')
    expect(titleReadBackRename(evt, 'renamed in app', fixed.has('sess-new'))).toBeNull()
    expect(fixed.take('sess-new')).toBe('renamed in app')
  })
})
