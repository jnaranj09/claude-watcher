// Calendar (spec 2026-10-16 §3) — the in-house day picker for the Launched / Ended filters.
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Calendar } from './Calendar'

// No RTL auto-cleanup in this project (test/setup.ts): unmount what each test rendered.
let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
})

const NOW = (): number => new Date(2026, 9, 16, 15, 0).getTime()
const dayName = (d: number): string =>
  new Date(2026, 9, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

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

  it('the previous-month arrow stops 12 months back', async () => {
    setup()
    const prev = screen.getByRole('button', { name: 'Previous month' })
    for (let i = 0; i < 12; i++) await userEvent.click(prev)
    expect(prev).toBeDisabled()
  })

  it('shows the hint for its mode', () => {
    setup(null, 'since')
    expect(screen.getByText('From the picked day up to today.')).toBeVisible()
  })
})
