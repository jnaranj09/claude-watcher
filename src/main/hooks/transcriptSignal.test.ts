// Transcript signals — unit tests for the pure line → signal reader.
//
// Runs under the `main-unit` Vitest project (node).
//
// Both signal shapes are VERBATIM from live captures (claude 2.1.250, 2026-08-27):
//
//   interrupt   {"type":"user","sessionId":"…","message":{"role":"user",
//                "content":[{"type":"text","text":"[Request interrupted by user]"}]}}
//               (variant: "[Request interrupted by user for tool use]" — 47 vs 36
//                occurrences across the local transcript corpus)
//
// (Background-task completion used to be read here too. It is not: the `Stop` payload
// reports running work directly in `background_tasks`.)

import { describe, it, expect } from 'vitest'
import { transcriptSignal } from './transcriptSignal'

const userEntry = (text: string): unknown => ({
  type: 'user',
  sessionId: 's1',
  message: { role: 'user', content: [{ type: 'text', text }] }
})

describe('transcriptSignal — interrupt detection', () => {
  it('detects the plain interrupt marker', () => {
    expect(transcriptSignal(userEntry('[Request interrupted by user]'))).toEqual({
      kind: 'interrupted'
    })
  })

  it('detects the tool-use interrupt marker', () => {
    expect(transcriptSignal(userEntry('[Request interrupted by user for tool use]'))).toEqual({
      kind: 'interrupted'
    })
  })

  it('tolerates surrounding whitespace', () => {
    expect(transcriptSignal(userEntry('  [Request interrupted by user]\n'))).toEqual({
      kind: 'interrupted'
    })
  })

  it('accepts a plain STRING content (the polymorphic shape)', () => {
    expect(
      transcriptSignal({
        type: 'user',
        message: { role: 'user', content: '[Request interrupted by user]' }
      })
    ).toEqual({ kind: 'interrupted' })
  })

  // LOAD-BEARING: the marker must be the WHOLE message, never a substring. The local
  // transcript corpus contains sessions that merely DISCUSS interrupts (this very feature
  // was designed in one). A substring match would flip those sessions to idle mid-turn.
  it('does NOT fire when the marker is only QUOTED inside a longer message', () => {
    expect(
      transcriptSignal(
        userEntry('When `[Request interrupted by user]` appears, the agent should stop.')
      )
    ).toBeNull()
  })

  it('does NOT fire on a message that merely starts with the marker', () => {
    expect(
      transcriptSignal(userEntry('[Request interrupted by user] and then I typed more'))
    ).toBeNull()
  })

  it('does NOT fire on an ordinary user message', () => {
    expect(transcriptSignal(userEntry('please run the tests'))).toBeNull()
  })
})

describe('transcriptSignal — never throws, drops quietly', () => {
  it('returns null for junk, missing and malformed input', () => {
    expect(transcriptSignal(null)).toBeNull()
    expect(transcriptSignal(undefined)).toBeNull()
    expect(transcriptSignal(42)).toBeNull()
    expect(transcriptSignal('a bare string')).toBeNull()
    expect(transcriptSignal({})).toBeNull()
    expect(transcriptSignal({ type: 'user' })).toBeNull()
    expect(transcriptSignal({ type: 'user', message: {} })).toBeNull()
    expect(transcriptSignal({ type: 'user', message: { content: 42 } })).toBeNull()
    expect(transcriptSignal({ type: 'summary', message: { content: [] } })).toBeNull()
  })

  it('ignores entry types other than user (an assistant echo must not fire)', () => {
    expect(
      transcriptSignal({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] }
      })
    ).toBeNull()
  })
})
