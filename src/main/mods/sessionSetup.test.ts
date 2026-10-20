// The latest bridge mod report per live session (spec 2026-10-18 §2): in memory, dies with the
// session, follows a `/clear` rebind.
import { describe, it, expect, vi } from 'vitest'
import { createSessionSetup } from './sessionSetup'
import { modReportFixture, MOD_REPORT_SESSION_ID as ID } from '../../__fixtures__/modReport'
import type { ModReport } from '../../shared/schemas/modReport'

function setup(known: Set<string> = new Set([ID])): {
  s: ReturnType<typeof createSessionSetup>
  isKnown: ReturnType<typeof vi.fn<(id: string) => boolean>>
  onChange: ReturnType<typeof vi.fn<(id: string, r: ModReport) => void>>
  log: ReturnType<typeof vi.fn<(l: string) => void>>
} {
  const isKnown = vi.fn<(id: string) => boolean>((id) => known.has(id))
  const onChange = vi.fn<(id: string, r: ModReport) => void>()
  const log = vi.fn<(l: string) => void>()
  return { s: createSessionSetup({ isKnown, onChange, log }), isKnown, onChange, log }
}

describe('createSessionSetup', () => {
  it('drops a report for an unknown session, logs one code, and stores nothing', () => {
    const { s, log, onChange } = setup(new Set())
    expect(s.accept(modReportFixture())).toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[claude-watcher][mods] code=mod_unknown_session')
    expect(s.get(ID)).toEqual({ state: 'waiting' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a known session’s report reads ready', () => {
    const { s } = setup()
    const r = modReportFixture()
    expect(s.accept(r)).toBe(true)
    expect(s.get(ID)).toEqual({ state: 'ready', report: r })
  })

  it('a launched session with no report reads waiting', () => {
    expect(setup().s.get(ID)).toEqual({ state: 'waiting' })
  })

  it('markUnavailable reads unavailable with its reason', () => {
    const { s } = setup()
    s.markUnavailable(ID, 'claude_too_old')
    expect(s.get(ID)).toEqual({ state: 'unavailable', reason: 'claude_too_old' })
  })

  it('a later report wins over an unavailable mark', () => {
    const { s } = setup()
    s.markUnavailable(ID, 'listener_down')
    s.accept(modReportFixture())
    expect(s.get(ID).state).toBe('ready')
  })

  it('an unavailable mark does not hide a report already in', () => {
    const { s } = setup()
    s.accept(modReportFixture())
    s.markUnavailable(ID, 'listener_down')
    expect(s.get(ID).state).toBe('ready')
  })

  it('rebind moves the setup to the new id (a /clear), and the old id reads waiting', () => {
    const NEW = 'bbbbbbbb-0000-4000-8000-0000000000bb'
    const { s } = setup(new Set([ID, NEW]))
    const r = modReportFixture()
    s.accept(r)
    s.rebind(ID, NEW)
    expect(s.get(NEW)).toEqual({ state: 'ready', report: r })
    expect(s.get(ID)).toEqual({ state: 'waiting' })
  })

  it('rebind keeps an unavailable mark too', () => {
    const NEW = 'bbbbbbbb-0000-4000-8000-0000000000bb'
    const { s } = setup(new Set([ID, NEW]))
    s.markUnavailable(ID, 'mod_not_installed')
    s.rebind(ID, NEW)
    expect(s.get(NEW)).toEqual({ state: 'unavailable', reason: 'mod_not_installed' })
  })

  it('a report under the new id after a rebind is accepted', () => {
    const NEW = 'bbbbbbbb-0000-4000-8000-0000000000bb'
    const { s } = setup(new Set([ID, NEW]))
    s.accept(modReportFixture())
    s.rebind(ID, NEW)
    expect(s.accept(modReportFixture({ sessionId: NEW }))).toBe(true)
    expect(s.get(NEW).state).toBe('ready')
  })

  it('forget drops the setup, and a later report asks isKnown again', () => {
    const known = new Set([ID])
    const { s, isKnown } = setup(known)
    s.accept(modReportFixture())
    s.forget(ID)
    expect(s.get(ID)).toEqual({ state: 'waiting' })
    known.delete(ID)
    isKnown.mockClear()
    expect(s.accept(modReportFixture())).toBe(false)
    expect(isKnown).toHaveBeenCalledWith(ID)
  })

  it('onChange fires once per accepted report, with the id and the report', () => {
    const { s, onChange } = setup()
    const r = modReportFixture()
    s.accept(r)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(ID, r)
  })

  it('no log line holds a path from the report', () => {
    const { s, log } = setup(new Set())
    s.accept(modReportFixture())
    for (const [line] of log.mock.calls) expect(line).not.toContain('/work/app')
  })

  it('reportsPath is true only for a path some ready report names', () => {
    const { s } = setup()
    expect(s.reportsPath('/work/app/CLAUDE.md')).toBe(false)
    s.accept(modReportFixture())
    expect(s.reportsPath('/work/app/CLAUDE.md')).toBe(true)
    expect(s.reportsPath('/etc/passwd')).toBe(false)
    s.forget(ID)
    expect(s.reportsPath('/work/app/CLAUDE.md')).toBe(false)
  })
})
