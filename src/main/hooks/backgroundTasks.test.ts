// Background tasks — unit tests for the pure `Stop`-payload reader.
//
// Runs under the `main-unit` Vitest project (node).
//
// PROBE-GROUNDED (claude 2.1.250 via an `http`-type hook — the SAME hook kind the app
// registers — captured live 2026-08-27). The `Stop` payload carries the answer directly:
//
//   nothing running   "background_tasks": []
//   a background shell
//     "background_tasks": [{ "id":"b0me4z8hx", "type":"shell", "status":"running",
//                            "description":"Sleep 40s…", "command":"sleep 40 && echo Z" }]
//   an armed Monitor  the same shape, also type "shell", also status "running"
//
// This REPLACED a whole subsystem: a task registry keyed by ids scraped from
// `tool_response`, matched against `<task-notification>` blocks tailed out of the
// transcript, with an age backstop for completions that never arrived. All of that was
// reconstructing, at some effort and some risk of drift, a fact the hook already states
// on the exact event that needs it. None of it was necessary.

import { describe, it, expect } from 'vitest'
import { hasRunningBackgroundWork, runningTaskIds } from './backgroundTasks'
import type { HookEvent } from '../../shared/schemas/hookEvent'

const stop = (over: Partial<HookEvent> = {}): HookEvent => ({
  session_id: 's1',
  hook_event_name: 'Stop',
  ...over
})

describe('hasRunningBackgroundWork — read the truth off the Stop payload', () => {
  it('true when a background shell is running', () => {
    expect(
      hasRunningBackgroundWork(
        stop({
          background_tasks: [
            {
              id: 'b0me4z8hx',
              type: 'shell',
              status: 'running',
              description: 'Sleep 40s then echo Z',
              command: 'sleep 40 && echo Z'
            }
          ]
        })
      )
    ).toBe(true)
  })

  it('true when an armed Monitor is running', () => {
    expect(
      hasRunningBackgroundWork(
        stop({
          background_tasks: [
            { id: 'bkjklu3zy', type: 'shell', status: 'running', description: 'waiting for a file' }
          ]
        })
      )
    ).toBe(true)
  })

  it('true when ANY of several tasks is still running', () => {
    expect(
      hasRunningBackgroundWork(
        stop({
          background_tasks: [
            { id: 'bA', status: 'completed' },
            { id: 'bB', status: 'completed' },
            { id: 'bC', status: 'running' }
          ]
        })
      )
    ).toBe(true)
  })

  // PROBE (claude 2.1.308, 2026-10-22): an artifact watch is an ambient `monitor_ws` task that
  // never ends by itself. The Stop payload drops claude's `ambient` flag, so it reaches us as a
  // running "monitor"; only its description tells it apart from a real Monitor.
  it('false when the only running task is an artifact watch — claude is idle at the prompt', () => {
    expect(
      hasRunningBackgroundWork(
        stop({
          background_tasks: [
            {
              id: 'smde88tmr',
              type: 'monitor',
              status: 'running',
              description:
                'live updates for artifact https://claude.ai/artifact/34189Dye6YKeNgx6J8kKCH (watch requested)'
            }
          ]
        })
      )
    ).toBe(false)
  })

  it('true when a real monitor runs beside an artifact watch', () => {
    expect(
      hasRunningBackgroundWork(
        stop({
          background_tasks: [
            {
              id: 'smde88tmr',
              type: 'monitor',
              status: 'running',
              description:
                'live updates for artifact https://claude.ai/artifact/x (watch requested)'
            },
            { id: 'bkjklu3zy', type: 'monitor', status: 'running', description: 'deploy events' }
          ]
        })
      )
    ).toBe(true)
  })

  it('false for a watch claude re-armed on resume, at a /code/ artifact URL', () => {
    expect(
      hasRunningBackgroundWork(
        stop({
          background_tasks: [
            {
              id: 'sq1',
              type: 'monitor',
              status: 'running',
              description:
                'live updates for artifact https://claude.ai/code/artifact/0b7c (re-armed on session resume)'
            }
          ]
        })
      )
    ).toBe(false)
  })

  it('true for a real monitor whose description only starts like a watch', () => {
    expect(
      hasRunningBackgroundWork(
        stop({
          background_tasks: [
            {
              id: 'bm1',
              type: 'monitor',
              status: 'running',
              description: 'live updates for artifact builds on the CI page'
            }
          ]
        })
      )
    ).toBe(true)
  })

  it('true for a shell whose description reads exactly like a watch', () => {
    expect(
      hasRunningBackgroundWork(
        stop({
          background_tasks: [
            {
              id: 'bs1',
              type: 'shell',
              status: 'running',
              description:
                'live updates for artifact https://claude.ai/artifact/x (watch requested)'
            }
          ]
        })
      )
    ).toBe(true)
  })

  it('false for an empty list — the probe-observed idle shape', () => {
    expect(hasRunningBackgroundWork(stop({ background_tasks: [] }))).toBe(false)
  })

  it('false when every task has finished', () => {
    expect(
      hasRunningBackgroundWork(
        stop({
          background_tasks: [
            { id: 'bA', status: 'completed' },
            { id: 'bB', status: 'failed' }
          ]
        })
      )
    ).toBe(false)
  })

  it('false when the field is absent (an older claude, or another event)', () => {
    expect(hasRunningBackgroundWork(stop())).toBe(false)
  })

  // `status` is NOT enum-locked, matching the project rule for every claude-supplied
  // string: only the exact value we KNOW means "still going" counts as running, and a
  // new/unknown status reads as not-running rather than failing the session closed.
  it('false for an unknown status — never guess a session into silence', () => {
    expect(
      hasRunningBackgroundWork(stop({ background_tasks: [{ id: 'bA', status: 'zombie' }] }))
    ).toBe(false)
  })

  it('never throws on a malformed or non-array field', () => {
    expect(hasRunningBackgroundWork(stop({ background_tasks: 'nope' }))).toBe(false)
    expect(hasRunningBackgroundWork(stop({ background_tasks: null }))).toBe(false)
    expect(hasRunningBackgroundWork(stop({ background_tasks: [null, 42, 'x'] }))).toBe(false)
    expect(hasRunningBackgroundWork(stop({ background_tasks: [{}] }))).toBe(false)
  })
})

describe('runningTaskIds — the ids of the running work, for the sticky ask and the interrupt', () => {
  it('lists each running task id, in payload order', () => {
    expect(
      runningTaskIds(
        stop({
          background_tasks: [
            { id: 'a', type: 'shell', status: 'running' },
            { id: 'b', type: 'shell', status: 'completed' },
            { id: 'c', type: 'monitor', status: 'running', description: 'chat' }
          ]
        })
      )
    ).toEqual(['a', 'c'])
  })

  it('leaves out an artifact watch: it is not work', () => {
    expect(
      runningTaskIds(
        stop({
          background_tasks: [
            {
              id: 'w',
              type: 'monitor',
              status: 'running',
              description:
                'live updates for artifact https://claude.ai/artifact/x1 (watch requested)'
            }
          ]
        })
      )
    ).toEqual([])
  })

  it('leaves out a running task with no string id (it can never be told apart)', () => {
    expect(
      runningTaskIds(
        stop({ background_tasks: [{ status: 'running' }, { id: 7, status: 'running' }] })
      )
    ).toEqual([])
  })

  it('is empty when the field is absent or malformed', () => {
    expect(runningTaskIds(stop())).toEqual([])
    expect(runningTaskIds(stop({ background_tasks: 'x' }))).toEqual([])
  })
})
