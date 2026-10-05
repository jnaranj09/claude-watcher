// Name-sync — the hook-response builder. The exact body shape here is not ours to choose:
// it is what claude 2.1.243 parses as hook output, confirmed by live probe (the response
// below renamed a real session and wrote claude's own custom-title.json).
// [spec-claude-session-name-sync.md]

import { describe, it, expect, vi } from 'vitest'
import { buildHookResponseBody } from './hookResponse'

/** A stand-in for the store's read-and-clear `take`: yields the name once, then null. */
function takesOnce(name: string): () => string | null {
  let taken = false
  return () => {
    if (taken) return null
    taken = true
    return name
  }
}

describe('buildHookResponseBody', () => {
  it('builds the exact hookSpecificOutput block claude parses, for UserPromptSubmit', () => {
    const body = buildHookResponseBody('UserPromptSubmit', takesOnce('billing api'))

    expect(body).not.toBeNull()
    expect(JSON.parse(body as string)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        sessionTitle: 'billing api'
      }
    })
  })

  it('returns null when nothing is pending — the overwhelmingly common case', () => {
    // Most prompts are not preceded by a rename; those must keep the historical empty 200.
    expect(buildHookResponseBody('UserPromptSubmit', () => null)).toBeNull()
  })

  it('returns null for an empty title — never push a blank name at claude', () => {
    expect(buildHookResponseBody('UserPromptSubmit', () => '')).toBeNull()
  })

  it.each([
    'SessionStart',
    'Stop',
    'SessionEnd',
    'PreToolUse',
    'PostToolUse',
    'Notification',
    // A body on PermissionRequest can carry a permission decision (allow/deny a tool). The
    // app only watches: it must always answer this one with an empty 200 (ST-5).
    'PermissionRequest',
    // A body on Elicitation / ElicitationResult can accept, decline or rewrite an MCP server's
    // input form for the operator. The app only watches: always an empty 200 (ST-6).
    'Elicitation',
    'ElicitationResult',
    'SomeFutureEvent'
  ])('returns null for %s even WITH a pending title', (eventName) => {
    // UserPromptSubmit is the only event verified to accept sessionTitle on output AND to
    // report session_title on input, so it is the only one the name round-trips through.
    // SessionStart never reaches an http hook (ST-7), and a mid-session rename could never
    // reach it anyway.
    expect(buildHookResponseBody(eventName, takesOnce('billing api'))).toBeNull()
  })

  it.each(['Stop', 'PostToolUse', 'SessionEnd'])(
    'does NOT consume the pending title on %s — a wrong event must not eat a rename',
    (eventName) => {
      // The store's take() is read-and-clear. If this builder pulled the title before
      // checking the event, any event arriving before the operator's next prompt would
      // swallow the rename and then discard it — the rename would silently never happen.
      const take = vi.fn(takesOnce('billing api'))

      expect(buildHookResponseBody(eventName, take)).toBeNull()
      expect(take).not.toHaveBeenCalled()

      // The name survived, so the next UserPromptSubmit still delivers it.
      expect(buildHookResponseBody('UserPromptSubmit', take)).not.toBeNull()
    }
  )

  it('consumes the title exactly once — a second prompt gets no body', () => {
    const take = takesOnce('billing api')

    expect(buildHookResponseBody('UserPromptSubmit', take)).not.toBeNull()
    expect(buildHookResponseBody('UserPromptSubmit', take)).toBeNull()
  })

  it('does not mangle a name containing quotes or backslashes (JSON-encoded, not spliced)', () => {
    const nasty = `it's "quoted" \\ and odd`
    const body = buildHookResponseBody('UserPromptSubmit', takesOnce(nasty))

    expect(JSON.parse(body as string).hookSpecificOutput.sessionTitle).toBe(nasty)
  })
})
