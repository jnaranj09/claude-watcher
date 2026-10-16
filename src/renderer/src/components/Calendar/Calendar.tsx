// Calendar (spec 2026-10-16 §3) — the in-house day picker behind the `On a day` / `Since a day`
// rows of the Launched / Ended filters. No native date input (technical-taste §3): drawn with
// Popover.Surface so it looks and themes like every other popup. Monday first, today outlined,
// the pick LIT, future days off, 12 months back at most. Roving focus over the day buttons: arrows
// move a day / a week, PageUp / PageDown a month, Enter / Space pick (a button's own click).
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { Button } from '../Button/Button'
import { Popover } from '../Popover/Popover'
import { leavingProps, useLeaving } from '../Presence/leaving'
import { dayKey, dayWindow } from '../../lib/sessionFilters'
import {
  addMonths,
  CALENDAR_BACK_MONTHS,
  monthOf,
  monthTitle,
  monthWeeks,
  sameDayInMonth,
  shiftDay,
  type MonthRef
} from './calendarGrid'
import styles from './Calendar.module.css'

export interface CalendarProps {
  mode: 'on' | 'since'
  /** The day picked now, or null. */
  value: string | null
  now: () => number
  onPick: (day: string) => void
  ariaLabel: string
  testId: string
  /** The trigger edge it lines up with: `end` near the window's right edge (FilterChips). */
  align: 'start' | 'end'
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const LONG_DAY: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric'
}
const KEY_STEP: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7
}

function monthIndex(m: MonthRef): number {
  return m.year * 12 + m.month
}

export function Calendar({
  mode,
  value,
  now,
  onPick,
  ariaLabel,
  testId,
  align
}: CalendarProps): JSX.Element {
  const leaving = useLeaving()
  const today = dayKey(now())
  const thisMonth = monthOf(today)
  const oldest = addMonths(thisMonth, -CALENDAR_BACK_MONTHS)
  const [shown, setShown] = useState<MonthRef>(() => monthOf(value ?? today))
  const [focused, setFocused] = useState<string>(value ?? today)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const focusMoved = useRef(false)

  // Roving focus: after a KEY moved the focused day, put DOM focus on its button.
  useEffect(() => {
    if (!focusMoved.current) return
    focusMoved.current = false
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus()
  }, [focused, shown])

  const canPrev = monthIndex(shown) > monthIndex(oldest)
  const canNext = monthIndex(shown) < monthIndex(thisMonth)

  /** Show month `m`, keeping the focused day on the same day number (never past today). */
  function showMonth(m: MonthRef): void {
    const day = sameDayInMonth(focused, m)
    setShown(m)
    setFocused(day > today ? today : day)
  }

  function moveFocus(day: string): void {
    const clamped = day > today ? today : day
    const m = monthOf(clamped)
    if (monthIndex(m) < monthIndex(oldest)) return
    focusMoved.current = true
    setFocused(clamped)
    setShown(m)
  }

  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const by = KEY_STEP[e.key]
    if (by !== undefined) {
      e.preventDefault()
      moveFocus(shiftDay(focused, by))
      return
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      moveFocus(sameDayInMonth(focused, addMonths(monthOf(focused), e.key === 'PageUp' ? -1 : 1)))
    }
  }

  const inRange = (d: string): boolean =>
    mode === 'since' && value !== null && d >= value && d <= today

  return (
    <div className={styles.wrap} {...leavingProps(leaving)}>
      <Popover.Surface aria-label={ariaLabel} testId={testId} data-align={align}>
        <div className={styles.head}>
          <Button
            variant="ghost"
            size="sm"
            icon
            testId={`${testId}-prev`}
            aria-label="Previous month"
            disabled={!canPrev}
            onClick={() => showMonth(addMonths(shown, -1))}
          >
            ‹
          </Button>
          <span className={styles.title} aria-live="polite">
            {monthTitle(shown)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon
            testId={`${testId}-next`}
            aria-label="Next month"
            disabled={!canNext}
            onClick={() => showMonth(addMonths(shown, 1))}
          >
            ›
          </Button>
        </div>
        <div
          role="grid"
          aria-label={monthTitle(shown)}
          className={styles.grid}
          ref={gridRef}
          onKeyDown={onGridKeyDown}
        >
          <div role="row" className={styles.row}>
            {WEEKDAYS.map((w) => (
              <span role="columnheader" key={w} className={styles.weekday}>
                {w}
              </span>
            ))}
          </div>
          {monthWeeks(shown).map((week) => (
            <div role="row" className={styles.row} key={week.find((d) => d !== null) ?? ''}>
              {week.map((d, j) =>
                d === null ? (
                  <span role="gridcell" key={`pad-${j}`} className={styles.pad} />
                ) : (
                  <span role="gridcell" key={d}>
                    <button
                      type="button"
                      className={styles.day}
                      data-day={d}
                      aria-label={new Date(dayWindow(d).start).toLocaleDateString(
                        undefined,
                        LONG_DAY
                      )}
                      aria-pressed={d === value}
                      aria-current={d === today ? 'date' : undefined}
                      {...(inRange(d) ? { 'data-in-range': '' } : {})}
                      disabled={d > today}
                      tabIndex={d === focused ? 0 : -1}
                      onClick={() => onPick(d)}
                    >
                      {Number(d.slice(8))}
                    </button>
                  </span>
                )
              )}
            </div>
          ))}
        </div>
        <p className={styles.hint}>
          {mode === 'on' ? 'Pick one day.' : 'From the picked day up to today.'}
        </p>
      </Popover.Surface>
    </div>
  )
}
