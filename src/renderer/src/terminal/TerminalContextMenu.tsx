// Terminal clipboard feature — the renderer-drawn context menu (Copy / Paste).
//
// Rendered as a React portal into document.body (position:fixed via the CSS module)
// so it escapes the terminal frame's `overflow:hidden` clip and appears above every
// stacked kept-alive terminal frame at z-index 1000. This avoids the stacking-context
// problem described in .claude/rules/troubleshooting.md (blank-2nd-terminal).
//
// Menu state (open/position) lives as `useState` in the PARENT `EmbeddedTerminal` —
// this component is purely presentational (receives all state + callbacks as props).
// xterm + selection are NEVER here: they stay in refs in the parent (terminal.md / state.md).
//
// Dismiss fires on: outside mousedown, Esc keydown, any scroll, window blur.
// [Source: spec-terminal-clipboard.md; .claude/rules/terminal.md; .claude/rules/state.md]

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Popover } from '../components/Popover/Popover'
import styles from './TerminalContextMenu.module.css'

export interface TerminalContextMenuProps {
  /** Cursor position (viewport pixels) where the menu anchors (from contextmenu event). */
  x: number
  y: number
  /** Copy enabled only when the terminal has a non-empty selection (`term.hasSelection()`). */
  canCopy: boolean
  /** Paste enabled only when `clipboard.readText()` returned a non-empty string. */
  canPaste: boolean
  /** Called when the Copy entry is clicked (parent handles writeText + menu dismiss). */
  onCopy: () => void
  /** Called when the Paste entry is clicked (parent handles readText + term.paste). */
  onPaste: () => void
  /**
   * Called when the menu should close (outside click / Esc / scroll / blur).
   * The parent MUST pass a STABLE callback (e.g. wrapped with useCallback) so that
   * adding it to the effect's dep array does not cause listener churn on every render.
   */
  onDismiss: () => void
}

/**
 * Renderer-drawn right-click menu with Copy and Paste entries.
 *
 * Portaled to `document.body` so position:fixed renders relative to the viewport,
 * not to any ancestor's stacking context. The parent `EmbeddedTerminal` owns open/close
 * state and passes it down as a conditional render (unmounting this component cleans up
 * all dismiss listeners automatically via the useEffect return).
 *
 * `onDismiss` must be a stable reference (useCallback in the parent) — it is in the
 * effect's dep array so the correct callback is always called without listener churn.
 */
export function TerminalContextMenu({
  x,
  y,
  canCopy,
  canPaste,
  onCopy,
  onPaste,
  onDismiss
}: TerminalContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Dismiss on outside mousedown (before click fires, catches drag-out too).
    const handleMouseDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss()
      }
    }

    // Dismiss on Esc (do NOT preventDefault — Esc may be useful to the terminal too).
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onDismiss()
      }
    }

    // Dismiss on any scroll (the menu would visually drift from the cursor position).
    const handleScroll = (): void => {
      onDismiss()
    }

    // Dismiss when the window loses focus (e.g. alt-tab).
    const handleBlur = (): void => {
      onDismiss()
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('blur', handleBlur)

    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('blur', handleBlur)
    }
    // `onDismiss` is in the dep array so a fresh callback is always used. The parent
    // wraps it with `useCallback` to ensure stability (no listener churn per render).
  }, [onDismiss])

  const menu = (
    <div ref={menuRef} className={styles.wrap} style={{ top: y, left: x }}>
      <Popover.Surface role="menu" testId="terminal-context-menu">
        {/* Copy: enabled only when the terminal has a non-empty selection. */}
        <Popover.CompactItem role="menuitem" disabled={!canCopy} onClick={onCopy}>
          Copy
        </Popover.CompactItem>
        {/* Paste: enabled only when the OS clipboard has text (readText returned non-empty). */}
        <Popover.CompactItem role="menuitem" disabled={!canPaste} onClick={onPaste}>
          Paste
        </Popover.CompactItem>
      </Popover.Surface>
    </div>
  )

  // Portal to document.body so position:fixed is viewport-relative and escapes
  // the terminal frame's overflow:hidden clip.
  return createPortal(menu, document.body)
}
