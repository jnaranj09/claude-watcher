// Action feedback (spec 2026-09-29 §2.3) — a workspace switch main refuses says so (it used to be
// swallowed here), and the caller learns it failed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActiveWorkspace, workspacesStore } from './workspacesStore'
import { toastStore } from './toastStore'

beforeEach(() => {
  workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: true })
  toastStore.setState({ toasts: [] })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('setActiveWorkspace', () => {
  it('resolves true and takes main value on success', async () => {
    ;(window as unknown as { workspaces: unknown }).workspaces = {
      setActive: vi.fn(() => Promise.resolve({ activeId: 'w1', workspaces: [] }))
    }
    expect(await setActiveWorkspace('w1')).toBe(true)
    expect(workspacesStore.getState().activeId).toBe('w1')
    expect(toastStore.getState().toasts).toEqual([])
  })

  it('resolves false, keeps the pointer, and toasts Could not switch workspace. on a refusal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;(window as unknown as { workspaces: unknown }).workspaces = {
      setActive: vi.fn(() => Promise.reject(new Error('x')))
    }
    expect(await setActiveWorkspace('w1')).toBe(false)
    expect(workspacesStore.getState().activeId).toBe('default')
    expect(toastStore.getState().toasts.map((t) => [t.kind, t.title])).toEqual([
      ['error', 'Could not switch workspace.']
    ])
  })
})
