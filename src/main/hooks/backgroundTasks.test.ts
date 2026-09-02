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
import { hasRunningBackgroundWork, reportsBackgroundTasks } from './backgroundTasks'
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

// `reportsBackgroundTasks` answers a DIFFERENT question from `hasRunningBackgroundWork`:
// not "is work running?" but "did claude state an answer at all?". They differ on exactly
// the cases that matter — an event with no field, and an event whose field is malformed —
// and conflating them is what would let a mid-turn PreToolUse wipe a live verdict.
describe('reportsBackgroundTasks — did this event state a verdict at all?', () => {
  const ev = (background_tasks?: unknown): HookEvent =>
    (background_tasks === undefined
      ? { session_id: 's', hook_event_name: 'Stop' }
      : { session_id: 's', hook_event_name: 'Stop', background_tasks }) as unknown as HookEvent

  it('is false when the field is absent (every mid-turn event)', () => {
    expect(reportsBackgroundTasks(ev())).toBe(false)
  })

  it('is TRUE for an empty list — "nothing running" is a real answer', () => {
    expect(reportsBackgroundTasks(ev([]))).toBe(true)
  })

  it('is true for a populated list', () => {
    expect(reportsBackgroundTasks(ev([{ id: 't', type: 'shell', status: 'running' }]))).toBe(true)
  })

  it('is false for a malformed (non-array) field — a drift states nothing', () => {
    expect(reportsBackgroundTasks(ev('nope'))).toBe(false)
    expect(reportsBackgroundTasks(ev({ a: 1 }))).toBe(false)
    expect(reportsBackgroundTasks(ev(null))).toBe(false)
  })
})
