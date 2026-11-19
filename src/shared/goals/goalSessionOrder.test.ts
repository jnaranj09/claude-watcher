// The one session order for the goal form and the planner (spec 2026-11-18 memory session goals,
// "Session order").
import { describe, expect, it } from 'vitest'
import { goalSessionOrder } from './goalSessionOrder'

const task = (
  id: string,
  ...touches: [string, number][]
): {
  id: string
  touchedBy: { sessionId: string; at: number }[]
} => ({ id, touchedBy: touches.map(([sessionId, at]) => ({ sessionId, at })) })

describe('goalSessionOrder', () => {
  it('lists sessions by last touch, newest first; inside one, its tasks by its own touch, newest first', () => {
    const order = goalSessionOrder([
      task('t1', ['s-old', 10]),
      task('t2', ['s-new', 30]),
      task('t3', ['s-new', 50]),
      task('t4', ['s-old', 20])
    ])
    expect(order).toEqual([
      { sessionId: 's-new', taskIds: ['t3', 't2'] },
      { sessionId: 's-old', taskIds: ['t4', 't1'] }
    ])
  })

  it('breaks a tie between sessions by session id, and between tasks by task id', () => {
    const order = goalSessionOrder([
      task('t2', ['s-b', 5]),
      task('t1', ['s-b', 5]),
      task('t3', ['s-a', 5])
    ])
    expect(order).toEqual([
      { sessionId: 's-a', taskIds: ['t3'] },
      { sessionId: 's-b', taskIds: ['t1', 't2'] }
    ])
  })

  it('a task touched by two sessions is listed under each, at that session’s own time', () => {
    const order = goalSessionOrder([task('t1', ['s-a', 10], ['s-b', 40]), task('t2', ['s-a', 20])])
    expect(order).toEqual([
      { sessionId: 's-b', taskIds: ['t1'] },
      // s-a's touch of t1 is 10, older than its touch of t2: t2 comes first.
      { sessionId: 's-a', taskIds: ['t2', 't1'] }
    ])
  })

  it('a session that touched one task twice counts its newest touch, and lists the task once', () => {
    const order = goalSessionOrder([task('t1', ['s-a', 60], ['s-a', 10]), task('t2', ['s-b', 30])])
    expect(order).toEqual([
      { sessionId: 's-a', taskIds: ['t1'] },
      { sessionId: 's-b', taskIds: ['t2'] }
    ])
  })

  it('no touches: no sessions', () => {
    expect(goalSessionOrder([task('t1'), task('t2')])).toEqual([])
    expect(goalSessionOrder([])).toEqual([])
  })
})
