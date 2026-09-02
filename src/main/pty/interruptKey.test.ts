// Interrupt key — unit tests for the bare-Escape detector.
//
// Runs under the `main-unit` Vitest project (node).
//
// WHY A KEYSTROKE AND NOT A HOOK OR THE TRANSCRIPT. Probe-verified on claude 2.1.250
// (2026-08-27), interrupting a turn produces NOTHING the app can observe out of band:
//   - NO hook of any kind fires (12 events captured before Esc, 12 after; and no
//     `idle_prompt` notification even after 90 seconds), with both `command` and `http`
//     hook types;
//   - the TRANSCRIPT only records `[Request interrupted by user…]` when there was
//     assistant content to interrupt. Interrupting early — the "say hi, hit Esc" case —
//     cancels cleanly, restores the prompt to the input box, and writes NOTHING at all,
//     not even once the next prompt is submitted.
//
// The keypress is therefore the only evidence that exists, and the app already sees it:
// every byte the renderer types passes through main on its way to the pty.
//
// Escape must be matched as a WHOLE, EXACT chunk. xterm sends `\x1b` alone for the Escape
// key, but `\x1b[A` (arrow up), `\x1b[B`, `\x1bOP` (F1) and friends also START with it —
// a prefix match would treat every arrow key as an interrupt.

import { describe, it, expect } from 'vitest'
import { isInterruptKey } from './interruptKey'

describe('isInterruptKey — a bare Escape, and nothing else', () => {
  it('matches a lone Escape byte', () => {
    expect(isInterruptKey('\x1b')).toBe(true)
  })

  it('does NOT match arrow keys, which are Escape-prefixed sequences', () => {
    expect(isInterruptKey('\x1b[A')).toBe(false)
    expect(isInterruptKey('\x1b[B')).toBe(false)
    expect(isInterruptKey('\x1b[C')).toBe(false)
    expect(isInterruptKey('\x1b[D')).toBe(false)
  })

  it('does NOT match function keys or other CSI/SS3 sequences', () => {
    expect(isInterruptKey('\x1bOP')).toBe(false)
    expect(isInterruptKey('\x1b[3~')).toBe(false)
    expect(isInterruptKey('\x1b[200~')).toBe(false) // bracketed paste start
  })

  it('does NOT match ordinary typing', () => {
    expect(isInterruptKey('a')).toBe(false)
    expect(isInterruptKey('hi')).toBe(false)
    expect(isInterruptKey('\r')).toBe(false)
    expect(isInterruptKey('\x03')).toBe(false) // Ctrl-C is not Escape
    expect(isInterruptKey('')).toBe(false)
  })

  it('does NOT match a pasted blob that merely CONTAINS an escape', () => {
    expect(isInterruptKey('some text \x1b more text')).toBe(false)
    expect(isInterruptKey('\x1b\x1b')).toBe(false)
  })
})
