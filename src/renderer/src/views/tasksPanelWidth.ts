// The focused view's task panel width (spec 2026-10-19 E, owner 2026-10-20): the band its drag
// line keeps it in and the line's handlers. Pure, beside SessionTasks (a component file exports
// only components).
import type { SplitDividerHandlers } from '../components/SplitDivider/SplitDivider'

/** The panel's width in px: where it starts, and the band its drag line keeps it in. */
export const TASKS_PANEL_DEFAULT_PX = 260
export const TASKS_PANEL_MIN_PX = 200
export const TASKS_PANEL_MAX_PX = 640
const TASKS_PANEL_STEP_PX = 20

function clampTasksWidth(width: number): number {
  return Math.min(TASKS_PANEL_MAX_PX, Math.max(TASKS_PANEL_MIN_PX, Math.round(width)))
}

/** The drag line on the panel's left edge (a vertical SplitDivider): dragging left widens the
 *  panel, ArrowLeft steps it 20px wider, a double-click goes back to 260px. */
export function tasksDividerHandlers(width: number): SplitDividerHandlers {
  return {
    valueNow: width,
    valueMin: TASKS_PANEL_MIN_PX,
    valueMax: TASKS_PANEL_MAX_PX,
    // The panel is right of the line: a pointer moving left (a smaller x) makes it wider.
    startDrag: (x0) => (x) => clampTasksWidth(width + x0 - x),
    stepValue: (direction) => clampTasksWidth(width - direction * TASKS_PANEL_STEP_PX),
    resetValue: TASKS_PANEL_DEFAULT_PX
  }
}
