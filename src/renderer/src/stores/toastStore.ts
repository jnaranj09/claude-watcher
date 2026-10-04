// Action feedback (spec 2026-09-29 §1.1) — the toast list (RENDERER VIEW-STATE, state.md), a
// singleton like the other stores. A toast is for a board-level action or a result the operator
// cannot see (archive, move, a menu that closed); a dialog NEVER raises one for its own result.
//
// At most TOAST_MAX on screen (a 4th drops the oldest at once). Success/info close after TOAST_MS,
// TOAST_ACTION_MS with an action; an error stays until dismissed. Hover/focus pauses a toast's
// timer and leaving resumes it with the time it had left. Timers live BESIDE the state (a handle
// is not view-state) and run on an injected clock, so tests drive time by hand.
//
// An action runs once: the toast closes when `run` is called, and the store never awaits it. A throw
// or rejection is contained (never surfaced) — a caller that can fail maps the code and pushes its
// own error toast.
//
// A toast holds operator-visible copy only, and the store never logs one.
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { WorkspaceTone } from '../components/WorkspaceTint/workspaceTint'
import { MOTION_EXIT_MS } from '../styles/motion'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  run: () => void | Promise<void>
}

/** A workspace named in a toast is drawn as its tint (design.md): a `WorkspaceLabel`. */
export interface ToastWorkspace {
  name: string
  tone: WorkspaceTone
}

export interface Toast {
  id: string
  kind: ToastKind
  title: string
  /** One line under the title, `--text-secondary`, truncated with a `title`. */
  detail?: string
  action?: ToastAction
  /** Drawn after the title (`Moved "api" to <WorkspaceLabel>`). */
  workspace?: ToastWorkspace
  /** True while it fades out; it is removed TOAST_EXIT_MS later. */
  leaving: boolean
}

export type ToastInput = Omit<Toast, 'id' | 'leaving'>
export type ToastOptions = Omit<ToastInput, 'kind' | 'title'>

export const TOAST_MAX = 3
export const TOAST_MS = 5000
export const TOAST_ACTION_MS = 6000
/** The fade-out before removal: the shared overlay exit (styles/motion.ts). */
export const TOAST_EXIT_MS = MOTION_EXIT_MS

export interface ToastClock {
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

/** Reads the globals at call time, so `vi.useFakeTimers()` reaches the singleton too. */
export const realClock: ToastClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export interface ToastState {
  toasts: Toast[]
  push: (input: ToastInput) => string
  dismiss: (id: string) => void
  pause: (id: string) => void
  resume: (id: string) => void
  runAction: (id: string) => void
}

function lifetime(input: ToastInput): number | null {
  if (input.kind === 'error') return null
  return input.action !== undefined ? TOAST_ACTION_MS : TOAST_MS
}

export function createToastStore(clock: ToastClock = realClock): StoreApi<ToastState> {
  let seq = 0
  const running = new Map<string, { handle: unknown; startedAt: number; remaining: number }>()
  const paused = new Map<string, number>()

  return createStore<ToastState>((set, get) => {
    function stop(id: string): void {
      const timer = running.get(id)
      if (timer !== undefined) clock.clearTimer(timer.handle)
      running.delete(id)
      paused.delete(id)
    }
    function arm(id: string, ms: number): void {
      const handle = clock.setTimer(() => get().dismiss(id), ms)
      running.set(id, { handle, startedAt: clock.now(), remaining: ms })
    }
    function remove(id: string): void {
      stop(id)
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }

    return {
      toasts: [],

      push: (input) => {
        seq += 1
        const id = `toast-${seq}`
        const live = get().toasts.filter((t) => !t.leaving)
        const evicted = new Set(
          live.slice(0, Math.max(0, live.length - TOAST_MAX + 1)).map((t) => t.id)
        )
        for (const gone of evicted) stop(gone)
        set((s) => ({
          toasts: [...s.toasts.filter((t) => !evicted.has(t.id)), { ...input, id, leaving: false }]
        }))
        const ms = lifetime(input)
        if (ms !== null) arm(id, ms)
        return id
      },

      dismiss: (id) => {
        const current = get().toasts.find((t) => t.id === id)
        if (current === undefined || current.leaving) return
        stop(id)
        set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }))
        clock.setTimer(() => remove(id), TOAST_EXIT_MS)
      },

      pause: (id) => {
        const timer = running.get(id)
        if (timer === undefined) return
        clock.clearTimer(timer.handle)
        running.delete(id)
        paused.set(id, Math.max(0, timer.remaining - (clock.now() - timer.startedAt)))
      },

      resume: (id) => {
        const remaining = paused.get(id)
        if (remaining === undefined) return
        paused.delete(id)
        arm(id, remaining)
      },

      runAction: (id) => {
        const current = get().toasts.find((t) => t.id === id)
        if (current?.action === undefined || current.leaving) return
        get().dismiss(id)
        // The toast is already closing; a throw must not reach the click handler (nor leave a
        // rejection unhandled). A caller that can fail pushes its own error toast.
        try {
          void Promise.resolve(current.action.run()).catch(() => {})
        } catch {
          /* synchronous throw: contained, same as above */
        }
      }
    }
  })
}

export const toastStore = createToastStore()

export const selectToasts = (s: ToastState): Toast[] => s.toasts

export const toast = {
  success: (title: string, opts: ToastOptions = {}): string =>
    toastStore.getState().push({ kind: 'success', title, ...opts }),
  error: (title: string, opts: ToastOptions = {}): string =>
    toastStore.getState().push({ kind: 'error', title, ...opts }),
  info: (title: string, opts: ToastOptions = {}): string =>
    toastStore.getState().push({ kind: 'info', title, ...opts })
}
