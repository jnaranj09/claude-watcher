// Story 3.1 (FR-10) — TerminalHost tests (unit / jsdom project; code-review m-4).
//
// The load-bearing property: re-rendering the host with the SAME count must NOT change the
// terminalIds passed to the EmbeddedTerminal children (the ids are memoized). If the ids
// changed on a re-render, React would tear down + recreate every terminal (a new mount → a new
// window.terminal.open) — exactly the "board re-renders never thrash the terminal" guarantee
// terminal.md exists to protect. We assert that by counting window.terminal.open calls across a
// re-render: stable ids → no extra opens. [Source: code-review m-4; .claude/rules/terminal.md]
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { stubXtermBrowserApis } from '../test/terminalHarness'
import { TerminalHost } from './TerminalHost'

let openCalls: string[]
let cleanup: (() => void) | undefined

beforeEach(() => {
  // xterm jsdom shims (matchMedia + ResizeObserver) so the children mount without throwing.
  stubXtermBrowserApis()
  openCalls = []
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn((terminalId: string) => {
      openCalls.push(terminalId)
      return () => {}
    }),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => () => {})
  }
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

describe('TerminalHost — stable ids across re-render (terminal.md / m-4)', () => {
  it('mounts `count` terminals with distinct ids', () => {
    const r: RenderResult = renderComponent(<TerminalHost count={3} />)
    cleanup = r.unmount
    expect(openCalls).toHaveLength(3)
    expect(new Set(openCalls).size).toBe(3) // all distinct
  })

  it('a re-render with the SAME count does NOT re-open the terminals (ids are stable)', () => {
    const r: RenderResult = renderComponent(<TerminalHost count={2} />)
    cleanup = r.unmount
    expect(openCalls).toHaveLength(2)
    const idsAfterMount = [...openCalls]

    // Re-render the host with the same count — React reuses the same child instances because
    // the ids (and thus keys) are unchanged → NO new mounts → NO new open() calls.
    act(() => {
      r.root.render(<TerminalHost count={2} />)
    })
    expect(openCalls).toEqual(idsAfterMount) // unchanged — no extra opens
  })
})
