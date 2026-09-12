// Story 2.4 — the attention→sound WIRING tests (jsdom `unit` project).
//
// Mounts useAttentionSound with a FAKE player + a controllable `soundEnabled` getter, against a
// stubbed window.watch.onEvents. Asserts (AC-1/2/3):
//   - an `attention.raised` delta with sound ENABLED → play() called EXACTLY once;
//   - the SAME delta with sound MUTED → play() NOT called (and a mute change takes effect
//     immediately on the next event — no restart);
//   - `session.updated` / `session.removed` deltas NEVER play;
//   - two `attention.raised` events → TWO plays (NO debounce — AC-2).
// [Source: story 2.4 Task 5.4; AC-1/2/3; Board.test.tsx window-stub style]
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { useAttentionSound } from './useAttentionSound'
import type { AttentionSound } from './attentionSound'
import { renderComponent } from '../test/renderComponent'
import type { WatchEventsPayload, AttentionReminderPayload } from '../../../shared/ipc/contract'

/** The shape the hook needs off window.watch (mirrors the preload WatchApi). */
interface WatchBridge {
  onEvents(cb: (payload: WatchEventsPayload) => void): () => void
  onStatus(cb: (status: { reconnecting: boolean }) => void): () => void
}

/** The shape the hook needs off window.attention (mirrors the preload AttentionApi). */
interface AttentionBridge {
  onActivate(cb: (payload: { id: string }) => void): () => void
  onReminder(cb: (payload: AttentionReminderPayload) => void): () => void
}

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

/** Stub window.watch + window.attention and capture the registered callbacks so a test can push
 *  a delta or a reminder through the real seam. */
function stubWatch(): {
  push: (payload: WatchEventsPayload) => void
  pushReminder: (id: string) => void
} {
  let eventsCb: ((payload: WatchEventsPayload) => void) | undefined
  let reminderCb: ((payload: AttentionReminderPayload) => void) | undefined
  const watch: WatchBridge = {
    onEvents: (cb) => {
      eventsCb = cb
      return () => {
        eventsCb = undefined
      }
    },
    onStatus: () => () => {}
  }
  const attention: AttentionBridge = {
    onActivate: () => () => {},
    onReminder: (cb) => {
      reminderCb = cb
      return () => {
        reminderCb = undefined
      }
    }
  }
  ;(window as unknown as { watch: WatchBridge }).watch = watch
  ;(window as unknown as { attention: AttentionBridge }).attention = attention
  return {
    push: (payload) =>
      act(() => {
        eventsCb?.(payload)
      }),
    pushReminder: (id) =>
      act(() => {
        reminderCb?.({ id })
      })
  }
}

/** A tiny harness component that mounts the hook with injected seams. */
function Harness({ sound, enabled }: { sound: AttentionSound; enabled: () => boolean }): null {
  useAttentionSound(sound, enabled)
  return null
}

function raised(epoch: number, id: string): WatchEventsPayload {
  return {
    epoch,
    event: {
      type: 'attention.raised',
      id,
      sessionName: `s-${id}`,
      projectPath: `/p/${id}`,
      status: 'NeedsAttention',
      timestamp: epoch
    }
  }
}

function updated(epoch: number, id: string): WatchEventsPayload {
  return {
    epoch,
    event: {
      type: 'session.updated',
      id,
      sessionName: `s-${id}`,
      projectPath: `/p/${id}`,
      status: 'Working',
      column: 'working',
      enteredColumnAt: epoch,
      pid: 1,
      workspaceId: 'default',
      tagIds: []
    }
  }
}

function removed(epoch: number, id: string): WatchEventsPayload {
  return {
    epoch,
    event: { type: 'session.removed', id, sessionName: `s-${id}`, projectPath: `/p/${id}` }
  }
}

describe('useAttentionSound — plays 1:1 off attention.raised when enabled (AC-1/2/3)', () => {
  it('an attention.raised with sound ENABLED plays exactly once', () => {
    const watch = stubWatch()
    const play = vi.fn()
    const { unmount } = renderComponent(<Harness sound={{ play }} enabled={() => true} />)
    cleanup = unmount

    watch.push(raised(1, 'a'))
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('with sound MUTED, an attention.raised does NOT play', () => {
    const watch = stubWatch()
    const play = vi.fn()
    const { unmount } = renderComponent(<Harness sound={{ play }} enabled={() => false} />)
    cleanup = unmount

    watch.push(raised(1, 'a'))
    expect(play).not.toHaveBeenCalled()
  })

  it('a mute change takes effect IMMEDIATELY on the next event (live read, no restart)', () => {
    const watch = stubWatch()
    const play = vi.fn()
    let enabled = true
    const { unmount } = renderComponent(<Harness sound={{ play }} enabled={() => enabled} />)
    cleanup = unmount

    watch.push(raised(1, 'a'))
    expect(play).toHaveBeenCalledTimes(1)
    enabled = false // mute mid-session
    watch.push(raised(2, 'b'))
    expect(play).toHaveBeenCalledTimes(1) // still 1 — the mute took effect immediately
  })

  it('session.updated and session.removed deltas NEVER play', () => {
    const watch = stubWatch()
    const play = vi.fn()
    const { unmount } = renderComponent(<Harness sound={{ play }} enabled={() => true} />)
    cleanup = unmount

    watch.push(updated(1, 'a'))
    watch.push(removed(2, 'a'))
    expect(play).not.toHaveBeenCalled()
  })

  it('two attention.raised events → TWO plays (NO debounce — AC-2)', () => {
    const watch = stubWatch()
    const play = vi.fn()
    const { unmount } = renderComponent(<Harness sound={{ play }} enabled={() => true} />)
    cleanup = unmount

    watch.push(raised(1, 'a'))
    watch.push(raised(2, 'b'))
    expect(play).toHaveBeenCalledTimes(2)
  })
})

// Attention reminders (spec 2026-09-10 D-4) — main re-notified a session still blocked on you.
describe('useAttentionSound — plays on a reminder push, same live mute', () => {
  it('a reminder with sound ENABLED plays exactly once', () => {
    const watch = stubWatch()
    const play = vi.fn()
    const { unmount } = renderComponent(<Harness sound={{ play }} enabled={() => true} />)
    cleanup = unmount
    watch.pushReminder('a')
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('with sound MUTED, a reminder does NOT play', () => {
    const watch = stubWatch()
    const play = vi.fn()
    const { unmount } = renderComponent(<Harness sound={{ play }} enabled={() => false} />)
    cleanup = unmount
    watch.pushReminder('a')
    expect(play).not.toHaveBeenCalled()
  })

  it('unmount unsubscribes from the reminder push', () => {
    const watch = stubWatch()
    const play = vi.fn()
    const { unmount } = renderComponent(<Harness sound={{ play }} enabled={() => true} />)
    unmount()
    watch.pushReminder('a')
    expect(play).not.toHaveBeenCalled()
  })
})
