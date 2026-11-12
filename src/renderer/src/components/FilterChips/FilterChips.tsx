// FilterChips (spec 2026-10-16 §3) — the ONE chip row: the board's filter bar, the Sessions
// dialog's Active / Past rails and the Memory dialog's rail all render it. Controlled: the caller owns `filters` (the board per
// workspace in boardStore, the rails per page and scope in SessionsDialog) and gets every change
// through `onChange`. One pill per type that is on, in `types` order; `+ Add filter` opens a type
// menu whose rows open their values beside them (`Popover.Submenu`); a pill opens the same values
// under itself. Multi-pick lists (tags, folders, goals, sessions) stay open; single picks (a preset,
// a calendar day, and a folder, goal or session on a surface that lists it in `single`) close. A
// toggle type (`Session deleted`) has no values: its type row turns it on, its pill only removes.
//
// A multi pick made from the type menu turns that type ON, which takes its row out of the type
// menu (a type that is on is not offered twice). So the list moves under the new pill and stays
// open there (mockup step 2): the next pick lands in the same list. The `On a day` / `Since a day`
// rows swap their list for the Calendar, drawn under the trigger that opened the list.
//
// A KEY open (Enter or Space on `+ Add filter` or a pill: a click with `detail` 0) puts focus on
// the first row of what opened, as `Popover.Submenu`'s ArrowRight does; a pointer open leaves focus
// on the trigger.
//
// Every popup floats over what is below (the operator: "show over them, never push the board
// columns down"): the row is a stacking context above the board, each popup is positioned.
import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import type { Tag } from '../../../../shared/ipc/contract'
import {
  clearType,
  isTypeOn,
  type FilterType,
  type SessionFilters,
  type TimePick,
  type TimeRange
} from '../../lib/sessionFilters'
import {
  FILTER_TYPE_LABEL,
  folderName,
  removeFilterLabel,
  TIME_RANGE_LABEL,
  timePickRowLabel,
  timePillText,
  type TimeFilterType
} from '../../lib/filterCopy'
import { Calendar } from '../Calendar/Calendar'
import {
  CalendarIcon,
  FolderIcon,
  GoalIcon,
  PlusIcon,
  TerminalIcon,
  TrashIcon
} from '../Icon/MenuIcons'
import { Popover } from '../Popover/Popover'
import { moveMenuRow } from '../Popover/menuArrows'
import { Presence } from '../Presence/Presence'
import { leavingProps } from '../Presence/leaving'
import { ScopeMarker } from '../ScopeFilter/ScopeMarker'
import { selectWorkspaces, useWorkspaces } from '../../stores/workspacesStore'
import { TagChipRow } from '../TagChip/TagChipRow'
import { TagGlyphIcon } from '../TagIndicator/TagGlyphIcon'
import { TagMenu, TagMenuNote, TagMenuRow } from '../TagMenu/TagMenu'
import { popupAlign, submenuSide, type PopupAlign } from './submenuSide'
import styles from './FilterChips.module.css'

export interface FilterChipsProps {
  /** The chip row's DOM id (the Filter button's aria-controls). */
  id: string
  filters: SessionFilters
  onChange: (next: SessionFilters) => void
  /** Which types this surface offers, in pill order: board ['tag','folder','goal','launched'],
   *  Active ['tag','folder','launched'], Past ['tag','folder','launched','ended'], Memory its
   *  filter fields' (`MemoryDialog/memoryFilterMap.ts`). */
  types: readonly FilterType[]
  /** Tags offered, in list order (global first, then the workspace's own). */
  tags: readonly Tag[]
  /** Distinct folders of the surface's rows (unsorted is fine; sorted inside). */
  folders: readonly string[]
  /** Goals offered (the board's workspace's, in creation order). Omitted ⇒ none. */
  goals?: readonly { id: string; name: string }[]
  /** Session names offered (Memory). Omitted ⇒ none. */
  sessionNames?: readonly string[]
  /** The list types picked ONE value at a time (a radio list that closes on a pick): Memory's
   *  folder, session and goal, which main filters by one value. Omitted ⇒ every list is multi. */
  single?: readonly ListType[]
  /** The `Create tags` row while no tag exists. Omitted ⇒ no such row. */
  onManageTags?: () => void
  now: () => number
  /** 'filter' on the board (keeps today's test ids), 'active-filter', 'past-filter'. */
  testIdPrefix: string
  /** The rail variant: pills wrap onto new lines (`data-wrap`). The board leaves it off. */
  wrap?: boolean
}

type TimeType = TimeFilterType
/** The types whose values are a list of paths or names. */
export type ListType = 'folder' | 'goal' | 'session'
type Origin = 'add' | 'pill'
type CalendarOpen = {
  at: 'calendar'
  type: TimeType
  mode: 'on' | 'since'
  from: Origin
  align: PopupAlign
}
/** What is open: nothing, the type menu (with one submenu, `focus` grows when a KEY opened it),
 *  a pill's list, or the calendar that replaced a time list. `align` is the trigger edge the
 *  popup lines up with, measured as it opens (`popupAlign`), so it never leaves the window. */
type Open =
  | null
  | { at: 'add'; sub: FilterType | null; focus: number; align: PopupAlign }
  | { at: 'pill'; type: FilterType; align: PopupAlign }
  | CalendarOpen

const PRESETS: readonly TimeRange[] = ['today', '7d', '30d']
const DAY_MODES = ['on', 'since'] as const

function isTime(type: FilterType): type is TimeType {
  return type === 'launched' || type === 'ended' || type === 'updated'
}

/** Folders in list order: by name, then by full path (two `api` folders keep one order). */
function byFolderName(a: string, b: string): number {
  return folderName(a).localeCompare(folderName(b)) || a.localeCompare(b)
}

/** `/home/u/api` → `/home/u`: the quieter second half of a folder row. */
function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const cut = trimmed.lastIndexOf('/')
  if (cut < 0) return ''
  return cut === 0 ? '/' : trimmed.slice(0, cut)
}

function typeIcon(type: FilterType): JSX.Element {
  if (type === 'tag') return <TagGlyphIcon size={14} />
  if (type === 'folder') return <FolderIcon />
  if (type === 'goal') return <GoalIcon />
  if (type === 'session') return <TerminalIcon />
  if (type === 'sessionDeleted') return <TrashIcon />
  return <CalendarIcon />
}

/** The ✓ at a value row's right edge while it is on. */
function Check(): JSX.Element {
  return (
    <Popover.ItemEnd>
      <span className={styles.check} aria-hidden="true">
        ✓
      </span>
    </Popover.ItemEnd>
  )
}

export function FilterChips({
  id,
  filters,
  onChange,
  types,
  tags,
  folders,
  goals = [],
  sessionNames = [],
  single = [],
  onManageTags,
  now,
  testIdPrefix,
  wrap = false
}: FilterChipsProps): JSX.Element {
  const tid = (suffix: string): string => `${testIdPrefix}-${suffix}`
  const [open, setOpen] = useState<Open>(null)
  const [side, setSide] = useState<'left' | 'right'>('right')
  // Bumped when a list closes or changes layer. The element to focus may be drawn by the SAME
  // render (a pill that replaced `+ Add filter`, a row in the list that replaced the type menu),
  // so focus moves in an effect, after that render: to the element whose `data-filter-focus` is
  // `key`, or to a type menu row (`type-<type>`) through its ref.
  const [refocus, setRefocus] = useState<{ key: string; n: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // The type menu's box, as state (a callback ref): measured when a submenu opens.
  const [typeMenu, setTypeMenu] = useState<HTMLDivElement | null>(null)
  const tagRowRef = useRef<HTMLButtonElement | null>(null)
  const folderRowRef = useRef<HTMLButtonElement | null>(null)
  const launchedRowRef = useRef<HTMLButtonElement | null>(null)
  const endedRowRef = useRef<HTMLButtonElement | null>(null)
  const goalRowRef = useRef<HTMLButtonElement | null>(null)
  const sessionRowRef = useRef<HTMLButtonElement | null>(null)
  const updatedRowRef = useRef<HTMLButtonElement | null>(null)
  const sessionDeletedRowRef = useRef<HTMLButtonElement | null>(null)
  const typeRefs = {
    tag: tagRowRef,
    folder: folderRowRef,
    goal: goalRowRef,
    launched: launchedRowRef,
    ended: endedRowRef,
    session: sessionRowRef,
    updated: updatedRowRef,
    sessionDeleted: sessionDeletedRowRef
  }

  // Tag is ON only through a tag this surface still offers: a gone id draws no pill, so it must not
  // take Tag out of the type menu either.
  const knownTagIds = new Set(tags.map((t) => t.id))
  // Two offered tags with one name (a global `api` and a workspace's own, or two workspaces' under
  // `All sessions`) would draw two identical rows: each of them also says where it lives.
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const nameCount = new Map<string, number>()
  for (const t of tags) nameCount.set(t.name, (nameCount.get(t.name) ?? 0) + 1)
  // Goal likewise: only through a goal still offered.
  const knownGoalIds = new Set(goals.map((g) => g.id))
  const typeOn = (f: SessionFilters, t: FilterType): boolean => {
    if (t === 'tag') return f.tagIds.some((tagId) => knownTagIds.has(tagId))
    if (t === 'goal') return f.goalIds.some((goalId) => knownGoalIds.has(goalId))
    return isTypeOn(f, t)
  }

  const anyOpen = open !== null
  useEffect(() => {
    if (!anyOpen) return
    const onMouseDown = (e: MouseEvent): void => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target) === true) return
      setOpen(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [anyOpen])

  useEffect(() => {
    if (refocus === null) return
    const typeRow = {
      'type-tag': tagRowRef,
      'type-folder': folderRowRef,
      'type-goal': goalRowRef,
      'type-launched': launchedRowRef,
      'type-ended': endedRowRef,
      'type-session': sessionRowRef,
      'type-updated': updatedRowRef,
      'type-sessionDeleted': sessionDeletedRowRef
    }[refocus.key]
    if (typeRow !== undefined) {
      typeRow.current?.focus()
      return
    }
    const target = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>('[data-filter-focus]') ?? [])
    ].find(
      // A leaving (inert) copy of a list may still hold a row with the same key.
      (el) => el.dataset.filterFocus === refocus.key && el.closest('[inert]') === null
    )
    target?.focus()
  }, [refocus])

  // The calendar takes focus on its focused day as it opens (Escape still peels it).
  const calendarKey = open?.at === 'calendar' ? `${open.from}-${open.type}-${open.mode}` : null
  useEffect(() => {
    if (calendarKey === null) return
    rootRef.current?.querySelector<HTMLElement>('[role="grid"] button[tabindex="0"]')?.focus()
  }, [calendarKey])

  /** The edge a popup under `trigger` lines up with: its left edge while the widest list fits
   *  in the window, else its right edge. */
  function alignUnder(trigger: Element | null | undefined): PopupAlign {
    if (trigger === null || trigger === undefined) return 'start'
    return popupAlign(trigger.getBoundingClientRect().left, window.innerWidth)
  }

  /** Focus `key` (a `data-filter-focus` value, or `type-<type>`) after the next render. */
  function refocusOn(key: string): void {
    setRefocus((r) => ({ key, n: (r?.n ?? 0) + 1 }))
  }

  function closeTo(key: string): void {
    setOpen(null)
    refocusOn(key)
  }

  /** After a single pick: back to `+ Add filter` if it opened the list and is still drawn,
   *  else to the pill of the type just set. */
  function triggerAfter(next: SessionFilters, from: Origin, type: FilterType): string {
    if (from === 'add' && types.some((t) => !typeOn(next, t))) return 'add'
    return `pill-${type}`
  }

  /** Open type `t`'s values beside the type menu. They hang off the MENU's right edge (wider than
   *  the `+ Add filter` button), so that edge picks the side, measured now that the menu is
   *  drawn. */
  function openSub(t: FilterType, fromKey: boolean): void {
    const right = typeMenu?.getBoundingClientRect().right ?? 0
    setSide(submenuSide(right, window.innerWidth))
    setOpen((o) => ({
      at: 'add',
      sub: t,
      focus: fromKey ? (o?.at === 'add' ? o.focus : 0) + 1 : 0,
      align: o?.at === 'add' ? o.align : 'start'
    }))
  }

  /** A multi pick (tag, folder, goal, session): the list stays open, under the pill from now on.
   *  A single-pick type closes its list instead, like a preset. */
  function multiPick(type: 'tag' | ListType, next: SessionFilters, rowKey: string): void {
    if (type !== 'tag' && single.includes(type)) {
      onChange(next)
      closeTo(triggerAfter(next, open?.at === 'pill' ? 'pill' : 'add', type))
      return
    }
    if (open?.at === 'pill') {
      onChange(next)
    } else {
      // The list moves under the pill this pick draws: draw it now, so it can be measured.
      flushSync(() => onChange(next))
    }
    if (typeOn(next, type)) {
      const align =
        open?.at === 'pill'
          ? open.align
          : alignUnder(rootRef.current?.querySelector(`[data-filter-pill="${type}"]`))
      setOpen({ at: 'pill', type, align })
      refocusOn(rowKey)
    } else {
      // The last value went off: the pill, and the list under it, are gone.
      closeTo('add')
    }
  }

  function toggleTag(tagId: string): void {
    const on = filters.tagIds.includes(tagId)
    const tagIds = on ? filters.tagIds.filter((x) => x !== tagId) : [...filters.tagIds, tagId]
    multiPick('tag', { ...filters, tagIds }, `tag-row-${tagId}`)
  }

  /** `list` with `value` turned on or off; on a single-pick type, `value` alone. */
  function toggled(type: ListType, list: readonly string[], value: string): string[] {
    if (single.includes(type)) return [value]
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value]
  }

  function toggleFolder(path: string): void {
    const chosen = toggled('folder', filters.folders, path)
    multiPick('folder', { ...filters, folders: chosen }, `folder-row-${path}`)
  }

  function toggleGoal(goalId: string): void {
    const goalIds = toggled('goal', filters.goalIds, goalId)
    multiPick('goal', { ...filters, goalIds }, `goal-row-${goalId}`)
  }

  function toggleSession(name: string): void {
    const sessionNames = toggled('session', filters.sessionNames, name)
    multiPick('session', { ...filters, sessionNames }, `session-row-${name}`)
  }

  /** A toggle type's row in the type menu (it has no values): on at once, and the menu closes. */
  function turnOnDeleted(): void {
    const next = { ...filters, sessionDeleted: true }
    onChange(next)
    closeTo(triggerAfter(next, 'add', 'sessionDeleted'))
  }

  /** A list row's role: a radio on a single-pick type, else a checkbox. */
  function listRole(type: ListType): 'menuitemradio' | 'menuitemcheckbox' {
    return single.includes(type) ? 'menuitemradio' : 'menuitemcheckbox'
  }

  function setTime(type: TimeType, pick: TimePick, from: Origin): void {
    const next = { ...filters, [type]: pick }
    onChange(next)
    closeTo(triggerAfter(next, from, type))
  }

  function remove(type: FilterType): void {
    onChange(clearType(filters, type))
    closeTo('add')
  }

  function createTags(): void {
    setOpen(null)
    onManageTags?.()
  }

  // ArrowDown / ArrowUp move between the rows of the menu that has focus. Escape peels ONE layer
  // (calendar → its list → the type row → closed) and never reaches an Escape handler above it
  // while something is open.
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (moveMenuRow(e)) return
    if (e.key !== 'Escape' || open === null) return
    e.stopPropagation()
    if (open.at === 'calendar') {
      setOpen(
        open.from === 'add'
          ? { at: 'add', sub: open.type, focus: 0, align: open.align }
          : { at: 'pill', type: open.type, align: open.align }
      )
      refocusOn(`${open.type}-row-${open.mode}`)
    } else if (open.at === 'add' && open.sub !== null) {
      setOpen({ at: 'add', sub: null, focus: 0, align: open.align })
      refocusOn(`type-${open.sub}`)
    } else {
      closeTo(open.at === 'add' ? 'add' : `pill-${open.type}`)
    }
  }

  // ---- value lists --------------------------------------------------------------------------

  function tagRows(): ReactNode {
    if (tags.length === 0) {
      return (
        <>
          <TagMenuNote testId={tid('no-tags')}>No tags yet</TagMenuNote>
          {onManageTags !== undefined && (
            <Popover.QuietItem role="menuitem" testId={tid('create-tags')} onClick={createTags}>
              <Popover.ItemIcon>
                <PlusIcon />
              </Popover.ItemIcon>
              Create tags
            </Popover.QuietItem>
          )}
        </>
      )
    }
    return tags.map((t) => (
      <TagMenuRow
        key={t.id}
        tag={t}
        checked={filters.tagIds.includes(t.id)}
        role="menuitemcheckbox"
        testId={tid(`tag-row-${t.id}`)}
        focusKey={`tag-row-${t.id}`}
        where={
          (nameCount.get(t.name) ?? 0) > 1 ? (
            <ScopeMarker workspaceId={t.workspaceId} workspaces={workspaces} />
          ) : undefined
        }
        onClick={() => toggleTag(t.id)}
      />
    ))
  }

  /** Every folder the list shows, in list order: the surface's, plus any picked one. */
  function folderList(): string[] {
    return [...new Set([...folders, ...filters.folders])].sort(byFolderName)
  }

  /** The `data-filter-focus` key of the first row in `type`'s list (a pill's key open). */
  function firstRowKey(type: FilterType): string {
    if (type === 'tag') return `tag-row-${tags[0]?.id ?? ''}`
    if (type === 'folder') return `folder-row-${folderList()[0] ?? ''}`
    if (type === 'goal') return `goal-row-${goals[0]?.id ?? ''}`
    if (type === 'session') return `session-row-${sessionList()[0] ?? ''}`
    return `${type}-row-${PRESETS[0] ?? 'today'}`
  }

  function folderRows(): ReactNode {
    return folderList().map((path) => {
      const checked = filters.folders.includes(path)
      const parent = parentPath(path)
      return (
        <Popover.Item
          key={path}
          role={listRole('folder')}
          aria-checked={checked}
          testId={tid(`folder-row-${path}`)}
          data-filter-focus={`folder-row-${path}`}
          title={path}
          onClick={() => toggleFolder(path)}
        >
          <span className={styles.folderName}>{folderName(path)}</span>
          {parent !== '' && <span className={styles.path}>{parent}</span>}
          {checked && <Check />}
        </Popover.Item>
      )
    })
  }

  function goalRows(): ReactNode {
    if (goals.length === 0) return <TagMenuNote testId={tid('no-goals')}>No goals yet</TagMenuNote>
    return goals.map((g) => {
      const checked = filters.goalIds.includes(g.id)
      return (
        <Popover.Item
          key={g.id}
          role={listRole('goal')}
          aria-checked={checked}
          testId={tid(`goal-row-${g.id}`)}
          data-filter-focus={`goal-row-${g.id}`}
          onClick={() => toggleGoal(g.id)}
        >
          {g.name}
          {checked && <Check />}
        </Popover.Item>
      )
    })
  }

  /** Session names in list order. */
  function sessionList(): string[] {
    return [...new Set([...sessionNames, ...filters.sessionNames])].sort((a, b) =>
      a.localeCompare(b)
    )
  }

  function sessionRows(): ReactNode {
    const names = sessionList()
    if (names.length === 0) {
      return <TagMenuNote testId={tid('no-sessions')}>No sessions yet</TagMenuNote>
    }
    return names.map((name) => {
      const checked = filters.sessionNames.includes(name)
      return (
        <Popover.Item
          key={name}
          role={listRole('session')}
          aria-checked={checked}
          testId={tid(`session-row-${name}`)}
          data-filter-focus={`session-row-${name}`}
          title={name}
          onClick={() => toggleSession(name)}
        >
          {name}
          {checked && <Check />}
        </Popover.Item>
      )
    })
  }

  /** A list type's rows. */
  function listRows(type: ListType): ReactNode {
    if (type === 'folder') return folderRows()
    if (type === 'goal') return goalRows()
    return sessionRows()
  }

  function timeRows(type: TimeType, from: Origin): ReactNode {
    const pick = filters[type]
    return (
      <>
        {PRESETS.map((range) => {
          const checked = pick?.kind === 'preset' && pick.range === range
          return (
            <Popover.Item
              key={range}
              role="menuitemradio"
              aria-checked={checked}
              testId={tid(`${type}-row-${range}`)}
              data-filter-focus={`${type}-row-${range}`}
              onClick={() => setTime(type, { kind: 'preset', range }, from)}
            >
              {TIME_RANGE_LABEL[range]}
              {checked && <Check />}
            </Popover.Item>
          )
        })}
        <Popover.Divider />
        {DAY_MODES.map((mode) => (
          <Popover.Item
            key={mode}
            role="menuitemradio"
            aria-checked={pick?.kind === mode}
            testId={tid(`${type}-row-${mode}`)}
            data-filter-focus={`${type}-row-${mode}`}
            onClick={() =>
              setOpen({ at: 'calendar', type, mode, from, align: open?.align ?? 'start' })
            }
          >
            <Popover.ItemIcon>
              <CalendarIcon />
            </Popover.ItemIcon>
            {timePickRowLabel(pick, mode)}
            {pick?.kind === mode && <Check />}
          </Popover.Item>
        ))}
      </>
    )
  }

  /** The values of `type` as a submenu's content (tags and folders scroll in a Popover.List). */
  function submenuValues(type: FilterType): ReactNode {
    if (type === 'tag') return <Popover.List>{tagRows()}</Popover.List>
    if (isTime(type)) return timeRows(type, 'add')
    if (type === 'sessionDeleted') return null
    return <Popover.List>{listRows(type)}</Popover.List>
  }

  function calendar(o: CalendarOpen): JSX.Element {
    const pick = filters[o.type]
    return (
      <Calendar
        mode={o.mode}
        value={pick !== null && pick.kind === o.mode ? pick.day : null}
        now={now}
        onPick={(day) => setTime(o.type, { kind: o.mode, day }, o.from)}
        ariaLabel={`${FILTER_TYPE_LABEL[o.type]} ${o.mode === 'on' ? 'on a day' : 'since a day'}`}
        testId={tid('calendar')}
        align={o.align}
      />
    )
  }

  // ---- pills --------------------------------------------------------------------------------

  /** A pill's visible body, its accessible name and its tooltip. */
  function pillContent(
    type: FilterType
  ): { body: ReactNode; label: string; title?: string } | null {
    const word = FILTER_TYPE_LABEL[type]
    if (type === 'tag') {
      // Only the tags this surface still knows: a gone id draws no chip and is not counted.
      const picked = tags.filter((t) => filters.tagIds.includes(t.id))
      if (picked.length === 0) return null
      return {
        body: (
          <>
            <span className={styles.pillKey}>{picked.length > 1 ? 'Tag is any of' : 'Tag is'}</span>
            <span className={styles.pillTags}>
              <TagChipRow tags={picked} testId={tid('pill-tag-chips')} />
            </span>
          </>
        ),
        label: `${word} filter: ${picked.map((t) => t.name).join(', ')}. Change it`
      }
    }
    if (type === 'folder') {
      const paths = [...filters.folders].sort(byFolderName)
      const names = paths.map(folderName).join(', ')
      const text = paths.length > 1 ? `Folder is any of ${names}` : `Folder is ${names}`
      return {
        body: <span className={styles.pillKey}>{text}</span>,
        label: `${word} filter: ${names}. Change it`,
        title: paths.join('\n')
      }
    }
    if (type === 'goal' || type === 'session') {
      // Only the goals this surface still offers: a gone id draws no name and is not counted.
      const picked =
        type === 'goal'
          ? goals.filter((g) => filters.goalIds.includes(g.id)).map((g) => g.name)
          : filters.sessionNames
      if (picked.length === 0) return null
      const names = picked.join(', ')
      return {
        body: (
          <span className={styles.pillKey}>
            {picked.length > 1 ? `${word} is any of ${names}` : `${word} is ${names}`}
          </span>
        ),
        label: `${word} filter: ${names}. Change it`
      }
    }
    if (type === 'sessionDeleted') {
      return filters.sessionDeleted ? { body: null, label: word } : null
    }
    const pick = filters[type]
    if (pick === null) return null
    const value =
      pick.kind === 'preset' ? TIME_RANGE_LABEL[pick.range] : timePickRowLabel(pick, pick.kind)
    return {
      body: <span className={styles.pillKey}>{timePillText(type, pick)}</span>,
      label: `${word} filter: ${value}. Change it`
    }
  }

  function renderPill(type: FilterType): JSX.Element | null {
    const content = pillContent(type)
    if (content === null) return null
    const list = open?.at === 'pill' && open.type === type ? open : null
    const listOpen = list !== null
    const cal = open?.at === 'calendar' && open.from === 'pill' && open.type === type ? open : null
    return (
      <span key={type} className={styles.anchor}>
        <span className={styles.pill} data-testid={tid(`pill-${type}`)} data-filter-pill={type}>
          {type === 'sessionDeleted' ? (
            <span className={styles.pillLabel}>{content.label}</span>
          ) : (
            <button
              type="button"
              className={styles.pillEdit}
              data-testid={tid(`pill-${type}-edit`)}
              data-filter-focus={`pill-${type}`}
              aria-haspopup="menu"
              aria-expanded={listOpen || cal !== null}
              aria-label={content.label}
              {...(content.title !== undefined ? { title: content.title } : {})}
              onClick={(e) => {
                if (listOpen || cal !== null) {
                  setOpen(null)
                  return
                }
                setOpen({ at: 'pill', type, align: alignUnder(e.currentTarget) })
                if (e.detail === 0) refocusOn(firstRowKey(type))
              }}
            >
              {content.body}
            </button>
          )}
          <button
            type="button"
            className={styles.pillRemove}
            data-testid={tid(`pill-${type}-remove`)}
            {...(type === 'sessionDeleted' ? { 'data-filter-focus': `pill-${type}` } : {})}
            aria-label={removeFilterLabel(type)}
            title={removeFilterLabel(type)}
            onClick={() => remove(type)}
          >
            ×
          </button>
        </span>
        <Presence value={list}>
          {(l, leaving) =>
            type === 'tag' ? (
              <TagMenu
                align={l.align}
                role="menu"
                ariaLabel={FILTER_TYPE_LABEL.tag}
                testId={tid('tag-list')}
              >
                {tagRows()}
              </TagMenu>
            ) : (
              <div className={styles.menuWrap} {...leavingProps(leaving)}>
                <Popover.Surface
                  data-align={l.align}
                  role="menu"
                  aria-label={FILTER_TYPE_LABEL[type]}
                  testId={tid(`${type}-list`)}
                >
                  {isTime(type) ? (
                    timeRows(type, 'pill')
                  ) : type === 'sessionDeleted' ? null : (
                    <Popover.List>{listRows(type)}</Popover.List>
                  )}
                </Popover.Surface>
              </div>
            )
          }
        </Presence>
        {isTime(type) && <Presence value={cal}>{(o) => calendar(o)}</Presence>}
      </span>
    )
  }

  // ---- + Add filter -------------------------------------------------------------------------

  const offTypes = types.filter((t) => !typeOn(filters, t))
  const addCal = open?.at === 'calendar' && open.from === 'add' ? open : null
  const addOpen = open?.at === 'add' || addCal !== null

  function renderAdd(): JSX.Element {
    return (
      <span className={styles.anchor}>
        <button
          type="button"
          className={styles.add}
          data-testid={tid('add')}
          data-filter-focus="add"
          aria-haspopup="menu"
          aria-expanded={addOpen}
          onClick={(e) => {
            if (addOpen) {
              setOpen(null)
              return
            }
            setOpen({ at: 'add', sub: null, focus: 0, align: alignUnder(e.currentTarget) })
            const first = offTypes[0]
            if (e.detail === 0 && first !== undefined) refocusOn(`type-${first}`)
          }}
        >
          + Add filter
        </button>
        <Presence value={open?.at === 'add' ? open : null}>
          {(a, leaving) => (
            <div className={styles.menuWrap} {...leavingProps(leaving)}>
              <Popover.Surface
                data-align={a.align}
                role="menu"
                aria-label="Add a filter"
                testId={tid('type-menu')}
                surfaceRef={setTypeMenu}
              >
                {offTypes.map((t) => {
                  if (t === 'sessionDeleted') {
                    return (
                      <Popover.Item
                        key={t}
                        role="menuitem"
                        buttonRef={sessionDeletedRowRef}
                        testId={tid(`type-${t}`)}
                        onMouseEnter={() =>
                          setOpen({ at: 'add', sub: null, focus: 0, align: open?.align ?? 'start' })
                        }
                        onClick={turnOnDeleted}
                      >
                        <Popover.ItemIcon>{typeIcon(t)}</Popover.ItemIcon>
                        {FILTER_TYPE_LABEL[t]}
                      </Popover.Item>
                    )
                  }
                  const subOpen = open?.at === 'add' && open.sub === t
                  return (
                    <Popover.Submenu
                      key={t}
                      side={side}
                      label={FILTER_TYPE_LABEL[t]}
                      icon={typeIcon(t)}
                      open={subOpen}
                      focusRequest={subOpen ? open.focus : 0}
                      triggerRef={typeRefs[t]}
                      onOpen={() => openSub(t, false)}
                      onOpenFromKey={() => openSub(t, true)}
                      onBack={() => {
                        setOpen({ at: 'add', sub: null, focus: 0, align: open?.align ?? 'start' })
                        refocusOn(`type-${t}`)
                      }}
                      testId={tid(`type-${t}`)}
                      listTestId={tid(`${t}-list`)}
                    >
                      {submenuValues(t)}
                    </Popover.Submenu>
                  )
                })}
              </Popover.Surface>
            </div>
          )}
        </Presence>
        <Presence value={addCal}>{(o) => calendar(o)}</Presence>
      </span>
    )
  }

  return (
    <div
      id={id}
      ref={rootRef}
      className={styles.chipRow}
      data-filter-chips=""
      data-testid={tid('chips')}
      {...(wrap ? { 'data-wrap': '' } : {})}
      onKeyDown={handleKeyDown}
    >
      {types.filter((t) => typeOn(filters, t)).map(renderPill)}
      {offTypes.length > 0 && renderAdd()}
    </div>
  )
}
