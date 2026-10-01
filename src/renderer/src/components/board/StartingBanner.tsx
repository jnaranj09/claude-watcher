// Story 5.6 (AC-3, AC-6) — the compact "starting" banner for the Board's status-line region.
//
// Renders a thin, calm-neutral collapsed line "N starting · click to open" when ≥1
// app-launched terminal is not yet represented by a c9watch board card (pre-correlation).
// Renders NOTHING when there are zero starting terminals (no DOM footprint).
//
// UX contract (resolved — Jose 2026-06-22):
//   - CALM-NEUTRAL: font-mono cwd-basename + muted "starting…"; NO accent bar, NO status
//     dot, NO gold, STATIC (motion is reserved for Needs-you signals).
//   - Expand mechanism: popover (`shadow-pop`); clicking the banner opens/closes a list.
//   - Single-entry optimisation: when exactly ONE starting terminal exists, clicking the
//     banner opens it DIRECTLY (no list; skips the expand step).
//   - Each entry click → `boardStore.getState().switchTerminal(terminalId)`.
//   - Mount in Board.tsx `.statusLine` region (the board's status strip).
//
// [Source: story 5-6-keep-app-launched-terminals-reachable.md, Task 3]
import { useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  boardStore,
  useBoard,
  selectStartingTerminals,
  type BoardState
} from '../../stores/boardStore'
// Workspaces (Task 9a) — the banner is a component, so it reads the active workspace itself.
import { useWorkspaces, selectActiveWorkspaceId } from '../../stores/workspacesStore'
import { Popover } from '../Popover/Popover'
import styles from './StartingBanner.module.css'

export function StartingBanner(): JSX.Element | null {
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  // Subscribe with useShallow because selectStartingTerminals returns an array (object selector).
  const startingTerminals = useBoard(
    useShallow((s: BoardState) => selectStartingTerminals(s, activeWorkspaceId))
  )
  const [open, setOpen] = useState(false)

  // Render nothing when there are no starting terminals (AC-3: only when ≥1 present).
  if (startingTerminals.length === 0) return null

  const count = startingTerminals.length
  const label = count === 1 ? '1 starting · click to open' : `${count} starting · click to open`

  function handleTriggerClick(): void {
    if (count === 1 && startingTerminals[0] !== undefined) {
      // Single-entry optimisation: open the terminal directly (skip the list).
      boardStore.getState().switchTerminal(startingTerminals[0].terminalId)
      setOpen(false)
      return
    }
    // Multi-entry: toggle the popover.
    setOpen((prev) => !prev)
  }

  function handleEntryClick(terminalId: string): void {
    boardStore.getState().switchTerminal(terminalId)
    setOpen(false)
  }

  return (
    <div className={styles.bannerWrapper}>
      <button
        type="button"
        className={styles.bannerTrigger}
        onClick={handleTriggerClick}
        aria-expanded={count > 1 ? open : undefined}
        aria-haspopup={count > 1 ? 'listbox' : undefined}
        data-testid="starting-banner"
      >
        {/* Neutral glyph — NOT gold, NOT the attention dot. */}
        <span className={styles.glyph} aria-hidden="true" />
        {label}
      </button>

      {/* Popover (multi-entry only) — shows the calm-neutral list. */}
      {count > 1 && open && (
        <div className={styles.popoverWrap}>
          <Popover.Surface role="listbox" aria-label="Starting terminals" testId="starting-popover">
            {startingTerminals.map((lt) => (
              <Popover.Item
                key={lt.terminalId}
                role="option"
                aria-selected={false}
                testId="starting-entry"
                onClick={() => handleEntryClick(lt.terminalId)}
              >
                <span className={styles.entryText}>
                  {/* font-mono cwd-basename — calm, no accent */}
                  <span className={styles.entryLabel}>{lt.label}</span>
                  {/* muted "starting…" — NO status dot, NO gold */}
                  <span className={styles.entryStatus}>starting…</span>
                </span>
              </Popover.Item>
            ))}
          </Popover.Surface>
        </div>
      )}
    </div>
  )
}
