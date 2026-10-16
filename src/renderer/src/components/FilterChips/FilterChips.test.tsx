// FilterChips (spec 2026-10-16 §3) — the chip row the board and both Sessions pages share.
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type JSX } from 'react'
import { FilterChips, type FilterChipsProps } from './FilterChips'
import { SUBMENU_ROOM } from './submenuSide'
import { NO_FILTERS, type SessionFilters } from '../../lib/sessionFilters'
import type { Tag } from '../../../../shared/ipc/contract'

// No RTL auto-cleanup in this project (test/setup.ts): unmount what each test rendered.
const mounted: (() => void)[] = []
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})
function render(ui: JSX.Element): { unmount: () => void } {
  const r = rtlRender(ui)
  mounted.push(r.unmount)
  return r
}

const API: Tag = { id: 't-api', name: 'api', color: 'blue', workspaceId: null }
const WEB: Tag = { id: 't-web', name: 'web', color: 'green', workspaceId: null }
const NOW = (): number => new Date(2026, 9, 16, 15, 0).getTime()

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
      types={p.types ?? ['tag', 'folder', 'launched']}
      tags={p.tags ?? [API, WEB]}
      folders={p.folders ?? ['/home/u/infra', '/home/u/api']}
      now={NOW}
      testIdPrefix="filter"
      {...(p.onManageTags ? { onManageTags: p.onManageTags } : {})}
      {...(p.wrap !== undefined ? { wrap: p.wrap } : {})}
    />
  )
}

const addFilter = (): HTMLElement => screen.getByRole('button', { name: '+ Add filter' })
const longDay = (d: number): string =>
  new Date(2026, 9, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
const shortDay = (d: number): string =>
  new Date(2026, 9, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })

describe('FilterChips — adding', () => {
  it('+ Add filter opens the type menu with one row per offered type', async () => {
    render(<Harness />)
    await userEvent.click(addFilter())
    const menu = screen.getByRole('menu', { name: 'Add a filter' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((r) => r.textContent)
    ).toEqual([
      expect.stringContaining('Tag'),
      expect.stringContaining('Folder'),
      expect.stringContaining('Launched')
    ])
  })

  it('picking a folder shows the pill at once and keeps the list open; a second pick reads "any of"', async () => {
    render(<Harness />)
    await userEvent.click(addFilter())
    await userEvent.hover(screen.getByRole('menuitem', { name: /Folder/ }))
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /^api/ }))
    expect(screen.getByText('Folder is api')).toBeVisible()
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /^infra/ }))
    expect(screen.getByText('Folder is any of api, infra')).toBeVisible()
  })

  it('a folder row shows the name, then its parent path; the pill title lists full paths', async () => {
    render(<Harness start={{ ...NO_FILTERS, folders: ['/home/u/api', '/home/u/infra'] }} />)
    expect(screen.getByTestId('filter-pill-folder-edit')).toHaveAttribute(
      'title',
      '/home/u/api\n/home/u/infra'
    )
    await userEvent.click(screen.getByRole('button', { name: /Folder filter/ }))
    const rows = screen.getAllByRole('menuitemcheckbox').map((r) => r.textContent)
    expect(rows).toEqual(['api/home/u✓', 'infra/home/u✓'])
  })

  it('a type that is on leaves the type menu', async () => {
    render(<Harness start={{ ...NO_FILTERS, folders: ['/home/u/api'] }} />)
    await userEvent.click(addFilter())
    expect(screen.queryByRole('menuitem', { name: /Folder/ })).not.toBeInTheDocument()
  })

  it('+ Add filter is gone once every type is on', () => {
    render(
      <Harness
        types={['tag', 'folder']}
        start={{ ...NO_FILTERS, tagIds: ['t-api'], folders: ['/home/u/api'] }}
      />
    )
    expect(screen.queryByRole('button', { name: '+ Add filter' })).not.toBeInTheDocument()
  })

  it('a preset sets the time and closes the list', async () => {
    render(<Harness />)
    await userEvent.click(addFilter())
    await userEvent.hover(screen.getByRole('menuitem', { name: /Launched/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Last 7 days' }))
    expect(screen.getByText('Launched in last 7 days')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('On a day opens the calendar; a day pick sets the filter and closes', async () => {
    render(<Harness />)
    await userEvent.click(addFilter())
    await userEvent.hover(screen.getByRole('menuitem', { name: /Launched/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'On a day' }))
    await userEvent.click(screen.getByRole('button', { name: longDay(14) }))
    expect(screen.getByText(`Launched on ${shortDay(14)}`)).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('grid')).not.toBeInTheDocument())
  })

  it('Ended is offered only when the surface lists it', async () => {
    render(<Harness types={['tag', 'folder', 'launched', 'ended']} />)
    await userEvent.click(addFilter())
    expect(screen.getByRole('menuitem', { name: /Ended/ })).toBeVisible()
  })
})

describe('FilterChips — submenu side', () => {
  const width = window.innerWidth
  afterEach(() => {
    vi.restoreAllMocks()
    window.innerWidth = width
  })

  /** The type menu's right edge at `right`; the `+ Add filter` button far narrower, at 120. */
  function layout(right: number): void {
    window.innerWidth = 1280
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const r = this.dataset.testid === 'filter-type-menu' ? right : 120
      return { right: r, left: 0, top: 0, bottom: 0, width: r, height: 0, x: 0, y: 0 } as DOMRect
    })
  }

  it('opens right while the type menu leaves room for the values', async () => {
    layout(400)
    render(<Harness />)
    await userEvent.click(addFilter())
    await userEvent.hover(screen.getByRole('menuitem', { name: /Folder/ }))
    expect(screen.getByTestId('filter-folder-list')).toHaveAttribute('data-side', 'right')
  })

  it('opens left when the type menu is near the window edge, though the button is not', async () => {
    layout(1100)
    render(<Harness />)
    await userEvent.click(addFilter())
    await userEvent.hover(screen.getByRole('menuitem', { name: /Folder/ }))
    expect(screen.getByTestId('filter-folder-list')).toHaveAttribute('data-side', 'left')
  })
})

describe('FilterChips — popups stay inside the window', () => {
  const width = window.innerWidth
  afterEach(() => {
    vi.restoreAllMocks()
    window.innerWidth = width
  })

  /** Every trigger's left edge at `left` in a 1000px window. */
  function triggersAt(left: number): void {
    window.innerWidth = 1000
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left,
      right: left + 90,
      top: 0,
      bottom: 0,
      width: 90,
      height: 0,
      x: left,
      y: 0
    } as DOMRect)
  }

  const popup = (testId: string): HTMLElement => screen.getByTestId(testId)

  it('the type menu lines up with the trigger left edge while the widest list fits', async () => {
    triggersAt(100)
    render(<Harness />)
    await userEvent.click(addFilter())
    expect(popup('filter-type-menu')).toHaveAttribute('data-align', 'start')
  })

  it('near the right edge the type menu and its calendar line up with the trigger right edge', async () => {
    triggersAt(1000 - SUBMENU_ROOM + 1)
    render(<Harness />)
    await userEvent.click(addFilter())
    expect(popup('filter-type-menu')).toHaveAttribute('data-align', 'end')
    await userEvent.click(screen.getByRole('menuitem', { name: /Launched/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'On a day' }))
    expect(popup('filter-calendar')).toHaveAttribute('data-align', 'end')
  })

  it('a pill near the right edge opens its list from its right edge', async () => {
    triggersAt(950)
    render(<Harness start={{ ...NO_FILTERS, folders: ['/home/u/api'] }} />)
    await userEvent.click(screen.getByTestId('filter-pill-folder-edit'))
    expect(popup('filter-folder-list')).toHaveAttribute('data-align', 'end')
  })

  it('a pill list and its calendar keep the start edge with room', async () => {
    triggersAt(100)
    render(<Harness start={{ ...NO_FILTERS, launched: { kind: 'preset', range: 'today' } }} />)
    await userEvent.click(screen.getByTestId('filter-pill-launched-edit'))
    expect(popup('filter-launched-list')).toHaveAttribute('data-align', 'start')
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'On a day' }))
    expect(popup('filter-calendar')).toHaveAttribute('data-align', 'start')
  })

  it('a first pick from the type menu moves the list under the new pill, measured there', async () => {
    triggersAt(950)
    render(<Harness />)
    await userEvent.click(addFilter())
    await userEvent.click(screen.getByRole('menuitem', { name: /Folder/ }))
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /^api/ }))
    expect(screen.getByTestId('filter-pill-folder')).toBeInTheDocument()
    expect(popup('filter-folder-list')).toHaveAttribute('data-align', 'end')
  })

  it('the tag list under its pill near the right edge lines up with the pill right edge', async () => {
    triggersAt(950)
    render(<Harness start={{ ...NO_FILTERS, tagIds: ['t-api'] }} />)
    await userEvent.click(screen.getByTestId('filter-pill-tag-edit'))
    expect(popup('filter-tag-list')).toHaveAttribute('data-align', 'end')
  })
})

describe('FilterChips — pills', () => {
  it('several tags read "any of" and show one chip row (+N overflow) in tag-list order', () => {
    render(<Harness start={{ ...NO_FILTERS, tagIds: ['t-web', 't-api'] }} />)
    expect(screen.getByText('Tag is any of')).toBeVisible()
    const row = screen.getByTestId('filter-pill-tag-chips')
    expect(
      within(row)
        .getAllByTestId('tag-chip')
        .map((c) => c.textContent)
    ).toEqual(['api', 'web'])
  })

  it('a deleted tag shows no chip and does not count toward "any of"', () => {
    render(<Harness tags={[API]} start={{ ...NO_FILTERS, tagIds: ['t-api', 't-gone'] }} />)
    expect(screen.getByText('Tag is')).toBeVisible()
    expect(screen.queryByText('Tag is any of')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('tag-chip')).toHaveLength(1)
  })

  it('a tag pill whose tags are all gone is not drawn', () => {
    render(<Harness tags={[API]} start={{ ...NO_FILTERS, tagIds: ['t-gone'] }} />)
    expect(screen.queryByTestId('filter-pill-tag')).not.toBeInTheDocument()
  })

  it('names the values in the pill button and keeps types order', () => {
    render(
      <Harness
        start={{
          tagIds: ['t-web', 't-api'],
          folders: [],
          launched: { kind: 'preset', range: 'today' },
          ended: null
        }}
      />
    )
    expect(screen.getByTestId('filter-pill-tag-edit')).toHaveAttribute(
      'aria-label',
      'Tag filter: api, web. Change it'
    )
    expect(screen.getByTestId('filter-pill-launched-edit')).toHaveAttribute(
      'aria-label',
      'Launched filter: Today. Change it'
    )
    const pills = screen.getAllByTestId(/^filter-pill-(tag|folder|launched|ended)$/)
    expect(pills.map((el) => el.dataset.filterPill)).toEqual(['tag', 'launched'])
  })

  it('clicking a pill reopens its list with the picks checked', async () => {
    render(<Harness start={{ ...NO_FILTERS, tagIds: ['t-api'] }} />)
    await userEvent.click(screen.getByRole('button', { name: /Tag filter/ }))
    expect(screen.getByRole('menuitemcheckbox', { name: /api/ })).toBeChecked()
    expect(screen.getByRole('menuitemcheckbox', { name: /web/ })).not.toBeChecked()
  })

  it('a time pill reopens its list naming the current day; its day row reopens the calendar on it', async () => {
    const spy = vi.fn()
    render(
      <Harness
        spy={spy}
        start={{ ...NO_FILTERS, launched: { kind: 'since', day: '2026-10-12' } }}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Launched filter/ }))
    const since = screen.getByRole('menuitemradio', { name: `Since ${shortDay(12)}` })
    expect(since).toBeChecked()
    expect(screen.getByRole('menuitemradio', { name: 'On a day' })).not.toBeChecked()
    await userEvent.click(since)
    expect(screen.getByRole('button', { name: longDay(12) })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await userEvent.click(screen.getByRole('button', { name: longDay(13) }))
    expect(spy).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      launched: { kind: 'since', day: '2026-10-13' }
    })
  })

  it('× removes the whole type', async () => {
    const spy = vi.fn()
    render(<Harness spy={spy} start={{ ...NO_FILTERS, tagIds: ['t-api', 't-web'] }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove the tag filter' }))
    expect(spy).toHaveBeenLastCalledWith(NO_FILTERS)
  })

  it('the rail variant marks the row to wrap; the board leaves it off', () => {
    const { unmount } = render(<Harness wrap />)
    expect(screen.getByTestId('filter-chips')).toHaveAttribute('data-wrap')
    expect(screen.getByTestId('filter-chips')).toHaveAttribute('id', 'chips')
    unmount()
    render(<Harness />)
    expect(screen.getByTestId('filter-chips')).not.toHaveAttribute('data-wrap')
  })
})

describe('FilterChips — keyboard', () => {
  it('Escape peels one layer and gives focus back to the trigger', async () => {
    render(<Harness />)
    addFilter().focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('menu', { name: 'Add a filter' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Add a filter' })).not.toBeInTheDocument()
    expect(addFilter()).toHaveFocus()
  })

  it('ArrowRight opens a type and Space toggles a value', async () => {
    render(<Harness />)
    await userEvent.click(addFilter())
    screen.getByRole('menuitem', { name: /Tag/ }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('menuitemcheckbox', { name: /api/ })).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(screen.getByText('Tag is')).toBeVisible()
  })

  it('Escape from the calendar goes back to its list, then to the type row, then closes', async () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={(e) => e.key === 'Escape' && outer()}>
        <Harness />
      </div>
    )
    addFilter().focus()
    await userEvent.keyboard('{Enter}')
    screen.getByRole('menuitem', { name: /Launched/ }).focus()
    await userEvent.keyboard('{ArrowRight}')
    screen.getByRole('menuitemradio', { name: 'On a day' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('grid')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'On a day' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menuitemradio', { name: 'On a day' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Launched/ })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(addFilter()).toHaveFocus()
    expect(outer).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(outer).toHaveBeenCalledOnce()
  })

  it('a mousedown outside closes every list', async () => {
    render(
      <>
        <Harness />
        <p>outside</p>
      </>
    )
    await userEvent.click(addFilter())
    await userEvent.click(screen.getByText('outside'))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })
})

describe('FilterChips — no tags yet', () => {
  it('the Tag list offers Create tags', async () => {
    const onManageTags = vi.fn()
    render(<Harness tags={[]} onManageTags={onManageTags} />)
    await userEvent.click(addFilter())
    await userEvent.hover(screen.getByRole('menuitem', { name: /Tag/ }))
    expect(screen.getByText('No tags yet')).toBeVisible()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Create tags' }))
    expect(onManageTags).toHaveBeenCalledOnce()
  })
})
