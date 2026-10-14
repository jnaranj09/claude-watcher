// Story 1.3 — SessionCard (AC-4, AC-8). Story 3.3 — the `watch-only` variant RETIRED.
//
// One card anatomy, TWO live presentations driven by a `variant` prop:
//   - hero       — large, full-contrast (`bg-card-hero`), a 3px left accent bar in
//                  the hero column's accent (gold = needs-you / blue = working).
//   - calm       — compact, recessed "far" card: ~0.82 opacity + a one-rung-dimmer title.
//                  (It used to say `text-dim` body. That variant-level `color` only ever reached
//                  `.sessionName` — every other child sets its own — so it dimmed the TITLE rather
//                  than the body, inverting the hierarchy. See SessionCard.module.css `.calm`.)
//
// VISUAL HIERARCHY: the operator's custom NAME is the title (sans, weight 600, `--text-primary`;
// `--text-secondary` on calm) and the projectPath is reference detail beneath it (mono,
// `--text-muted`). Name above path, in both variants.
//
// Story 3.3 (FR-12 dropped) — the `watch-only` variant (the muted `Konsole` tag, built in
// Story 1.3 but NEVER wired by any caller) is RETIRED: the Board shows ONLY app-launched
// sessions, so there is no external/Konsole card to present. UX-DR6 loses its watch-only
// presentation; UX-DR20 (click-to-focus-failed) is DROPPED.
//
// PRESENTATIONAL ONLY: props are already-typed in-process data (NO c9watch parsing,
// NO IPC, NO store). The card is keyboard-focusable with a lavender AA focus ring
// and calls `onActivate` on click/Enter — the handler is wired by Story 1.4; this
// component only takes the callback. Status is dot + text label (never color-only).
import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import { StatusDot, type DotStatus } from '../StatusDot/StatusDot'
import { needsYouEmphasisClass } from '../../styles/emphasis'
import type { Tag, Workspace } from '../../../../shared/ipc/contract'
import { tagsDroppedByMove } from '../../../../shared/tags/tagScope'
import { TagChipRow } from '../TagChip/TagChipRow'
import { TagPicker } from '../TagPicker/TagPicker'
import { TagGlyphIcon } from '../TagIndicator/TagGlyphIcon'
import { Button } from '../Button/Button'
import { Popover } from '../Popover/Popover'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import styles from './SessionCard.module.css'
import { Presence } from '../Presence/Presence'
import { leavingProps } from '../Presence/leaving'

export type SessionCardVariant = 'hero' | 'calm'

/** Drives the hero accent bar. The two hero columns are needs-you (gold) and
 *  working (blue); idle never takes the hero, so it is not an accent option. */
export type CardAccent = 'needs-you' | 'working'

export interface SessionCardProps {
  variant: SessionCardVariant
  /** Story 6.5 — the stable session id (the launch-minted uuid), exposed verbatim as
   *  `data-session-id` on the card root so the Playwright e2e can read the identity off the
   *  board card and drive hook POSTs / column assertions against it. PRESENTATIONAL ONLY
   *  (an attribute, no behavior); optional so presentational callers/tests are untouched. */
  sessionId?: string
  /** Card title (sessionName) — SANS. */
  sessionName: string
  /** c9watch-verbatim path — MONO. */
  projectPath: string
  /** The status dot's live state (column-state, NOT a raw c9watch status). */
  status: DotStatus
  /** The hero accent bar color (gold for needs-you, blue for working). */
  accent: CardAccent
  /** What the session is blocked on, when present — MONO. */
  pendingToolName?: string
  /** Process id — MONO in the footer. */
  pid: number
  /** Task count, footer (omitted when undefined). */
  tasks?: number
  /** Cost string, footer (omitted when undefined). */
  cost?: string
  /** Activation callback (click / Enter). Wired by Story 1.4. */
  onActivate?: () => void
  /**
   * Session-naming A2 — the operator asked to RENAME this session (pencil clicked / activated).
   * Optional: when omitted the pencil is not rendered at all, so the Story-1.3 presentational
   * callers and their tests are untouched.
   *
   * The card itself is `role="button"` with an `onClick`, so the pencil's handlers MUST stop
   * propagation — otherwise renaming would ALSO activate the card and drop the operator into the
   * focused-session view behind the dialog.
   */
  onRename?: () => void
  /**
   * Workspaces (Task 12) — the move-to-workspace targets. Omitted (along with
   * `onMoveToWorkspace`) ⇒ the card renders no move affordance at all — the same
   * optional-seam pattern as `onRename`.
   */
  workspaces?: Workspace[]
  /** Workspaces — the session's OWN workspace. Never offered as a move target. */
  currentWorkspaceId?: string
  /**
   * Workspaces — the operator picked a target workspace from the move affordance. Optional:
   * omitted ⇒ no move control is rendered. Same stopPropagation requirement as `onRename` — the
   * control is a DOM child of the card's own `role="button"`.
   */
  onMoveToWorkspace?: (workspaceId: string) => void
  /** Tags — the chips this card carries, already resolved and in TAG-LIST order (T-26). Omitted or
   *  empty ⇒ no chip row. */
  tags?: readonly Tag[]
  /** Tags — what the Tags… menu may offer: global + this card's workspace (T-11), tag-list order. */
  availableTags?: readonly Tag[]
  /** Tags — the operator changed this card's tags in the Tags… menu. Omitted ⇒ no Tags… button,
   *  the same optional-seam rule as `onRename`. */
  onSetTags?: (tagIds: string[]) => void
  /** Tags — open the Tags dialog. Used while `availableTags` is empty: the Tags… button then
   *  opens the dialog where tags are created, instead of an empty picker. Omitted ⇒ with nothing
   *  to offer, no Tags… button at all. */
  onManageTags?: () => void
  /** Story 2.2 (FR-9) — true when this card is the SELECTED card (the operator activated a
   *  notification for this session and the window is up). Renders a locate-and-highlight
   *  affordance via the shipped focus-ring / raised-surface tokens — NOT a new color,
   *  NOT a window raise. Default false. */
  selected?: boolean
  /** Story 3.4 (FR-16 / AC-4) — true when this session NEEDS YOU and is UNacknowledged. Driven by
   *  the SHARED `selectRailEmphasis` (the SAME state the attention rail reads — ONE ack state, no
   *  parallel flag). Applies the SHIPPED Epic-1 `needsYouEmphasisClass` (the pulse + reduced-motion
   *  fallback + gold token) — CONSUMED, not re-authored. Orthogonal to `selected` (which card is
   *  being viewed) — this is "which card still needs you." Default false. */
  emphasized?: boolean
  /** Name-sync (D-11) — true while an in-app rename waits for claude's next prompt: a `⟳` mark
   *  sits after the name, titled so the operator learns the rule where it applies. */
  nameSyncPending?: boolean
  /** Past sessions (D-3) — Archive: stop and keep a record; no confirmation. Omitted ⇒ not
   *  rendered (a card whose terminal binding has not landed cannot be exited yet). Same
   *  stopPropagation rule as `onRename`. */
  onArchive?: () => Promise<void>
  /** Past sessions (D-5) — Delete: opens the confirm. Red at rest. Omitted ⇒ not rendered. */
  onDelete?: () => void
}

export const NAME_SYNC_PENDING_TITLE = 'Claude applies this name on your next prompt'

/** The ONE drawing of the pending-rename mark: the card and the focused view's title use it. */
export function NameSyncMark({ className }: { className?: string }): JSX.Element {
  return (
    <span
      className={`${styles.nameSyncMark} ${className ?? ''}`}
      data-testid="name-sync-pending"
      role="img"
      aria-label={NAME_SYNC_PENDING_TITLE}
      title={NAME_SYNC_PENDING_TITLE}
    >
      ⟳
    </span>
  )
}

const VARIANT_CLASS: Record<SessionCardVariant, string> = {
  hero: styles.hero ?? '',
  calm: styles.calm ?? ''
}

const ACCENT_CLASS: Record<CardAccent, string> = {
  'needs-you': styles.accentNeedsYou ?? '',
  working: styles.accentWorking ?? ''
}

export function SessionCard(props: SessionCardProps): JSX.Element {
  const {
    variant,
    sessionId,
    sessionName,
    projectPath,
    status,
    accent,
    pendingToolName,
    pid,
    tasks,
    cost,
    onActivate,
    onRename,
    workspaces,
    currentWorkspaceId,
    onMoveToWorkspace,
    tags,
    availableTags,
    onSetTags,
    onManageTags,
    selected = false,
    emphasized = false,
    nameSyncPending,
    onArchive,
    onDelete
  } = props

  // Workspaces (Task 12) — local, presentational toggle for the move-target list. Ephemeral UI
  // state only (not session truth, not persisted) — the same category of local state the header
  // WorkspaceSwitcher popover already uses.
  const [moveOpen, setMoveOpen] = useState(false)
  const moveButtonRef = useRef<HTMLButtonElement | null>(null)
  const moveAnchorRef = useRef<HTMLDivElement | null>(null)
  // A mousedown anywhere outside the move button + menu closes the menu — the same rule as every
  // other popover here (TagPicker, Select, AppMenu…). Without it, opening the tag picker beside it
  // left BOTH open. A mousedown on the toggle itself is ignored so its click can still toggle.
  useEffect(() => {
    if (!moveOpen) return
    const onMouseDown = (e: globalThis.MouseEvent): void => {
      if (moveAnchorRef.current?.contains(e.target as Node) === true) return
      setMoveOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [moveOpen])
  // Review finding 2 — an empty target list is a control that opens nothing, which is a defect,
  // not a valid state. Computed once here so the render guard below and the menu's map share the
  // SAME filtered list (never re-derived, never drifting).
  const otherWorkspaces = (workspaces ?? []).filter((w) => w.id !== currentWorkspaceId)

  // Tags (T-26) — local, presentational toggle for the Tags… list; the same kind of ephemeral UI
  // state as `moveOpen`.
  const [tagsOpen, setTagsOpen] = useState(false)
  const tagsAnchorRef = useRef<HTMLDivElement | null>(null)
  const tagsButtonRef = useRef<HTMLButtonElement | null>(null)
  const cardTags = tags ?? []
  const pickable = availableTags ?? []
  // No tag to offer yet: the Tags… button opens the Tags dialog (to create one) instead of a picker.
  const tagsCreateOnly = pickable.length === 0
  // T-9 — the tags that do not survive a move: whatever `tagsDroppedByMove` (the SAME shared
  // predicate `keepVisibleTags` uses to APPLY a move — src/shared/tags/tagScope.ts) says is
  // invisible in a representative OTHER workspace. Every target other than the card's own
  // currently gives the SAME count (T-11: a card only ever holds a GLOBAL tag or one scoped to
  // its OWN workspace, so a scoped tag disappears for every other target alike) — reading the
  // drop through the shared predicate, rather than a bare `workspaceId` comparison, is what keeps
  // this honest if that invariant ever loosens.
  const dropTargetId = otherWorkspaces[0]?.id
  const droppedOnMove =
    dropTargetId === undefined ? 0 : tagsDroppedByMove(cardTags, dropTargetId).length
  const currentWorkspaceName =
    workspaces?.find((w) => w.id === currentWorkspaceId)?.name ?? 'this workspace'
  const moveWarningId = useId()
  const tagPickerId = useId()

  // The accent bar only renders on the hero variant (calm is recessed).
  const accentClass = variant === 'hero' ? ACCENT_CLASS[accent] : ''
  // Story 2.2 (FR-9) — `selected` still drives `data-selected` below (the store's
  // locate-and-highlight and its tests read it), but it no longer carries any STYLING: on the
  // board nothing is "selected" in a way the operator chose, so painting one card implied a mode
  // that does not exist. The active-session fill lives in the RAIL, where it means something.
  // See the `.selected` note in SessionCard.module.css. Never a window raise.
  // Story 3.4 (FR-16 / AC-4) — the needs-you-unacknowledged emphasis: the SHIPPED Epic-1 pulse
  // class (gold token + pulse + reduced-motion fallback, all in emphasis.module.css). CONSUMED,
  // not re-authored. Driven by the SHARED ack state (selectRailEmphasis) — the rail reads the same.
  const emphasisClass = emphasized ? needsYouEmphasisClass : ''

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onActivate?.()
    }
  }

  // A2 — LOAD-BEARING stopPropagation. The card root is `role="button"` with its own onClick AND
  // its own Enter/Space keydown handler, and this pencil is a DOM child of it. Without stopping
  // propagation the rename click would bubble to the card and ALSO activate it — the operator
  // would land in the focused-session view with the rename dialog on top of it.
  //
  // BOTH handlers are needed, not just the click one: a keyboard operator pressing Enter/Space on
  // the focused pencil fires a keydown that bubbles to the card's `handleKeyDown` (which calls
  // `onActivate`) BEFORE the browser synthesizes the button's click. Stopping only the click would
  // leave the keyboard path activating the card.
  const handleRenameClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    onRename?.()
  }

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      // Do NOT preventDefault: that would suppress the button's own native click, which is what
      // actually invokes onRename. Only stop the bubble to the card.
      e.stopPropagation()
    }
  }

  // Past sessions (D-3/D-5) — the SAME LOAD-BEARING guard pair as the rename pencil above,
  // copied verbatim (click + keydown) for the SAME reason: both controls are DOM children of the
  // card's own `role="button"` onClick/onKeyDown.
  // Action feedback (spec 2026-09-29 §2.3): busy until main answers — one press, one archive.
  const archive = useAsyncAction(async (): Promise<void> => {
    await onArchive?.()
  })
  const handleArchiveClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    void archive.run()
  }

  const handleArchiveKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      // Do NOT preventDefault — see handleRenameKeyDown above.
      e.stopPropagation()
    }
  }

  const handleDeleteClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    onDelete?.()
  }

  const handleDeleteKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      // Do NOT preventDefault — see handleRenameKeyDown above.
      e.stopPropagation()
    }
  }

  // Workspaces (Task 12) — the SAME LOAD-BEARING guard pair as the rename pencil above, copied
  // verbatim (click + keydown), for the SAME reason: this toggle is a DOM child of the card's own
  // `role="button"` onClick/onKeyDown, so a bare handler here would ALSO activate the card, and a
  // keyboard Enter/Space would bubble a keydown to the card's handleKeyDown BEFORE the browser
  // synthesizes the button's own click — stopping only the click leaves that path activating the
  // card underneath.
  const handleMoveToggleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    setMoveOpen((v) => !v)
  }

  const handleMoveToggleKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      // Do NOT preventDefault — see handleRenameKeyDown above.
      e.stopPropagation()
    }
  }

  // Tags — the SAME load-bearing guard pair as the pencil and the move toggle: this button is a DOM
  // child of the card's role="button", so a bare click (or an Enter/Space keydown, which reaches
  // the card BEFORE the browser synthesizes the click) would also open the session.
  const handleTagsToggleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    if (tagsCreateOnly) onManageTags?.()
    else setTagsOpen((v) => !v)
  }
  const handleTagsToggleKeyDown = handleMoveToggleKeyDown

  const closeTags = (reason: 'escape' | 'outside'): void => {
    setTagsOpen(false)
    // Only Escape hands focus back; an outside click leaves focus where the operator clicked.
    if (reason === 'escape') tagsButtonRef.current?.focus()
  }

  // Each move-target row is ALSO a DOM child of the card's role="button" — the same guard applies
  // (picking a workspace must not also activate/open the card underneath the closing menu).
  const handleMoveItemClick = (e: MouseEvent<HTMLButtonElement>, workspaceId: string): void => {
    e.stopPropagation()
    setMoveOpen(false)
    onMoveToWorkspace?.(workspaceId)
  }

  // Review finding 1 — the SAME keyboard race as the toggle (handleMoveToggleKeyDown above), one
  // level down: a keyboard operator who tabs to a row and presses Enter/Space fires a keydown that
  // bubbles to the card's handleKeyDown BEFORE the browser synthesizes the row button's own click.
  // Stopping only the row's onClick (handleMoveItemClick) leaves this path activating the card.
  const handleMoveItemKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      // Do NOT preventDefault — see handleRenameKeyDown above.
      e.stopPropagation()
    }
  }

  // Review finding 3 — Escape-to-close, matching WorkspaceSwitcher's popover exactly (same
  // mechanism, no arrow-key roving added here either). The handler lives on the menu element,
  // which exists ONLY while `moveOpen` — so it can never swallow Escape anywhere else in the app.
  const closeMoveMenuAndRefocus = (): void => {
    setMoveOpen(false)
    moveButtonRef.current?.focus()
  }

  const handleMoveMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeMoveMenuAndRefocus()
    }
  }

  // SessionCard.module.css `.root[data-menu-open]` — lifts THIS card's stacking context above
  // its siblings while its own move menu or tag picker is open, so the popover never paints
  // under the next card in the column (Task 17 drive-scenario finding).
  const menuOpen = moveOpen || tagsOpen

  return (
    <div
      className={`${styles.root} ${VARIANT_CLASS[variant]} ${accentClass} ${emphasisClass}`}
      data-variant={variant}
      data-accent={accent}
      data-status={status}
      data-glass="card"
      {...(sessionId !== undefined ? { 'data-session-id': sessionId } : {})}
      {...(selected ? { 'data-selected': true } : {})}
      {...(emphasized ? { 'data-emphasized': true } : {})}
      {...(menuOpen ? { 'data-menu-open': true } : {})}
      role="button"
      tabIndex={0}
      onClick={() => onActivate?.()}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.header}>
        <span className={styles.sessionName} data-testid="session-name" data-card-title="">
          {sessionName}
        </span>
        {nameSyncPending === true && <NameSyncMark />}
        {/* A2 — rename affordance. Revealed on card hover/focus-within (CSS) but ALWAYS in the
            accessibility tree and ALWAYS tab-reachable: a hover-only control is unreachable by
            keyboard, and this card is already a keyboard-activatable role="button".
            Rendered only when a handler is wired, so purely presentational callers/tests are
            untouched. */}
        {onRename !== undefined && (
          <span className={styles.actionSlot}>
            {/* The reveal-on-hover lives on the `.actionSlot` WRAPPER: Button takes no className. */}
            <Button
              variant="ghost"
              size="xs"
              icon
              testId="card-rename"
              aria-label={`Rename ${sessionName}`}
              title={`Rename ${sessionName}`}
              onClick={handleRenameClick}
              onKeyDown={handleRenameKeyDown}
            >
              {/* Inline SVG pencil: no icon dependency, and `currentColor` inherits the card's
                  text ramp so hero/calm variants tint it correctly. aria-hidden — the button's
                  aria-label is the accessible name. */}
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M11.5 2.5l2 2-7 7-2.5.5.5-2.5z" />
              </svg>
            </Button>
          </span>
        )}
        {/* Workspaces (Task 12) — move-to-workspace affordance. Same reveal-on-hover/focus-within
            + always-tab-reachable treatment as the pencil, and the same optional-seam rule:
            rendered only when `onMoveToWorkspace` is wired AND at least one OTHER workspace
            exists to move to (review finding 2 — a control that opens onto nothing is a defect,
            not a valid state; the single-workspace install is the common case this guards). */}
        {onMoveToWorkspace !== undefined && otherWorkspaces.length > 0 && (
          <div className={styles.moveWrap} ref={moveAnchorRef}>
            {/* The slot wraps the BUTTON only, not the menu: `opacity` below 1 makes a stacking
                context, and the popover must not be trapped in (or faded with) it. */}
            <span className={styles.actionSlot}>
              <Button
                variant="ghost"
                size="xs"
                icon
                buttonRef={moveButtonRef}
                testId="card-move"
                aria-haspopup="menu"
                aria-expanded={moveOpen}
                aria-label={`Move ${sessionName} to another workspace`}
                title={`Move ${sessionName} to another workspace`}
                onClick={handleMoveToggleClick}
                onKeyDown={handleMoveToggleKeyDown}
              >
                {/* Inline SVG folder-arrow glyph: no icon dependency, `currentColor` inherits the
                    card's text ramp the same way the pencil's does. aria-hidden — the button's
                    aria-label is the accessible name. */}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M2 4.5h4l1.5 2H14v6.5H2z" />
                  <path d="M8 8.5v3M6.5 10h3" />
                </svg>
              </Button>
            </span>
            <Presence value={moveOpen || null}>
              {(_, leaving) => (
                <div className={styles.moveMenuWrap} {...leavingProps(leaving)}>
                  <Popover.Surface
                    role="menu"
                    onKeyDown={handleMoveMenuKeyDown}
                    {...(droppedOnMove > 0 ? { 'aria-describedby': moveWarningId } : {})}
                  >
                    {/* T-9 — say what the move costs BEFORE it happens: this workspace's own tags do
                      not exist elsewhere. `role="none"` keeps the menu's children menu items only;
                      aria-describedby reads it out. */}
                    {droppedOnMove > 0 && (
                      <p
                        id={moveWarningId}
                        className={styles.moveWarning}
                        role="none"
                        data-testid="card-move-warning"
                      >
                        {`Moving drops ${droppedOnMove} ${droppedOnMove === 1 ? 'tag' : 'tags'} from ${currentWorkspaceName}`}
                      </p>
                    )}
                    {otherWorkspaces.map((w) => (
                      <Popover.CompactItem
                        key={w.id}
                        role="menuitem"
                        testId={`card-move-${w.id}`}
                        onClick={(e) => handleMoveItemClick(e, w.id)}
                        onKeyDown={handleMoveItemKeyDown}
                      >
                        {w.name}
                      </Popover.CompactItem>
                    ))}
                  </Popover.Surface>
                </div>
              )}
            </Presence>
          </div>
        )}
        {/* Tags (T-26) — the Tags… menu. Same reveal-on-hover + always-tab-reachable treatment as
            the pencil, and the same "never a control that opens onto nothing" rule as the move
            button: rendered only when tagging is wired AND it opens onto something — this card's
            workspace tags, or, while there are none yet, the Tags dialog that creates them. */}
        {onSetTags !== undefined && (!tagsCreateOnly || onManageTags !== undefined) && (
          <div className={styles.moveWrap} ref={tagsAnchorRef}>
            <span className={styles.actionSlot}>
              <Button
                variant="ghost"
                size="xs"
                icon
                buttonRef={tagsButtonRef}
                testId="card-tags-button"
                {...(tagsCreateOnly
                  ? {
                      'aria-haspopup': 'dialog' as const,
                      'aria-label': 'Create tags',
                      title: 'No tags yet — create tags'
                    }
                  : {
                      'aria-expanded': tagsOpen,
                      'aria-controls': tagPickerId,
                      'aria-label': `Tags for ${sessionName}`,
                      title: `Tags for ${sessionName}`
                    })}
                onClick={handleTagsToggleClick}
                onKeyDown={handleTagsToggleKeyDown}
              >
                <TagGlyphIcon />
              </Button>
            </span>
            <Presence value={tagsOpen || null}>
              {() => (
                <TagPicker
                  id={tagPickerId}
                  sessionId={sessionId}
                  tags={pickable}
                  selectedIds={cardTags.map((t) => t.id)}
                  onChange={(tagIds) => onSetTags(tagIds)}
                  onClose={closeTags}
                  anchorRef={tagsAnchorRef}
                  testId="card-tag-picker"
                  label={`Tags for ${sessionName}`}
                />
              )}
            </Presence>
          </div>
        )}
        {/* Past sessions (D-3) — Archive. Same reveal-on-hover + always-tab-reachable treatment
            as the pencil/move/tags controls, and the same optional-seam rule: rendered only when
            wired (a card whose terminal binding has not landed cannot be exited yet). */}
        {onArchive !== undefined && (
          <span className={styles.actionSlot}>
            <Button
              variant="ghost"
              size="xs"
              icon
              testId="card-archive"
              busy={archive.busy}
              aria-label={`Archive ${sessionName}`}
              title={`Archive ${sessionName} (keeps it in Past sessions)`}
              onClick={handleArchiveClick}
              onKeyDown={handleArchiveKeyDown}
            >
              {/* Inline SVG archive-box glyph: no icon dependency, currentColor inherits the
                  card's text ramp like the other controls'. aria-hidden — the button's
                  aria-label is the accessible name. */}
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M2 4h12v2H2zM3 6v7h10V6M6.5 9h3" />
              </svg>
            </Button>
          </span>
        )}
        {/* Past sessions (D-5) — Delete: Button's `danger` (red outline at rest, filled on
            hover/focus — design.md's Delete treatment). Opens the confirm; the confirm deletes. */}
        {onDelete !== undefined && (
          <span className={styles.actionSlot}>
            <Button
              variant="danger"
              size="xs"
              icon
              testId="card-delete"
              aria-label={`Delete ${sessionName}`}
              title={`Delete ${sessionName}`}
              onClick={handleDeleteClick}
              onKeyDown={handleDeleteKeyDown}
            >
              {/* Inline SVG trash glyph. */}
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />
              </svg>
            </Button>
          </span>
        )}
        <StatusDot status={status} labelHidden />
      </div>

      <span className={styles.projectPath} data-testid="project-path" data-card-path="">
        {projectPath}
      </span>

      {pendingToolName !== undefined && (
        <span className={styles.pendingToolName} data-testid="pending-tool" data-pending-tool="">
          {pendingToolName}
        </span>
      )}

      <div className={styles.footer} data-testid="footer" data-card-meta="">
        <span className={styles.pid} data-testid="pid">
          {pid}
        </span>
        {tasks !== undefined && (
          <>
            <span className={styles.sep} aria-hidden>
              ·
            </span>
            <span data-testid="tasks">{tasks} tasks</span>
          </>
        )}
        {cost !== undefined && (
          <>
            <span className={styles.sep} aria-hidden>
              ·
            </span>
            <span data-testid="cost">{cost}</span>
          </>
        )}
        {/* T-26 — tags sit at the RIGHT of the footer on ONE line; what does not fit becomes +N. */}
        {cardTags.length > 0 && (
          <div className={styles.footerTags}>
            <TagChipRow tags={cardTags} testId="card-tags" />
          </div>
        )}
      </div>
    </div>
  )
}
