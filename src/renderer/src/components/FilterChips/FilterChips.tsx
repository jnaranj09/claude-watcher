// FilterChips (spec 2026-10-16 §3) — the ONE chip row: the board's filter bar and the Sessions
// dialog's Active / Past rails all render it. Controlled: the caller owns `filters` (the board
// per workspace in boardStore, the pages per scope in local state) and gets every change through
// `onChange`. One pill per type that is on, in `types` order; `+ Add filter` opens a type menu
// whose rows open their values beside them (`Popover.Submenu`); a pill opens the same values under
// itself. Multi-pick lists (tags, folders) stay open; single picks (a preset, a calendar day) close.
//
// A multi pick made from the type menu turns that type ON, which takes its row out of the type
// menu (a type that is on is not offered twice). So the list moves under the new pill and stays
// open there (mockup step 2): the next pick lands in the same list. The `On a day` / `Since a day`
// rows swap their list for the Calendar, drawn under the trigger that opened the list.
//
// Every popup floats over what is below (the operator: "show over them, never push the board
// columns down"): the row is a stacking context above the board, each popup is positioned.
import {
  createRef,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode
} from 'react'
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
  timePillText
} from '../../lib/filterCopy'
import { Calendar } from '../Calendar/Calendar'
import { CalendarIcon, FolderIcon, PlusIcon } from '../Icon/MenuIcons'
import { Popover } from '../Popover/Popover'
import { Presence } from '../Presence/Presence'
import { leavingProps } from '../Presence/leaving'
import { TagChip } from '../TagChip/TagChip'
import { TagGlyphIcon } from '../TagIndicator/TagGlyphIcon'
import { TagMenu, TagMenuNote, TagMenuRow } from '../TagMenu/TagMenu'
import { submenuSide } from './submenuSide'
import styles from './FilterChips.module.css'

export interface FilterChipsProps {
  /** The chip row's DOM id (the Filter button's aria-controls). */
  id: string
  filters: SessionFilters
  onChange: (next: SessionFilters) => void
  /** Which types this surface offers, in pill order: board/Active ['tag','folder','launched'],
   *  Past ['tag','folder','launched','ended']. */
  types: readonly FilterType[]
  /** Tags offered, in list order (global first, then the workspace's own). */
  tags: readonly Tag[]
  /** Distinct folders of the surface's rows (unsorted is fine; sorted inside). */
  folders: readonly string[]
  /** The `Create tags` row while no tag exists. Omitted ⇒ no such row. */
  onManageTags?: () => void
  now: () => number
  /** 'filter' on the board (keeps today's test ids), 'active-filter', 'past-filter'. */
  testIdPrefix: string
  /** The rail variant: pills wrap onto new lines (`data-wrap`). The board leaves it off. */
  wrap?: boolean
}

type TimeType = 'launched' | 'ended'
type Origin = 'add' | 'pill'
type CalendarOpen = { at: 'calendar'; type: TimeType; mode: 'on' | 'since'; from: Origin }
/** What is open: nothing, the type menu (with one submenu, `focus` grows when a KEY opened it),
 *  a pill's list, or the calendar that replaced a time list. */
type Open =
  | null
  | { at: 'add'; sub: FilterType | null; focus: number }
  | { at: 'pill'; type: FilterType }
  | CalendarOpen

const PRESETS: readonly TimeRange[] = ['today', '7d', '30d']
const DAY_MODES = ['on', 'since'] as const

function isTime(type: FilterType): type is TimeType {
  return type === 'launched' || type === 'ended'
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
  // so focus moves in an effect, by test id, after that render.
  const [refocus, setRefocus] = useState<{ testId: string; n: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const addAnchorRef = useRef<HTMLSpanElement | null>(null)
  const [typeRefs] = useState(() => ({
    tag: createRef<HTMLButtonElement>(),
    folder: createRef<HTMLButtonElement>(),
    launched: createRef<HTMLButtonElement>(),
    ended: createRef<HTMLButtonElement>()
  }))

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
    const target = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>('[data-testid]') ?? [])
    ].find(
      // A leaving (inert) copy of a list may still hold a row with the same id.
      (el) => el.dataset.testid === refocus.testId && el.closest('[inert]') === null
    )
    target?.focus()
  }, [refocus])

  // The calendar takes focus on its focused day as it opens (Escape still peels it).
  const calendarKey = open?.at === 'calendar' ? `${open.from}-${open.type}-${open.mode}` : null
  useEffect(() => {
    if (calendarKey === null) return
    rootRef.current?.querySelector<HTMLElement>('[role="grid"] button[tabindex="0"]')?.focus()
  }, [calendarKey])

  function refocusOn(testId: string): void {
    setRefocus((r) => ({ testId, n: (r?.n ?? 0) + 1 }))
  }

  function closeTo(testId: string): void {
    setOpen(null)
    refocusOn(testId)
  }

  /** After a single pick: back to `+ Add filter` if it opened the list and is still drawn,
   *  else to the pill of the type just set. */
  function triggerAfter(next: SessionFilters, from: Origin, type: FilterType): string {
    if (from === 'add' && types.some((t) => !isTypeOn(next, t))) return tid('add')
    return tid(`pill-${type}-edit`)
  }

  function openAdd(): void {
    const right = addAnchorRef.current?.getBoundingClientRect().right ?? 0
    setSide(submenuSide(right, window.innerWidth))
    setOpen({ at: 'add', sub: null, focus: 0 })
  }

  /** A multi pick (tag, folder): the list stays open, under the pill from now on. */
  function multiPick(type: 'tag' | 'folder', next: SessionFilters, rowTestId: string): void {
    onChange(next)
    if (isTypeOn(next, type)) {
      setOpen({ at: 'pill', type })
      refocusOn(rowTestId)
    } else {
      // The last value went off: the pill, and the list under it, are gone.
      closeTo(tid('add'))
    }
  }

  function toggleTag(tagId: string): void {
    const on = filters.tagIds.includes(tagId)
    const tagIds = on ? filters.tagIds.filter((x) => x !== tagId) : [...filters.tagIds, tagId]
    multiPick('tag', { ...filters, tagIds }, tid(`tag-row-${tagId}`))
  }

  function toggleFolder(path: string): void {
    const on = filters.folders.includes(path)
    const chosen = on ? filters.folders.filter((x) => x !== path) : [...filters.folders, path]
    multiPick('folder', { ...filters, folders: chosen }, tid(`folder-row-${path}`))
  }

  function setTime(type: TimeType, pick: TimePick, from: Origin): void {
    const next = { ...filters, [type]: pick }
    onChange(next)
    closeTo(triggerAfter(next, from, type))
  }

  function remove(type: FilterType): void {
    onChange(clearType(filters, type))
    closeTo(tid('add'))
  }

  function createTags(): void {
    setOpen(null)
    onManageTags?.()
  }

  // Escape peels ONE layer (calendar → its list → the type row → closed) and never reaches an
  // Escape handler above it while something is open.
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'Escape' || open === null) return
    e.stopPropagation()
    if (open.at === 'calendar') {
      setOpen(
        open.from === 'add'
          ? { at: 'add', sub: open.type, focus: 0 }
          : { at: 'pill', type: open.type }
      )
      refocusOn(tid(`${open.type}-row-${open.mode}`))
    } else if (open.at === 'add' && open.sub !== null) {
      setOpen({ at: 'add', sub: null, focus: 0 })
      refocusOn(tid(`type-${open.sub}`))
    } else {
      closeTo(open.at === 'add' ? tid('add') : tid(`pill-${open.type}-edit`))
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
        onClick={() => toggleTag(t.id)}
      />
    ))
  }

  function folderRows(): ReactNode {
    const all = [...new Set([...folders, ...filters.folders])].sort(byFolderName)
    return all.map((path) => {
      const checked = filters.folders.includes(path)
      const parent = parentPath(path)
      return (
        <Popover.Item
          key={path}
          role="menuitemcheckbox"
          aria-checked={checked}
          testId={tid(`folder-row-${path}`)}
          onClick={() => toggleFolder(path)}
        >
          {folderName(path)}
          {parent !== '' && <span className={styles.path}>{parent}</span>}
          {checked && <Check />}
        </Popover.Item>
      )
    })
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
            role="menuitem"
            testId={tid(`${type}-row-${mode}`)}
            onClick={() => setOpen({ at: 'calendar', type, mode, from })}
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
    if (type === 'folder') return <Popover.List>{folderRows()}</Popover.List>
    return timeRows(type, 'add')
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
      const picked = tags.filter((t) => filters.tagIds.includes(t.id))
      return {
        body: (
          <>
            <span className={styles.pillKey}>
              {filters.tagIds.length > 1 ? 'Tag is any of' : 'Tag is'}
            </span>
            {picked.map((t) => (
              <TagChip key={t.id} tag={t} />
            ))}
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
    const listOpen = open?.at === 'pill' && open.type === type
    const cal = open?.at === 'calendar' && open.from === 'pill' && open.type === type ? open : null
    return (
      <span key={type} className={styles.anchor}>
        <span className={styles.pill} data-testid={tid(`pill-${type}`)} data-filter-pill={type}>
          <button
            type="button"
            className={styles.pillEdit}
            data-testid={tid(`pill-${type}-edit`)}
            aria-haspopup="menu"
            aria-expanded={listOpen || cal !== null}
            aria-label={content.label}
            {...(content.title !== undefined ? { title: content.title } : {})}
            onClick={() => setOpen(listOpen || cal !== null ? null : { at: 'pill', type })}
          >
            {content.body}
          </button>
          <button
            type="button"
            className={styles.pillRemove}
            data-testid={tid(`pill-${type}-remove`)}
            aria-label={removeFilterLabel(type)}
            title={removeFilterLabel(type)}
            onClick={() => remove(type)}
          >
            ×
          </button>
        </span>
        <Presence value={listOpen || null}>
          {(_, leaving) =>
            type === 'tag' ? (
              <TagMenu
                align="start"
                role="menu"
                ariaLabel={FILTER_TYPE_LABEL.tag}
                testId={tid('tag-list')}
              >
                {tagRows()}
              </TagMenu>
            ) : (
              <div className={styles.menuWrap} {...leavingProps(leaving)}>
                <Popover.Surface
                  role="menu"
                  aria-label={FILTER_TYPE_LABEL[type]}
                  testId={tid(`${type}-list`)}
                >
                  {type === 'folder' ? (
                    <Popover.List>{folderRows()}</Popover.List>
                  ) : (
                    timeRows(type, 'pill')
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

  const offTypes = types.filter((t) => !isTypeOn(filters, t))
  const addCal = open?.at === 'calendar' && open.from === 'add' ? open : null
  const addOpen = open?.at === 'add' || addCal !== null

  function renderAdd(): JSX.Element {
    return (
      <span className={styles.anchor} ref={addAnchorRef}>
        <button
          type="button"
          className={styles.add}
          data-testid={tid('add')}
          aria-haspopup="menu"
          aria-expanded={addOpen}
          onClick={() => (addOpen ? setOpen(null) : openAdd())}
        >
          + Add filter
        </button>
        <Presence value={open?.at === 'add' || null}>
          {(_, leaving) => (
            <div className={styles.menuWrap} {...leavingProps(leaving)}>
              <Popover.Surface role="menu" aria-label="Add a filter" testId={tid('type-menu')}>
                {offTypes.map((t) => {
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
                      onOpen={() => setOpen({ at: 'add', sub: t, focus: 0 })}
                      onOpenFromKey={() =>
                        setOpen((o) => ({
                          at: 'add',
                          sub: t,
                          focus: (o?.at === 'add' ? o.focus : 0) + 1
                        }))
                      }
                      onBack={() => {
                        setOpen({ at: 'add', sub: null, focus: 0 })
                        refocusOn(tid(`type-${t}`))
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
      {types.filter((t) => isTypeOn(filters, t)).map(renderPill)}
      {offTypes.length > 0 && renderAdd()}
    </div>
  )
}
