// Action feedback (spec 2026-09-29 §2.3) — the confirm's Delete is busy while main answers (one
// press, one delete), and a refused delete keeps the terminal and says so in a toast.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { StopConfirm } from './StopConfirm'
import { renderComponent } from '../../test/renderComponent'
import { boardStore } from '../../stores/boardStore'
import { toastStore } from '../../stores/toastStore'
import { deferred, type Deferred } from '../../test/deferred'

let cleanup: (() => void) | undefined
let pending: Deferred<void>
let del: ReturnType<typeof vi.fn>

beforeEach(() => {
  pending = deferred<void>()
  del = vi.fn(() => pending.promise)
  ;(window as unknown as { launch: unknown }).launch = { deleteSession: del }
  act(() => {
    boardStore.setState({
      stopConfirm: { terminalId: 'term-1', sessionId: 'sess-1', sessionName: 'deploy' },
      viewMode: 'focused',
      focusedTerminalId: 'term-1',
      launchedTerminals: {
        'term-1': { terminalId: 'term-1', launchedAt: 1, label: 'deploy', workspaceId: 'default' }
      }
    })
  })
  toastStore.setState({ toasts: [] })
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
  act(() => boardStore.setState({ stopConfirm: null, viewMode: 'board', focusedTerminalId: null }))
})

function mount(): HTMLButtonElement {
  const payload = { terminalId: 'term-1', sessionId: 'sess-1', sessionName: 'deploy' }
  const r = renderComponent(<StopConfirm payload={payload} />)
  cleanup = r.unmount
  const btn = r.container.querySelector<HTMLButtonElement>('[data-testid="stop-confirm-stop"]')
  if (btn === null) throw new Error('no Delete')
  return btn
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('StopConfirm — Delete feedback', () => {
  it('Delete is busy while main answers; a second press sends nothing', async () => {
    const btn = mount()
    act(() => btn.click())
    expect(btn.getAttribute('aria-busy')).toBe('true')
    act(() => btn.click())
    expect(del).toHaveBeenCalledTimes(1)
    pending.resolve(undefined)
    await settle()
    expect(boardStore.getState().stopConfirm).toBeNull()
  })

  it('a refused delete keeps the terminal and toasts Could not delete', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const btn = mount()
    act(() => btn.click())
    pending.reject(new Error('boom'))
    await settle()
    expect(boardStore.getState().launchedTerminals['term-1']).toBeDefined()
    expect(toastStore.getState().toasts.map((t) => [t.kind, t.title])).toEqual([
      ['error', 'Could not delete "deploy".']
    ])
  })
})
