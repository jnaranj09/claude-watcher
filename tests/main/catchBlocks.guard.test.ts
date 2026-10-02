// Silent catches (technical-taste §5b-17): a contained error is logged with a `code=`, or the catch
// says WHY swallowing it is safe. A catch with no statement is allowed only where this list names
// the file, with the exact count and the reason. The list can only shrink: a file that loses a
// silent catch must lower its count here in the same change.
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { SRC, parseSource, silentCatches, sourceFiles, srcRel } from './sourceScan'

const ALLOWED: Record<string, { count: number; why: string }> = {
  'main/hooks/transcriptWatcher.ts': {
    count: 5,
    why: 'the tail is best-effort: a missing file, a closed watcher or a consumer fault must never stop the poll'
  },
  'main/persistence/electronBlobStore.ts': {
    count: 2,
    why: 'backing up a corrupt store is best-effort; the reset proceeds either way'
  },
  'main/persistence/fsTelemetryLineStore.ts': {
    count: 1,
    why: 'renaming a corrupt telemetry file is best-effort; recovery proceeds'
  },
  'main/pty/runningElsewhere.ts': {
    count: 1,
    why: 'fails OPEN: an unprovable record never blocks an Open'
  },
  'main/pty/terminalManager.ts': {
    count: 6,
    why: 'teardown of a listener or a superseded port must never throw out of a kill or re-attach'
  },
  'renderer/src/components/SplitDivider/SplitDivider.tsx': {
    count: 2,
    why: 'pointer capture is optional; the drag works without it'
  },
  'renderer/src/stores/toastStore.ts': {
    count: 1,
    why: 'a toast action that throws is contained; the action reports its own error'
  },
  'renderer/src/terminal/EmbeddedTerminal.tsx': {
    count: 1,
    why: 'closing a port that may already be closed during unmount'
  }
}

const scan = (text: string): ReturnType<typeof silentCatches> =>
  silentCatches(parseSource(join(SRC, 'main/x.ts'), text))

describe('silentCatches', () => {
  it('counts a truly empty catch as empty', () => {
    expect(scan('try { f() } catch {}\n')).toEqual({ empty: 1, commented: 0, unexplained: 0 })
  })

  it('counts a catch holding only a reason as commented', () => {
    expect(scan('try { f() } catch {\n  /* fail open: a false block bricks it */\n}\n')).toEqual({
      empty: 0,
      commented: 1,
      unexplained: 0
    })
  })

  it('flags a comment too short to say why (fewer than 3 words)', () => {
    expect(scan('try { f() } catch {\n  /* ignore */\n}\n')).toEqual({
      empty: 0,
      commented: 1,
      unexplained: 1
    })
  })

  it('does not count a catch that logs or continues', () => {
    expect(
      scan("try { f() } catch { log('code=x') }\nfor (;;) { try { f() } catch { continue } }\n")
    ).toEqual({ empty: 0, commented: 0, unexplained: 0 })
  })
})

describe('silent-catch guard', () => {
  const found = new Map<string, ReturnType<typeof silentCatches>>()
  for (const f of sourceFiles()) {
    const r = silentCatches(parseSource(f))
    if (r.empty + r.commented > 0) found.set(srcRel(f), r)
  }

  it('no catch is truly empty, and every comment-only catch says why', () => {
    const bad = [...found].filter(([, r]) => r.empty + r.unexplained > 0).map(([f]) => f)
    expect(bad).toEqual([])
  })

  it('comment-only catches exist only where the list allows, at the listed count', () => {
    // A new one: log a `code=` instead, or add the file here with a reason. A removed one: lower
    // the count (the list only shrinks).
    const actual = Object.fromEntries([...found].map(([f, r]) => [f, r.commented]))
    const expected = Object.fromEntries(Object.entries(ALLOWED).map(([f, a]) => [f, a.count]))
    expect(actual).toEqual(expected)
  })
})
