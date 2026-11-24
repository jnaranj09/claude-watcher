// Security audit finding `titleReadBack.ts:titleReadBackRename:unvalidated-session-title-store-reset`:
// the hook's `session_title` is an unbounded string, and the name it sets is stored in Past
// sessions, whose file parse (`SessionNameSchema` per record) fails closed and resets the whole
// history. Fault: a read-back that returns the title without the name rules.
import { describe, expect, it } from 'vitest'
import { SESSION_NAME_MAX_LENGTH, SessionNameSchema } from '../../shared/schemas/launch'
import { titleReadBackRename } from './titleReadBack'

describe('titleReadBackRename keeps a title within the session name rules', () => {
  it.each([
    ['a newline', 'line one\nline two'],
    ['an ANSI escape', 'name \u001b[31mred'],
    ['a C1 control', 'name \u0085 next'],
    ['only spaces', '   ']
  ])('a title with %s leaves the card name alone', (_label, title) => {
    expect(titleReadBackRename({ session_title: title }, 'billing api', false)).toBeNull()
  })

  it('a title over the limit is cut to the limit and still renames', () => {
    const long = 'x'.repeat(SESSION_NAME_MAX_LENGTH + 1)
    expect(titleReadBackRename({ session_title: long }, 'billing api', false)).toBe(
      'x'.repeat(SESSION_NAME_MAX_LENGTH)
    )
  })

  it('a cut never ends in half of a surrogate pair', () => {
    const long = `${'x'.repeat(SESSION_NAME_MAX_LENGTH - 1)}😀tail`
    const named = titleReadBackRename({ session_title: long }, 'billing api', false)
    expect(named).toBe('x'.repeat(SESSION_NAME_MAX_LENGTH - 1))
  })

  it.each([
    ['a plain name', 'ok name'],
    ['a very long title', 'y'.repeat(5000)],
    ['a trailing newline at the limit', `${'z'.repeat(59)}\n`],
    ['edge spaces', ' padded ']
  ])('%s gives a name that parses as a session name, so Past sessions keeps loading', (_l, t) => {
    const named = titleReadBackRename({ session_title: t }, 'other', false)
    expect(SessionNameSchema.safeParse(named).success).toBe(true)
  })
})
