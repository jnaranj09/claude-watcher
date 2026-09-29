// UX-14 — "is this session id running in a live claude process right now?" Unit tests over
// injected fs + kill seams (main-unit, node). No real files, no real processes.
//
// Every case is a FAULT-INJECTION target: removing the guard it names in runningElsewhere.ts
// must turn it red.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRunningElsewhereCheck, isPidAliveBySignal } from './runningElsewhere'

const DIR = '/home/operator/.claude/sessions'
const ID = 'c0ffee00-0000-4000-8000-000000000001'

function record(pid: number, sessionId: string): string {
  return JSON.stringify({ pid, sessionId, cwd: '/home/operator/secret-project', name: 'ZYPF' })
}

function checkOver(
  files: Readonly<Record<string, string | (() => string)>>,
  alive: ReadonlySet<number> = new Set([4242])
): { isRunningElsewhere: (id: string) => boolean; opened: string[]; probed: number[] } {
  const opened: string[] = []
  const probed: number[] = []
  const check = createRunningElsewhereCheck({
    sessionsDir: DIR,
    listDir: () => Object.keys(files),
    readFile: (path) => {
      opened.push(path)
      const content = files[path.slice(DIR.length + 1)]
      if (content === undefined) throw new Error('ENOENT')
      return typeof content === 'function' ? content() : content
    },
    isPidAlive: (pid) => {
      probed.push(pid)
      return alive.has(pid)
    }
  })
  return { isRunningElsewhere: check.isRunningElsewhere, opened, probed }
}

describe('createRunningElsewhereCheck', () => {
  let consoleSpies: ReturnType<typeof vi.spyOn>[]
  beforeEach(() => {
    consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {})
    ]
  })
  afterEach(() => {
    // The record carries the operator's cwd and session name — nothing here may ever log.
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('true when a live process records the id', () => {
    expect(checkOver({ '4242.json': record(4242, ID) }).isRunningElsewhere(ID)).toBe(true)
  })

  it('false when the recording process is dead (a stale file after a SIGKILL)', () => {
    expect(checkOver({ '4242.json': record(4242, ID) }, new Set()).isRunningElsewhere(ID)).toBe(
      false
    )
  })

  it('false when the live process records a DIFFERENT id — and it is never probed', () => {
    const c = checkOver({ '4242.json': record(4242, 'another-id') })
    expect(c.isRunningElsewhere(ID)).toBe(false)
    expect(c.probed).toEqual([])
  })

  it('false when the record pid disagrees with its file name (a copied or stale file)', () => {
    const alive = new Set([4242, 9999])
    expect(checkOver({ '9999.json': record(4242, ID) }, alive).isRunningElsewhere(ID)).toBe(false)
  })

  it('never opens a name that is not `<digits>.json` (the sibling .key files)', () => {
    const c = checkOver({ '4242.abc.key': record(4242, ID), 'x.json': record(4242, ID) })
    expect(c.isRunningElsewhere(ID)).toBe(false)
    expect(c.opened).toEqual([])
  })

  it('skips an unreadable, non-JSON or malformed file and keeps scanning', () => {
    const c = checkOver({
      '1.json': () => {
        throw new Error('EACCES')
      },
      '2.json': '{ nope',
      '3.json': JSON.stringify({ pid: 3 }),
      '4242.json': record(4242, ID)
    })
    expect(c.isRunningElsewhere(ID)).toBe(true)
  })

  it('fails OPEN when the directory cannot be listed (no dir, older claude)', () => {
    const check = createRunningElsewhereCheck({
      sessionsDir: DIR,
      listDir: () => {
        throw new Error('ENOENT')
      },
      readFile: () => {
        throw new Error('must not read')
      },
      isPidAlive: () => true
    })
    expect(check.isRunningElsewhere(ID)).toBe(false)
  })

  it('never throws when the pid probe throws (treated as not running)', () => {
    const check = createRunningElsewhereCheck({
      sessionsDir: DIR,
      listDir: () => ['4242.json'],
      readFile: () => record(4242, ID),
      isPidAlive: () => {
        throw new Error('boom')
      }
    })
    expect(check.isRunningElsewhere(ID)).toBe(false)
  })
})

describe('isPidAliveBySignal — kill(pid, 0) semantics', () => {
  function killThat(code?: string): (pid: number, signal: 0) => void {
    return () => {
      if (code === undefined) return
      throw Object.assign(new Error(code), { code })
    }
  }
  it('alive when signal 0 is delivered', () => {
    expect(isPidAliveBySignal(4242, killThat())).toBe(true)
  })
  it('alive on EPERM (the process exists, it is just not ours)', () => {
    expect(isPidAliveBySignal(4242, killThat('EPERM'))).toBe(true)
  })
  it('dead on ESRCH or anything else', () => {
    expect(isPidAliveBySignal(4242, killThat('ESRCH'))).toBe(false)
    expect(isPidAliveBySignal(4242, killThat('EINVAL'))).toBe(false)
  })
})
