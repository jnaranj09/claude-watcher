// UX-13 — the renderer tells main which terminal the focused view shows (null on the board).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent } from '../test/renderComponent'
import { useReportFocusedTerminal } from './useReportFocusedTerminal'
import { boardStore } from '../stores/boardStore'

let report: ReturnType<typeof vi.fn>

function Probe(): null {
  useReportFocusedTerminal()
  return null
}

beforeEach(() => {
  report = vi.fn()
  ;(window as unknown as { attention: unknown }).attention = { reportFocusedTerminal: report }
  boardStore.setState({ viewMode: 'board', focusedTerminalId: 't-1' })
})

afterEach(() => {
  boardStore.setState({ viewMode: 'board', focusedTerminalId: null })
})

describe('useReportFocusedTerminal (UX-13)', () => {
  it('reports null on the board, even with a pinned terminal', () => {
    const { unmount } = renderComponent(<Probe />)
    expect(report.mock.calls).toEqual([[null]])
    unmount()
  })

  it('reports the terminal when the focused view shows it, and again when it changes', () => {
    const { unmount } = renderComponent(<Probe />)
    act(() => boardStore.setState({ viewMode: 'focused' }))
    act(() => boardStore.setState({ focusedTerminalId: 't-2' }))
    act(() => boardStore.setState({ viewMode: 'board' }))
    expect(report.mock.calls).toEqual([[null], ['t-1'], ['t-2'], [null]])
    unmount()
  })
})
