// Action feedback (spec 2026-09-29 §2.3) — Quit anyway is busy while main answers (one press, one
// confirm) and a refusal says so; a refused Cancel is caught and logged (the guard is the feedback).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { QuitGuard } from './QuitGuard'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { toastStore } from '../../stores/toastStore'
import type { QuitGuardPayload } from '../../../../shared/ipc/contract'

const PAYLOAD: QuitGuardPayload = { total: 1, workingCount: 0, sessions: [] }

let r: RenderResult | undefined
let confirm: ReturnType<typeof vi.fn>
let cancel: ReturnType<typeof vi.fn>
let answer: () => void = () => {}
let refuse: (e: Error) => void = () => {}

beforeEach(() => {
  confirm = vi.fn(
    () =>
      new Promise<void>((res, rej) => {
        answer = () => res()
        refuse = (e) => rej(e)
      })
  )
  cancel = vi.fn(() => Promise.resolve())
  ;(window as unknown as { quit: unknown }).quit = {
    requestQuit: vi.fn(() => Promise.resolve()),
    confirm,
    cancel,
    onGuardShow: vi.fn(() => () => {})
  }
  toastStore.setState({ toasts: [] })
})
afterEach(() => {
  r?.unmount()
  r = undefined
  vi.restoreAllMocks()
})

function el(id: string): HTMLButtonElement {
  const found = r?.container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
  if (found === null || found === undefined) throw new Error(`missing ${id}`)
  return found
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('QuitGuard — feedback', () => {
  it('Quit anyway is busy while main answers; a second press sends nothing', async () => {
    r = renderComponent(<QuitGuard payload={PAYLOAD} />)
    act(() => el('quit-guard-confirm').click())
    expect(el('quit-guard-confirm').getAttribute('aria-busy')).toBe('true')
    act(() => el('quit-guard-confirm').click())
    expect(confirm).toHaveBeenCalledTimes(1)
    answer()
    await settle()
  })

  it('a refused Quit anyway says so in a toast', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    r = renderComponent(<QuitGuard payload={PAYLOAD} />)
    act(() => el('quit-guard-confirm').click())
    refuse(new Error('x'))
    await settle()
    expect(toastStore.getState().toasts.map((t) => [t.kind, t.title])).toEqual([
      ['error', 'Could not quit the app.']
    ])
    expect(el('quit-guard-confirm').hasAttribute('aria-busy')).toBe(false)
  })

  it('a refused Cancel is caught and logged by code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    cancel.mockImplementation(() => Promise.reject(new Error('x')))
    r = renderComponent(<QuitGuard payload={PAYLOAD} />)
    act(() => el('quit-guard-cancel').click())
    await settle()
    expect(warn).toHaveBeenCalledWith('[claude-watcher][quit] code=quit_cancel_failed')
  })
})
