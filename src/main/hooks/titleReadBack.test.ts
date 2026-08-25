// Name-sync — the read-back decision. Claude is the authority on its own name; these cases
// are the ones where what claude is called drifts from what the app asked for.
// [spec-claude-session-name-sync.md]

import { describe, it, expect } from 'vitest'
import { titleReadBackRename } from './titleReadBack'

describe('titleReadBackRename', () => {
  it('renames the card when claude reports a DIFFERENT name', () => {
    // The headline case: a live-name collision made claude suffix our name, and this is the
    // first time the app can possibly learn about it.
    expect(titleReadBackRename({ session_title: 'api-graceful-unicorn' }, 'api', false)).toBe(
      'api-graceful-unicorn'
    )
  })

  it('picks up a rename the operator typed into the terminal themselves', () => {
    expect(titleReadBackRename({ session_title: 'by hand' }, 'billing api', false)).toBe('by hand')
  })

  it('does NOTHING when the name already matches — no redundant delta per prompt', () => {
    // reducer.renameSession emits a session.updated unconditionally. Drop this compare and
    // EVERY prompt submit ships a pointless delta to the renderer for the rest of the session.
    expect(titleReadBackRename({ session_title: 'billing api' }, 'billing api', false)).toBeNull()
  })

  it('does nothing when the event carries no session_title (Stop, SessionEnd, everything else)', () => {
    expect(titleReadBackRename({}, 'billing api', false)).toBeNull()
    expect(titleReadBackRename({ session_title: undefined }, 'billing api', false)).toBeNull()
  })

  it('never blanks a card: an empty session_title is ignored', () => {
    expect(titleReadBackRename({ session_title: '' }, 'billing api', false)).toBeNull()
  })

  it('does nothing when there is no card — a hook racing a stop/exit, or an external session', () => {
    // Synthesizing a name for an unknown id would put a session on the board that the app
    // never launched (the Story-3.3 ship gate).
    expect(titleReadBackRename({ session_title: 'whatever' }, undefined, false)).toBeNull()
  })

  it('is case- and whitespace-sensitive — a real difference is a real rename', () => {
    expect(titleReadBackRename({ session_title: 'Billing API' }, 'billing api', false)).toBe(
      'Billing API'
    )
    expect(titleReadBackRename({ session_title: 'billing api ' }, 'billing api', false)).toBe(
      'billing api '
    )
  })
})

// REGRESSION — the rename-swap observed in the running app on 2026-08-25.
//
// Renaming the card to "billing api - demo2" and then submitting a prompt left the two names
// SWAPPED: claude adopted the new name, and the board card snapped back to the old one.
//
// Why: the push is delivered by ANSWERING a UserPromptSubmit POST, but claude builds that
// payload before it reads our response — so `session_title` on that very event still says
// "billing api". The read-back believed it and reverted the card the operator had just
// renamed. The push then landed, and the names ended up crossed.
describe('regression — read-back must not revert a rename that is still being pushed', () => {
  const OLD = 'billing api'
  const NEW = 'billing api - demo2'

  it('leaves the card alone on the event carrying the push (stale session_title)', () => {
    // The exact payload/state from the screenshots: card already renamed, claude still on
    // the old name, push pending on this very event.
    expect(titleReadBackRename({ session_title: OLD }, NEW, true)).toBeNull()
  })

  it('without the guard the card would revert — proving the guard is what fixes it', () => {
    // Same inputs, pushPending=false: this IS the buggy behaviour, kept visible on purpose.
    expect(titleReadBackRename({ session_title: OLD }, NEW, false)).toBe(OLD)
  })

  it('once the push has landed, the NEXT prompt agrees and nothing changes', () => {
    // Claude now reports the new name; no push pending anymore.
    expect(titleReadBackRename({ session_title: NEW }, NEW, false)).toBeNull()
  })

  it('a collision suffix still reaches the card on the next prompt', () => {
    // The push landed but claude suffixed it. No push pending now, so claude is believed —
    // the guard must not block genuine corrections, only the stale one.
    expect(titleReadBackRename({ session_title: 'dup-graceful-unicorn' }, 'dup', false)).toBe(
      'dup-graceful-unicorn'
    )
  })
})
