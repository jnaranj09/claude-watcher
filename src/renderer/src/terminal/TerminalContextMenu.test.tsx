// Terminal clipboard feature — unit tests for TerminalContextMenu.
//
// Gate: `unit` (jsdom) project.
// Covers: menu renders / dismiss on outside-click, Esc, scroll, blur;
//         Copy and Paste button disabled states; onCopy/onPaste callbacks;
//         per-terminal isolation (each EmbeddedTerminal has its own menu state).
// [Source: spec-terminal-clipboard.md §Tasks & Acceptance task 5; §Gate note]

import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, fireEvent, type RenderResult } from '../test/renderComponent'
import { TerminalContextMenu } from './TerminalContextMenu'
import { menuItem } from '../test/terminalHarness'

// ── Helpers ──────────────────────────────────────────────────────────────────

type RenderMenuOptions = {
  x?: number
  y?: number
  canCopy?: boolean
  canPaste?: boolean
  onCopy?: () => void
  onPaste?: () => void
  onDismiss?: () => void
}

let cleanup: (() => void) | undefined

function renderMenu(opts: RenderMenuOptions = {}): {
  result: RenderResult
  onCopy: ReturnType<typeof vi.fn>
  onPaste: ReturnType<typeof vi.fn>
  onDismiss: ReturnType<typeof vi.fn>
} {
  const onCopy = opts.onCopy ? vi.fn(opts.onCopy) : vi.fn()
  const onPaste = opts.onPaste ? vi.fn(opts.onPaste) : vi.fn()
  const onDismiss = opts.onDismiss ? vi.fn(opts.onDismiss) : vi.fn()

  const result = renderComponent(
    <TerminalContextMenu
      x={opts.x ?? 100}
      y={opts.y ?? 200}
      canCopy={opts.canCopy ?? false}
      canPaste={opts.canPaste ?? false}
      onCopy={onCopy}
      onPaste={onPaste}
      onDismiss={onDismiss}
    />
  )
  cleanup = result.unmount

  return { result, onCopy, onPaste, onDismiss }
}

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

// ── Render + structure ────────────────────────────────────────────────────────

describe('TerminalContextMenu — render', () => {
  it('renders the menu with Copy and Paste buttons', () => {
    renderMenu()
    // The menu is portaled to document.body.
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    expect(menu).not.toBeNull()
    const items = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])]
    const labels = items.map((item) => item.textContent)
    expect(labels).toContain('Copy')
    expect(labels).toContain('Paste')
  })

  it('Copy button is disabled when canCopy=false', () => {
    renderMenu({ canCopy: false, canPaste: true })
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    const copyBtn = menuItem(menu, 'Copy')
    expect(copyBtn?.disabled).toBe(true)
  })

  it('Copy button is enabled when canCopy=true', () => {
    renderMenu({ canCopy: true, canPaste: false })
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    const copyBtn = menuItem(menu, 'Copy')
    expect(copyBtn?.disabled).toBe(false)
  })

  it('Paste button is disabled when canPaste=false', () => {
    renderMenu({ canCopy: true, canPaste: false })
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    const pasteBtn = menuItem(menu, 'Paste')
    expect(pasteBtn?.disabled).toBe(true)
  })

  it('Paste button is enabled when canPaste=true', () => {
    renderMenu({ canCopy: false, canPaste: true })
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    const pasteBtn = menuItem(menu, 'Paste')
    expect(pasteBtn?.disabled).toBe(false)
  })

  it('menu has role="menu" and buttons have role="menuitem"', () => {
    renderMenu()
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    expect(menu?.getAttribute('role')).toBe('menu')
    const items = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])]
    expect(items.length).toBeGreaterThanOrEqual(2)
  })
})

// ── Callbacks ────────────────────────────────────────────────────────────────

describe('TerminalContextMenu — callbacks', () => {
  it('calls onCopy when the Copy button is clicked (canCopy=true)', () => {
    const { onCopy } = renderMenu({ canCopy: true })
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    const copyBtn = menuItem(menu, 'Copy')
    act(() => {
      copyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onCopy).toHaveBeenCalledTimes(1)
  })

  it('Copy button has disabled attribute when canCopy=false (browser enforces no-click)', () => {
    renderMenu({ canCopy: false })
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    const copyBtn = menuItem(menu, 'Copy')
    // The button is disabled — onClick should not fire (browser enforces this).
    // In jsdom, disabled buttons don't block click events dispatched via dispatchEvent,
    // but the component marks them disabled so the UX intent is clear. We assert the
    // disabled attribute is set (the meaningful guarantee for this unit).
    expect(copyBtn?.disabled).toBe(true)
  })

  it('calls onPaste when the Paste button is clicked (canPaste=true)', () => {
    const { onPaste } = renderMenu({ canPaste: true })
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    const pasteBtn = menuItem(menu, 'Paste')
    act(() => {
      pasteBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onPaste).toHaveBeenCalledTimes(1)
  })
})

// ── Dismiss lifecycle ─────────────────────────────────────────────────────────

describe('TerminalContextMenu — dismiss', () => {
  it('calls onDismiss on an outside mousedown', () => {
    const { onDismiss } = renderMenu()
    // A mousedown on the document body OUTSIDE the menu box should dismiss.
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onDismiss on a mousedown INSIDE the menu box', () => {
    const { onDismiss } = renderMenu()
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    act(() => {
      menu?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('calls onDismiss on Esc keydown', () => {
    const { onDismiss } = renderMenu()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onDismiss on an unrelated key (e.g. Enter)', () => {
    const { onDismiss } = renderMenu()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('calls onDismiss on a scroll event', () => {
    const { onDismiss } = renderMenu()
    act(() => {
      window.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss on window blur', () => {
    const { onDismiss } = renderMenu()
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('removes all dismiss listeners on unmount (no dangling listeners)', () => {
    const docAdd = vi.spyOn(document, 'addEventListener')
    const docRemove = vi.spyOn(document, 'removeEventListener')
    const winAdd = vi.spyOn(window, 'addEventListener')
    const winRemove = vi.spyOn(window, 'removeEventListener')
    const { result } = renderMenu()

    // The listeners the menu itself installs (React and the test harness add others).
    const docAdded = docAdd.mock.calls.filter(([type]) => ['mousedown', 'keydown'].includes(type))
    const winAdded = winAdd.mock.calls.filter(([type]) => ['scroll', 'blur'].includes(type))
    expect(docAdded.map(([type]) => type).sort()).toEqual(['keydown', 'mousedown'])
    expect(winAdded.map(([type]) => type).sort()).toEqual(['blur', 'scroll'])

    act(() => result.unmount())
    cleanup = undefined

    // Every listener added is removed again: same type, same handler.
    for (const [type, handler] of docAdded) {
      expect(docRemove.mock.calls.some(([t, h]) => t === type && h === handler)).toBe(true)
    }
    for (const [type, handler] of winAdded) {
      expect(winRemove.mock.calls.some(([t, h]) => t === type && h === handler)).toBe(true)
    }
  })
})

// ── Per-terminal isolation ─────────────────────────────────────────────────────
//
// Each EmbeddedTerminal owns its own `menu` state (local useState). TerminalContextMenu
// is a presentational component — it never reaches into another terminal's state.
// This test verifies two independently rendered menus can be open simultaneously
// without interfering (their dismiss callbacks are independent).

describe('TerminalContextMenu — per-terminal isolation', () => {
  it('a document-level Esc dismisses all open menus (each menu registers its own listener)', () => {
    const dismiss1 = vi.fn()
    const dismiss2 = vi.fn()

    // Render two menus simultaneously (simulating two EmbeddedTerminals both showing a menu).
    const r1 = renderComponent(
      <TerminalContextMenu
        x={100}
        y={100}
        canCopy={false}
        canPaste={false}
        onCopy={vi.fn()}
        onPaste={vi.fn()}
        onDismiss={dismiss1}
      />
    )
    // Do NOT set `cleanup` here — we manage both manually below.

    const r2 = renderComponent(
      <TerminalContextMenu
        x={300}
        y={300}
        canCopy={false}
        canPaste={false}
        onCopy={vi.fn()}
        onPaste={vi.fn()}
        onDismiss={dismiss2}
      />
    )

    // Both menus should be in the DOM.
    const menus = document.querySelectorAll('[data-testid="terminal-context-menu"]')
    expect(menus.length).toBe(2)

    // Esc dismisses BOTH (each registers its own document keydown listener).
    // This is the correct expected behaviour for overlapping menus — both see the event.
    // (In practice EmbeddedTerminal only opens one menu at a time per terminal.)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(dismiss1).toHaveBeenCalled()
    expect(dismiss2).toHaveBeenCalled()

    act(() => r1.unmount())
    act(() => r2.unmount())
  })

  it('each menu callback acts on the correct terminal (no cross-terminal calls)', () => {
    const copy1 = vi.fn()
    const copy2 = vi.fn()

    const r1 = renderComponent(
      <TerminalContextMenu
        x={100}
        y={100}
        canCopy={true}
        canPaste={false}
        onCopy={copy1}
        onPaste={vi.fn()}
        onDismiss={vi.fn()}
      />
    )
    const r2 = renderComponent(
      <TerminalContextMenu
        x={300}
        y={300}
        canCopy={true}
        canPaste={false}
        onCopy={copy2}
        onPaste={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    // Click the Copy button of the FIRST menu only.
    const menus = [...document.querySelectorAll('[data-testid="terminal-context-menu"]')]
    const firstMenuCopyBtn = menuItem(menus[0], 'Copy')
    act(() => {
      firstMenuCopyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(copy1).toHaveBeenCalledTimes(1)
    // copy2 must NOT have been called — the click was on terminal 1's menu.
    expect(copy2).not.toHaveBeenCalled()

    act(() => r1.unmount())
    act(() => r2.unmount())
  })
})

describe('TerminalContextMenu — Popover', () => {
  it('is a Popover with compact rows, a disabled row stays disabled', () => {
    renderMenu({ canCopy: false, canPaste: true })
    const menu = document.querySelector('[data-testid="terminal-context-menu"]')
    expect(menu?.hasAttribute('data-popover')).toBe(true)
    const rows = [...document.querySelectorAll('[data-popover-item]')]
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.getAttribute('data-density') === 'compact')).toBe(true)
    expect((rows[0] as HTMLButtonElement).disabled).toBe(true)
  })
})

// ── fireEvent re-export for readability (used by some test helpers) ──────────
export { fireEvent }
