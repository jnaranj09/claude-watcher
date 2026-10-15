// The AttentionRail test harness: reset the stores the rail reads, and mount the rail.
//
// Usage:
//   beforeEach(() => resetRailStores())
//   afterEach(() => unmountRendered())
//   const r = renderRail()
import { boardStore } from '../stores/boardStore'
import { tagsStore } from '../stores/tagsStore'
import { workspacesStore } from '../stores/workspacesStore'
import { AttentionRail } from '../components/attention/AttentionRail'
import { renderTracked, type RenderResult } from './renderComponent'

/** Back to an empty board, the default workspace and an empty tag catalog, so no case bleeds into
 *  the next. */
export function resetRailStores(): void {
  boardStore.setState({
    sessionsById: {},
    epoch: 0,
    viewMode: 'focused',
    focusedTerminalId: null,
    selectedId: null,
    acknowledgedById: {},
    terminalIdBySessionId: {},
    launchedTerminals: {},
    searchQuery: ''
  })
  workspacesStore.setState({ activeId: 'default' })
  tagsStore.setState({ tags: [], loaded: false, activeTagId: null })
}

/** Mount the rail. Pair with `unmountRendered()` in afterEach. */
export function renderRail(onActivateSession: (id: string) => void = () => {}): RenderResult {
  return renderTracked(<AttentionRail onActivateSession={onActivateSession} />)
}

/** Mount the rail with the rename seam wired (the pencil only exists when `onRenameSession` is). */
export function renderRailWithRename(
  onRenameSession: (id: string) => void,
  onActivateSession: (id: string) => void = () => {}
): RenderResult {
  return renderTracked(
    <AttentionRail onActivateSession={onActivateSession} onRenameSession={onRenameSession} />
  )
}
