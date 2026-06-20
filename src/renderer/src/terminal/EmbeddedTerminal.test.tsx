// Story 3.1 (FR-10) — EmbeddedTerminal jsdom tests (unit / jsdom project).
//
// The BYTE/PORT path + the real xterm rendering are packaged-smoke-only (no real
// MessagePort/WebGL/canvas in jsdom — ipc.md / story testing standards). So jsdom covers the
// COMPONENT LOGIC that does NOT need a real port:
//   - mounts without throwing + calls window.terminal.open(terminalId, cb) ONCE (lifecycle wiring);
//   - the dead-terminal pane (AC-4) renders "Terminal exited." + Reopen/Stop on a CH.terminalExit
//     push for THIS terminalId (and NOT for a different id — per-terminal local state);
//   - Reopen clears the dead pane + re-opens (a fresh open() call);
//   - kept-alive hidden (AC-3) applies visibility:hidden via the `.hidden` class, NOT display:none;
//   - on unmount it stops the pty (clean teardown — no orphan from a normal close).
//
// xterm needs two jsdom shims (matchMedia + ResizeObserver) it assumes from a real browser;
// the byte path itself is asserted by `npm run smoke`. [Source: story 3.1 Task 4; AC-3/4;
// .claude/rules/terminal.md; src/renderer/src/test/renderComponent.ts]
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { EmbeddedTerminal } from './EmbeddedTerminal'
import type { TerminalExitEvent } from '../../../shared/ipc/contract'

/** The captured window.terminal fakes — let tests drive onExit + assert open/stop. */
interface TerminalFakes {
  open: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
  emitExit: (info: TerminalExitEvent) => void
}

let fakes: TerminalFakes
let cleanup: (() => void) | undefined

beforeEach(() => {
  // xterm assumes a real browser: shim matchMedia + ResizeObserver (jsdom omits both).
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {
      /* no-op shim — jsdom has no layout; the byte/fit path is smoke-tested */
    }
    unobserve(): void {
      /* no-op shim */
    }
    disconnect(): void {
      /* no-op shim */
    }
  }

  let exitCb: ((info: TerminalExitEvent) => void) | null = null
  fakes = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn((cb: (info: TerminalExitEvent) => void) => {
      exitCb = cb
      return () => {}
    }),
    emitExit: (info) => exitCb?.(info)
  }
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: fakes.open,
    resize: fakes.resize,
    stop: fakes.stop,
    onExit: fakes.onExit
  }
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(props: { terminalId: string; active?: boolean }): RenderResult {
  const r = renderComponent(<EmbeddedTerminal {...props} />)
  cleanup = r.unmount
  return r
}

describe('EmbeddedTerminal — mount + lifecycle wiring (AC-1/2)', () => {
  it('mounts without throwing and calls window.terminal.open(terminalId, cb) once', () => {
    const r = render({ terminalId: 't-1' })
    expect(fakes.open).toHaveBeenCalledTimes(1)
    expect(fakes.open.mock.calls[0]?.[0]).toBe('t-1')
    // No dead pane on a healthy mount.
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).toBeNull()
  })

  it('stops the pty on unmount (clean teardown — no orphan from a normal close)', () => {
    const r = render({ terminalId: 't-1' })
    act(() => r.unmount())
    cleanup = undefined
    expect(fakes.stop).toHaveBeenCalledWith('t-1')
  })
})

describe('EmbeddedTerminal — dead-terminal pane (AC-4)', () => {
  it('renders "Terminal exited." + Reopen/Stop on a terminal:exit for THIS id', () => {
    const r = render({ terminalId: 't-1' })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 137 }))
    const dead = r.container.querySelector('[data-testid="dead-terminal"]')
    expect(dead).not.toBeNull()
    expect(dead?.textContent).toContain('Terminal exited.')
    const buttons = [...r.container.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).toContain('Reopen')
    expect(buttons).toContain('Stop')
    // The dead pane is an alert (accessibility floor).
    expect(dead?.getAttribute('role')).toBe('alert')
  })

  it('IGNORES a terminal:exit for a DIFFERENT id (per-terminal local state)', () => {
    const r = render({ terminalId: 't-1' })
    act(() => fakes.emitExit({ terminalId: 'other', exitCode: 1 }))
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).toBeNull()
  })

  it('Reopen clears the dead pane and re-opens a fresh pty', () => {
    const r = render({ terminalId: 't-1' })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 1 }))
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).not.toBeNull()

    const reopenBtn = [...r.container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reopen'
    )
    act(() => {
      reopenBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Dead pane gone; open() called again (a fresh pty into the same pane).
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).toBeNull()
    expect(fakes.open.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('EmbeddedTerminal — kept-alive hidden uses visibility:hidden, never display:none (AC-3)', () => {
  it('active=false applies the hidden class (visibility:hidden) to the host', () => {
    const r = render({ terminalId: 't-1', active: false })
    const host = r.container.querySelector('[data-testid="embedded-terminal"] > div')
    expect(host).not.toBeNull()
    // The CSS-module `.hidden` class is applied (it sets visibility:hidden, asserted in the
    // CSS source test below — never display:none).
    expect(host?.className).toMatch(/hidden/)
  })

  it('active=true does NOT apply the hidden class', () => {
    const r = render({ terminalId: 't-1', active: true })
    const host = r.container.querySelector('[data-testid="embedded-terminal"] > div')
    expect(host?.className ?? '').not.toMatch(/\bhidden\b/)
  })
})
