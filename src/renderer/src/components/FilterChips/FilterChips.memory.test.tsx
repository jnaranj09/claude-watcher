// FilterChips — the types only the Memory dialog offers (spec 2026-11-11 memory §8): Session (a
// session name), Updated (the time types' presets and days), Session deleted (on or off, no
// values), and single picks (main takes ONE folder, session and goal).
import { afterEach, describe, it, expect } from 'vitest'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type JSX } from 'react'
import { FilterChips, type FilterChipsProps } from './FilterChips'
import { NO_FILTERS, activeFilterCount, type SessionFilters } from '../../lib/sessionFilters'

// No RTL auto-cleanup in this project (test/setup.ts): unmount what each test rendered.
const mounted: (() => void)[] = []
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

const NOW = (): number => new Date(2026, 10, 12, 15, 0).getTime()

function Harness(
  p: Partial<FilterChipsProps> & { start?: SessionFilters; spy?: (f: SessionFilters) => void }
): JSX.Element {
  const [filters, setFilters] = useState<SessionFilters>(p.start ?? NO_FILTERS)
  return (
    <FilterChips
      id="chips"
      filters={filters}
      onChange={(f) => {
        p.spy?.(f)
        setFilters(f)
      }}
      types={p.types ?? ['folder', 'session', 'goal', 'updated', 'sessionDeleted']}
      tags={[]}
      folders={p.folders ?? ['/srv/acme/api', '/srv/acme/web']}
      goals={p.goals ?? [{ id: 'g-1', name: 'Ship v2' }]}
      sessionNames={p.sessionNames ?? ['fix-health-check', 'release-2.4']}
      single={p.single ?? ['folder', 'session', 'goal']}
      now={NOW}
      testIdPrefix="memory-filter"
    />
  )
}

function render(ui: JSX.Element): void {
  mounted.push(rtlRender(ui).unmount)
}

const addFilter = (): HTMLElement => screen.getByRole('button', { name: '+ Add filter' })

describe('FilterChips — Session', () => {
  it('lists the offered session names and draws a Session is pill', async () => {
    let last: SessionFilters = NO_FILTERS
    render(<Harness spy={(f) => (last = f)} />)
    await userEvent.click(addFilter())
    await userEvent.hover(screen.getByRole('menuitem', { name: /Session$/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'release-2.4' }))
    expect(screen.getByText('Session is release-2.4')).toBeVisible()
    expect(last.sessionNames).toEqual(['release-2.4'])
  })
})

describe('FilterChips — single picks', () => {
  it('a single-pick folder replaces the pick and closes the list', async () => {
    let last: SessionFilters = NO_FILTERS
    render(<Harness spy={(f) => (last = f)} />)
    await userEvent.click(addFilter())
    await userEvent.hover(screen.getByRole('menuitem', { name: /Folder/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^api/ }))
    expect(screen.getByText('Folder is api')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Folder filter/ }))
    expect(screen.getByRole('menuitemradio', { name: /^api/ })).toBeChecked()
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^web/ }))
    expect(last.folders).toEqual(['/srv/acme/web'])
    expect(screen.getByText('Folder is web')).toBeVisible()
  })

  it('a single-pick goal sets one goal', async () => {
    let last: SessionFilters = NO_FILTERS
    render(<Harness spy={(f) => (last = f)} />)
    await userEvent.click(addFilter())
    await userEvent.hover(screen.getByRole('menuitem', { name: /Goal/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Ship v2' }))
    expect(last.goalIds).toEqual(['g-1'])
    expect(screen.getByText('Goal is Ship v2')).toBeVisible()
  })
})

describe('FilterChips — Updated', () => {
  it('a preset draws an Updated pill', async () => {
    let last: SessionFilters = NO_FILTERS
    render(<Harness spy={(f) => (last = f)} />)
    await userEvent.click(addFilter())
    await userEvent.hover(screen.getByRole('menuitem', { name: /Updated/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Last 7 days' }))
    expect(screen.getByText('Updated in last 7 days')).toBeVisible()
    expect(last.updated).toEqual({ kind: 'preset', range: '7d' })
  })
})

describe('FilterChips — Session deleted', () => {
  it('its type row turns it on at once: no values, a pill with only its name and ×', async () => {
    let last: SessionFilters = NO_FILTERS
    render(<Harness spy={(f) => (last = f)} />)
    await userEvent.click(addFilter())
    await userEvent.click(screen.getByRole('menuitem', { name: 'Session deleted' }))
    expect(last.sessionDeleted).toBe(true)
    expect(activeFilterCount(last)).toBe(1)
    expect(screen.getByTestId('memory-filter-pill-sessionDeleted')).toHaveTextContent(
      'Session deleted'
    )
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Remove the session deleted filter' }))
    expect(last.sessionDeleted).toBe(false)
  })
})
