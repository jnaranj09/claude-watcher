// Where the session engine meets memory's save points (memory phase 2, Task 11): the end of the
// hook callback and the removal chokepoint, each in its one order. Every step records itself in
// one list, the extractor's calls included, so a test sees what ran and in which order.
import { describe, expect, it } from 'vitest'
import type { RemovalReason } from '../pty/launchRemoval'
import { routeHookEnd, runRemoval } from './memorySavePoints'

function recorder(): {
  order: string[]
  extractor: {
    stop(id: string): void
    stopFailed(id: string): void
    ended(id: string): void
    forget(id: string): void
  }
  logs: string[]
} {
  const order: string[] = []
  return {
    order,
    logs: [],
    extractor: {
      stop: (id) => void order.push(`stop:${id}`),
      stopFailed: (id) => void order.push(`stopFailed:${id}`),
      ended: (id) => void order.push(`ended:${id}`),
      forget: (id) => void order.push(`forget:${id}`)
    }
  }
}

/** The hook callback's end for `evt`, with `keep` answering `kept` (null: nothing can keep). */
function route(
  r: ReturnType<typeof recorder>,
  evt: { hook_event_name: string; reason?: string },
  opts: { removed: boolean; knownLaunched: boolean; kept: boolean | null }
): void {
  routeHookEnd({
    sessionId: 'old',
    evt,
    removed: opts.removed,
    knownLaunched: opts.knownLaunched,
    keep:
      opts.kept === null
        ? null
        : () => {
            r.order.push('keep')
            return opts.kept === true
          },
    archive: () => void r.order.push('archive'),
    apply: () => void r.order.push('apply'),
    extractor: r.extractor,
    log: (line) => void r.logs.push(line)
  })
}

const CLEAR = { hook_event_name: 'SessionEnd', reason: 'clear' }

describe('the end of the hook callback', () => {
  it('a kept /clear ends the old id for memory, then nothing else runs', () => {
    const r = recorder()
    route(r, CLEAR, { removed: true, knownLaunched: true, kept: true })
    expect(r.order).toEqual(['keep', 'ended:old'])
  })

  it('a Stop is applied first, then counted toward a checkpoint', () => {
    const r = recorder()
    route(r, { hook_event_name: 'Stop' }, { removed: false, knownLaunched: true, kept: null })
    expect(r.order).toEqual(['apply', 'stop:old'])
  })

  it('a Stop of a session the app did not launch is only applied', () => {
    const r = recorder()
    route(r, { hook_event_name: 'Stop' }, { removed: false, knownLaunched: false, kept: null })
    expect(r.order).toEqual(['apply'])
  })

  it('any other status is only applied', () => {
    const r = recorder()
    route(
      r,
      { hook_event_name: 'Notification' },
      { removed: false, knownLaunched: true, kept: null }
    )
    expect(r.order).toEqual(['apply'])
  })

  it('a StopFailure of a known launched session calls stopFailed', () => {
    const r = recorder()
    route(
      r,
      { hook_event_name: 'StopFailure' },
      { removed: false, knownLaunched: true, kept: null }
    )
    expect(r.order).toEqual(['apply', 'stopFailed:old'])
  })

  it('a StopFailure of a session the app did not launch is only applied', () => {
    const r = recorder()
    route(
      r,
      { hook_event_name: 'StopFailure' },
      { removed: false, knownLaunched: false, kept: null }
    )
    expect(r.order).toEqual(['apply'])
  })

  it('a kept SessionEnd that is not a /clear makes no save point: the pty exit will archive it', () => {
    const r = recorder()
    route(
      r,
      { hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' },
      { removed: true, knownLaunched: true, kept: true }
    )
    expect(r.order).toEqual(['keep'])
  })

  it('a SessionEnd that is not kept is archived, and the removal makes the save point', () => {
    const r = recorder()
    route(r, CLEAR, { removed: true, knownLaunched: true, kept: false })
    expect(r.order).toEqual(['keep', 'archive'])
  })

  it('a SessionEnd is archived when nothing can keep it', () => {
    const r = recorder()
    route(r, CLEAR, { removed: true, knownLaunched: true, kept: null })
    expect(r.order).toEqual(['archive'])
  })

  it('a late SessionEnd after the card left makes no save point', () => {
    const r = recorder()
    route(r, CLEAR, { removed: true, knownLaunched: false, kept: true })
    expect(r.order).toEqual(['keep'])
  })

  it('an extractor that throws never breaks the hook: the status still ships, a code is logged', () => {
    const r = recorder()
    routeHookEnd({
      sessionId: 's1',
      evt: { hook_event_name: 'Stop' },
      removed: false,
      knownLaunched: true,
      keep: null,
      archive: () => undefined,
      apply: () => void r.order.push('apply'),
      extractor: {
        stop: () => {
          throw new Error('boom')
        },
        stopFailed: () => undefined,
        ended: () => undefined
      },
      log: (line) => void r.logs.push(line)
    })
    expect(r.order).toEqual(['apply'])
    expect(r.logs).toEqual(['[claude-watcher][memory] code=memory_save_point_failed'])
  })
})

function remove(r: ReturnType<typeof recorder>, reason: RemovalReason, onBoard: boolean): void {
  runRemoval({
    sessionId: 's1',
    reason,
    onBoard,
    extractor: r.extractor,
    log: (line) => void r.logs.push(line),
    recordRemoval: () => void r.order.push('record'),
    dropCardState: () => void r.order.push('card'),
    removeFromBoard: () => void r.order.push('board')
  })
}

describe('the removal chokepoint', () => {
  it('an archive runs the record, then ends the save, then the card state, then the board', () => {
    const r = recorder()
    remove(r, 'archive', true)
    expect(r.order).toEqual(['record', 'ended:s1', 'card', 'board'])
  })

  it('a delete forgets the save while the card is still on the board', () => {
    const r = recorder()
    remove(r, 'delete', true)
    expect(r.order).toEqual(['record', 'forget:s1', 'card', 'board'])
  })

  it('a removal of a card that already left runs no memory step', () => {
    const r = recorder()
    remove(r, 'archive', false)
    expect(r.order).toEqual(['record', 'card', 'board'])
  })

  it('an extractor that throws never stops the removal: a code is logged', () => {
    const order: string[] = []
    const logs: string[] = []
    runRemoval({
      sessionId: 's1',
      reason: 'archive',
      onBoard: true,
      extractor: {
        ended: () => {
          throw new Error('boom')
        },
        forget: () => undefined
      },
      log: (line) => void logs.push(line),
      recordRemoval: () => void order.push('record'),
      dropCardState: () => void order.push('card'),
      removeFromBoard: () => void order.push('board')
    })
    expect(order).toEqual(['record', 'card', 'board'])
    expect(logs).toEqual(['[claude-watcher][memory] code=memory_save_point_failed'])
  })
})
