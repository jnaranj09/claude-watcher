// Calendar (spec 2026-10-16 §3) — the in-house day picker for the Launched / Ended filters.
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Calendar } from './Calendar'
import { cssRule } from '../../test/cssRule'

// No RTL auto-cleanup in this project (test/setup.ts): unmount what each test rendered.
let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
})

const NOW = (): number => new Date(2026, 9, 16, 15, 0).getTime()
/** A day button's name: the long date (`month` 0-based, like `Date`). */
const longDay = (y: number, m: number, d: number): string =>
  new Date(y, m, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
const dayName = (d: number): string => longDay(2026, 9, d)
const monthName = (y: number, m: number): string =>
  new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

function setup(value: string | null = null, mode: 'on' | 'since' = 'on'): ReturnType<typeof vi.fn> {
  const onPick = vi.fn()
  ;({ unmount } = render(
    <Calendar
      mode={mode}
      value={value}
      now={NOW}
      onPick={onPick}
      ariaLabel="Launched on a day"
      testId="cal"
      align="start"
    />
  ))
  return onPick
}

describe('Calendar', () => {
  it('clicking a past day picks it', async () => {
    const onPick = setup()
    await userEvent.click(screen.getByRole('button', { name: dayName(14) }))
    expect(onPick).toHaveBeenCalledWith('2026-10-14')
  })

  it('future days and the next-month arrow are disabled', () => {
    setup()
    expect(screen.getByRole('button', { name: dayName(17) })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
  })

  it('today is marked current', () => {
    setup()
    expect(screen.getByRole('button', { name: dayName(16) })).toHaveAttribute(
      'aria-current',
      'date'
    )
  })

  it('the picked day is pressed; a since pick also marks the days up to today', () => {
    setup('2026-10-12', 'since')
    expect(screen.getByRole('button', { name: dayName(12) })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: dayName(14) })).toHaveAttribute('data-in-range')
    expect(screen.getByRole('button', { name: dayName(11) })).not.toHaveAttribute('data-in-range')
  })

  it('arrow keys move the focused day and Enter picks it', async () => {
    const onPick = setup('2026-10-14')
    screen.getByRole('button', { name: dayName(14) }).focus()
    await userEvent.keyboard('{ArrowLeft}{ArrowUp}{Enter}')
    expect(onPick).toHaveBeenCalledWith('2026-10-06')
  })

  it('PageDown moves a month, a 31st landing on the 30th of a 30-day month', async () => {
    setup('2026-08-31')
    screen.getByRole('button', { name: longDay(2026, 7, 31) }).focus()
    await userEvent.keyboard('{PageDown}')
    expect(screen.getByRole('button', { name: longDay(2026, 8, 30) })).toHaveFocus()
  })

  it('PageUp moves a month back, a 31st landing on the 30th of a 30-day month', async () => {
    setup('2026-07-31')
    screen.getByRole('button', { name: longDay(2026, 6, 31) }).focus()
    await userEvent.keyboard('{PageUp}')
    expect(screen.getByRole('button', { name: longDay(2026, 5, 30) })).toHaveFocus()
  })

  it('ArrowRight on today keeps the focus on today', async () => {
    setup()
    const today = screen.getByRole('button', { name: dayName(16) })
    today.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(today).toHaveFocus()
    expect(today).toHaveAttribute('tabindex', '0')
  })

  it('the oldest month blocks a further move back', async () => {
    setup('2025-10-05')
    const oldestDay = screen.getByRole('button', { name: longDay(2025, 9, 5) })
    oldestDay.focus()
    await userEvent.keyboard('{PageUp}{ArrowUp}')
    expect(oldestDay).toHaveFocus()
    expect(oldestDay).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('grid')).toHaveAccessibleName(monthName(2025, 9))
  })

  it('the previous-month arrow stops 12 months back', async () => {
    setup()
    const prev = screen.getByRole('button', { name: 'Previous month' })
    for (let i = 0; i < 12; i++) await userEvent.click(prev)
    expect(prev).toBeDisabled()
  })

  it('CSS: marked data-align=end it hangs from the trigger right edge', () => {
    const body = cssRule(
      'components/Calendar/Calendar.module.css',
      ".wrap:has(> [data-align='end'])"
    )
    expect(body).toMatch(/(^|;)\s*right:\s*0;/)
    expect(body).toMatch(/(^|;)\s*left:\s*auto;/)
  })

  it('shows the hint for its mode', () => {
    setup(null, 'since')
    expect(screen.getByText('From the picked day up to today.')).toBeVisible()
  })
})
