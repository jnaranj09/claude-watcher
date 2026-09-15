// Rules — the delta-pipeline ORDER (spec §2.2). index.ts's handleDelta is not importable by any
// test (module-level Electron side effects), so the ordering this task depends on — read the
// column BEFORE the tracker sees the delta, let it see it, read AFTER, ship, THEN run the rules
// engine — is pinned here instead: index.ts's handleDelta calls this function directly, so this
// test IS a test of the real order, not a harness copy of it.
import { describe, it, expect } from 'vitest'
import { runDeltaPipeline } from './deltaPipeline'
import type { Column, ReducerWatchEventsPayload } from '../../shared/ipc/contract'

function updated(id: string): ReducerWatchEventsPayload {
  return {
    epoch: 1,
    event: { type: 'session.updated', id, sessionName: 's', projectPath: '/p', status: 'Working' }
  }
}

function removed(id: string): ReducerWatchEventsPayload {
  return { epoch: 1, event: { type: 'session.removed', id, sessionName: 's', projectPath: '/p' } }
}

describe('runDeltaPipeline — the column-edge order the rules engine depends on (spec §2.2)', () => {
  it('reads the column BEFORE the tracker sees the delta, then AFTER, then ships, THEN runs the rules engine — in that order', () => {
    const order: string[] = []
    const columns: (Column | undefined)[] = ['working', 'needs-you']
    let columnCall = 0

    runDeltaPipeline(updated('s1'), {
      columnOf: () => {
        const value = columns[columnCall]
        order.push(`columnOf→${String(value)}`)
        columnCall += 1
        return value
      },
      onTrackerDelta: (delta) => {
        order.push(`tracker(${delta.event.id})`)
        return ['raised-event']
      },
      ship: (raised, edge) => {
        order.push(`ship(${String(edge.before)}→${String(edge.after)}, ${raised.join(',')})`)
      },
      afterRules: (edge) => {
        order.push(`rules(${String(edge.before)}→${String(edge.after)})`)
      }
    })

    expect(order).toEqual([
      'columnOf→working',
      'tracker(s1)',
      'columnOf→needs-you',
      'ship(working→needs-you, raised-event)',
      'rules(working→needs-you)'
    ])
  })

  it('a session.removed event reads no column edge (before/after both undefined)', () => {
    const columnOfCalls: string[] = []
    const seen: string[] = []
    runDeltaPipeline(removed('s1'), {
      columnOf: (id) => {
        columnOfCalls.push(id)
        return 'working'
      },
      onTrackerDelta: () => [],
      ship: (_raised, edge) => seen.push(`ship:${String(edge.before)}:${String(edge.after)}`),
      afterRules: (edge) => seen.push(`rules:${String(edge.before)}:${String(edge.after)}`)
    })
    expect(columnOfCalls).toEqual([])
    expect(seen).toEqual(['ship:undefined:undefined', 'rules:undefined:undefined'])
  })

  it('afterRules runs strictly after ship has fully returned — never bundled into the same call', () => {
    let shipReturned = false
    let afterRulesRan = false
    runDeltaPipeline(updated('s1'), {
      columnOf: () => 'idle',
      onTrackerDelta: () => [],
      ship: () => {
        shipReturned = true
      },
      afterRules: () => {
        afterRulesRan = true
        expect(shipReturned).toBe(true)
      }
    })
    expect(afterRulesRan).toBe(true)
  })
})
