// Card shell pane (spec 2026-09-30) — the split between claude and its shell: the app's one drag
// line (SplitDivider, horizontal) fed the shell's ratio math. The ratio is the shell's share of the
// frame; a drag maps the pointer over the frame's content box (`getBounds`, injected: the divider
// must not know which element it splits; null = cannot measure, no drag), ArrowUp / ArrowDown step
// it 5% (Up grows the shell), a double-click resets it to the default.
import type { JSX } from 'react'
import {
  DEFAULT_SHELL_PANE_RATIO,
  SHELL_PANE_RATIO_MAX,
  SHELL_PANE_RATIO_MIN
} from '../../../shared/schemas/settings'
import { SplitDivider } from '../components/SplitDivider/SplitDivider'
import { clampShellRatio, ratioFromPointer, shellPercent, stepShellRatio } from './shellPaneRatio'

export interface ShellDividerProps {
  /** The shell's share of the frame (0.15–0.85). */
  ratio: number
  getBounds: () => { top: number; height: number } | null
  /** Live, during a drag. The caller applies it to the layout and saves nothing. */
  onDrag: (ratio: number) => void
  /** Drag end, a key step, a double-click reset — the ONE save point. */
  onCommit: (ratio: number) => void
  ariaLabel: string
  testId: string
}

export function ShellDivider({ ratio, getBounds, ...rest }: ShellDividerProps): JSX.Element {
  return (
    <SplitDivider
      orientation="horizontal"
      valueNow={shellPercent(ratio)}
      valueMin={shellPercent(SHELL_PANE_RATIO_MIN)}
      valueMax={shellPercent(SHELL_PANE_RATIO_MAX)}
      startDrag={() => {
        const bounds = getBounds()
        if (bounds === null) return null
        return (clientY) => clampShellRatio(ratioFromPointer(clientY, bounds), bounds.height)
      }}
      stepValue={(direction) =>
        stepShellRatio(ratio, direction < 0 ? 'ArrowUp' : 'ArrowDown', getBounds()?.height ?? 0)
      }
      resetValue={DEFAULT_SHELL_PANE_RATIO}
      {...rest}
    />
  )
}
