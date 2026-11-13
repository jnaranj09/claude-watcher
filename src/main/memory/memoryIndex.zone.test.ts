// The task line's days in Europe/Berlin (`zone-berlin` project): `last seen` counts local calendar
// days, so an hour across midnight is a day, and a day across the DST change is still one.
import { describe, expect, it } from 'vitest'
import { buildMemoryIndex } from './memoryIndex'
import type { IndexTask } from './memoryTasks'

const local = (y: number, m: number, d: number, h: number, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime()

function lineOf(task: Partial<IndexTask>, now: number): string {
  const t: IndexTask = {
    id: 't1',
    title: 'Cache',
    createdAt: local(2026, 11, 2, 12),
    lastSeenAt: null,
    leftWith: null,
    check: null,
    reportedDoneAt: null,
    ...task
  }
  const out = buildMemoryIndex({
    pinned: [],
    tasksHere: [t],
    specificsHere: [],
    episodesHere: [],
    more: 0,
    now
  })
  return out.text.split('\n').at(-1) ?? ''
}

describe('the task line in Europe/Berlin', () => {
  it('runs in Europe/Berlin', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Berlin')
  })

  it('seen at 23:30 and read at 00:30 the next local day is 1 day ago, though UTC is one day', () => {
    expect(lineOf({ lastSeenAt: local(2026, 11, 11, 23, 30) }, local(2026, 11, 12, 0, 30))).toBe(
      '- Cache · open since 2026-11-02 · last seen 1 day ago · id=t1'
    )
  })

  it('seen at 00:30 and read at 23:30 the same local day is today', () => {
    expect(lineOf({ lastSeenAt: local(2026, 11, 12, 0, 30) }, local(2026, 11, 12, 23, 30))).toBe(
      '- Cache · open since 2026-11-02 · last seen today · id=t1'
    )
  })

  it('across the October DST change, two local days are 2 days', () => {
    expect(lineOf({ lastSeenAt: local(2026, 10, 24, 23, 30) }, local(2026, 10, 26, 0, 30))).toBe(
      '- Cache · open since 2026-11-02 · last seen 2 days ago · id=t1'
    )
  })

  it('open since and reported done are local days near midnight', () => {
    expect(
      lineOf(
        {
          createdAt: local(2026, 11, 2, 0, 30),
          lastSeenAt: local(2026, 11, 3, 0, 30),
          reportedDoneAt: local(2026, 11, 3, 0, 15)
        },
        local(2026, 11, 3, 12)
      )
    ).toBe(
      '- Cache · open since 2026-11-02 · last seen today · reported done 2026-11-03, not confirmed · id=t1'
    )
  })
})
