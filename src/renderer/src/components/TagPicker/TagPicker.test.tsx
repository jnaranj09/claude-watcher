// Tags — the checkbox list that edits one card's tags (spec §4.3). jsdom `unit` project.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, type JSX } from 'react'
import { screen, within } from '@testing-library/react'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { TagPicker, type TagPickerProps } from './TagPicker'
import { Presence } from '../Presence/Presence'
import { pointerInput } from '../../test/pointerInput'
import type { Tag } from '../../../../shared/ipc/contract'

const DEPLOY: Tag = { id: 't-deploy', name: 'deploy', color: 'amber', workspaceId: null }
const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }

let cleanup: (() => void) | undefined
let clearInput: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  clearInput?.()
  clearInput = undefined
  vi.useRealTimers()
})

function render(over: Partial<TagPickerProps> = {}): {
  r: RenderResult
  onChange: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  onParentClick: ReturnType<typeof vi.fn>
  onParentKey: ReturnType<typeof vi.fn>
} {
  const onChange = vi.fn()
  const onClose = vi.fn()
  const onParentClick = vi.fn()
  const onParentKey = vi.fn()
  const anchorRef = { current: null as HTMLElement | null }
  const triggerRef = { current: null as HTMLElement | null }
  const r = renderComponent(
    <div onClick={onParentClick} onKeyDown={onParentKey}>
      <div
        data-testid="anchor"
        ref={(el) => {
          anchorRef.current = el
        }}
      >
        <TagPicker
          tags={[DEPLOY, PROD]}
          selectedIds={['t-prod']}
          onChange={onChange}
          onClose={onClose}
          anchorRef={anchorRef}
          triggerRef={triggerRef}
          testId="picker"
          label="Tags for api"
          {...over}
        />
      </div>
    </div>
  )
  cleanup = r.unmount
  return { r, onChange, onClose, onParentClick, onParentKey }
}

// The list is portaled to document.body: `screen` reads the whole document.
const row = (id: string): HTMLElement => screen.getByTestId(`picker-row-${id}`)

describe('TagPicker', () => {
  // 2026-09-29 — the board filter's tag list look: a coloured chip per row, a ✓ on the chosen
  // ones, and no native checkbox (the desktop theme painted it white on a dark app).
  it('one checkbox row per offered tag, on when the card carries it, drawn as a chip', () => {
    render()
    // No native checkbox: each row is a button with the checkbox role. The list is unplaced here
    // (no trigger to measure), so it is hidden to the accessibility tree.
    expect(screen.getAllByRole('checkbox', { hidden: true }).map((el) => el.tagName)).toEqual([
      'BUTTON',
      'BUTTON'
    ])
    expect(row('t-deploy')).toHaveAttribute('role', 'checkbox')
    expect(row('t-deploy')).toHaveAttribute('aria-checked', 'false')
    expect(row('t-prod')).toHaveAttribute('aria-checked', 'true')
    expect(within(row('t-deploy')).getByTestId('tag-chip')).toHaveTextContent(/^deploy$/)
    expect(screen.getByTestId('picker')).toHaveAttribute('aria-label', 'Tags for api')
  })

  it('a chosen row carries the check mark; an unchosen one does not', () => {
    render()
    expect(within(row('t-prod')).getByTestId('tag-menu-check')).toBeInTheDocument()
    expect(within(row('t-deploy')).queryByTestId('tag-menu-check')).not.toBeInTheDocument()
  })

  it('ticking adds and unticking removes, handing back the list in tag-list order', () => {
    const { onChange } = render()
    act(() => row('t-deploy').click())
    expect(onChange).toHaveBeenLastCalledWith(['t-deploy', 't-prod'])
    act(() => row('t-prod').click())
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('clicks and Enter/Space inside never reach the parent (a board card is a role="button")', () => {
    const { onParentClick, onParentKey } = render()
    act(() => row('t-deploy').click())
    fireEvent(row('t-deploy'), new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    fireEvent(row('t-deploy'), new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(onParentClick).not.toHaveBeenCalled()
    expect(onParentKey).not.toHaveBeenCalled()
  })

  it('Escape closes it and stops there', () => {
    const { onClose, onParentKey } = render()
    fireEvent(row('t-deploy'), new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(onParentKey).not.toHaveBeenCalled()
  })

  it('a mousedown outside the anchor closes it; inside does not', () => {
    const { onClose } = render()
    fireEvent(row('t-deploy'), new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent(document.body, new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).toHaveBeenCalledWith('outside')
  })

  it('says so when the workspace has no tags', () => {
    render({ tags: [] })
    expect(screen.getByTestId('picker-empty')).toHaveTextContent(/no tags/i)
  })

  it('a nested tag shows its full name in the chip, like the filter list', () => {
    render({ tags: [DEPLOY, { ...PROD, name: 'deploy/prod' }] })
    expect(within(row('t-prod')).getByTestId('tag-chip')).toHaveTextContent(/^deploy\/prod$/)
  })
})

describe('TagPicker — leaving (spec 2026-10-04 Review Focus 5)', () => {
  it('while leaving, a second outside mousedown does not call onClose again', () => {
    const onClose = vi.fn()
    const anchorRef = { current: document.createElement('div') }
    clearInput = pointerInput()
    vi.useFakeTimers()
    const tree = (open: boolean): JSX.Element => (
      <Presence value={open || null}>
        {() => (
          <TagPicker
            tags={[DEPLOY]}
            selectedIds={[]}
            onChange={() => {}}
            onClose={onClose}
            anchorRef={anchorRef}
            triggerRef={{ current: null }}
            testId="tp"
            label="Tags"
          />
        )}
      </Presence>
    )
    const r = renderComponent(tree(true))
    act(() => {
      r.root.render(tree(false))
    })
    expect(screen.getByTestId('tp')).toBeInTheDocument()
    fireEvent(document.body, new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    r.unmount()
  })
})

// Ruling C4 (spec 2026-11-14 memory context index): drawn inside its anchor, a form's scroll body
// (the Memory dialog's Tags field) cut the list. It is portaled to document.body and placed under
// its trigger, right edges lined up, as Select's list is.
describe('TagPicker — portaled under its trigger', () => {
  function renderWithTrigger(rect: () => Partial<DOMRect>): {
    r: RenderResult
    onClose: ReturnType<typeof vi.fn>
    wrap: () => HTMLElement
    anchor: () => HTMLElement
  } {
    const onClose = vi.fn()
    const anchorRef = { current: null as HTMLElement | null }
    const triggerRef = { current: null as HTMLElement | null }
    const r = renderComponent(
      <div
        data-testid="anchor"
        ref={(el) => {
          anchorRef.current = el
        }}
      >
        <button
          type="button"
          ref={(el) => {
            if (el !== null) el.getBoundingClientRect = () => rect() as DOMRect
            triggerRef.current = el
          }}
        />
        <TagPicker
          tags={[DEPLOY, PROD]}
          selectedIds={[]}
          onChange={vi.fn()}
          onClose={onClose}
          anchorRef={anchorRef}
          triggerRef={triggerRef}
          testId="picker"
          label="Tags for api"
        />
      </div>
    )
    cleanup = r.unmount
    const wrap = (): HTMLElement => screen.getByTestId('picker-placed')
    const anchor = (): HTMLElement => {
      if (anchorRef.current === null) throw new Error('no anchor')
      return anchorRef.current
    }
    return { r, onClose, wrap, anchor }
  }

  const AT = { top: 100, bottom: 128, left: 300, right: 328, width: 28, height: 28 }

  it('draws the list in document.body, outside the anchor', () => {
    const { r, wrap } = renderWithTrigger(() => AT)
    expect(r.container).not.toContainElement(wrap())
    expect(document.body).toContainElement(wrap())
  })

  it('sits under its trigger, right edges lined up', () => {
    const { wrap } = renderWithTrigger(() => AT)
    expect(wrap()).toHaveStyle({
      top: `${AT.bottom + 4}px`,
      right: `${window.innerWidth - AT.right}px`
    })
    expect(wrap()).not.toHaveStyle({ visibility: 'hidden' })
  })

  // The rail's `+ tag` sits near the window's left edge: lined up by right edges, the list ran off
  // the window (owner screenshot, 2026-11-16).
  it("lines up left edges when right-aligning would push the list past the window's left edge", () => {
    const NEAR_LEFT = { top: 100, bottom: 128, left: 40, right: 90, width: 50, height: 28 }
    const { wrap } = renderWithTrigger(() => NEAR_LEFT)
    wrap().getBoundingClientRect = () => ({ width: 240, height: 120 }) as DOMRect
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(wrap()).toHaveStyle({ left: `${NEAR_LEFT.left}px` })
    expect(wrap()).not.toHaveStyle({ right: `${window.innerWidth - NEAR_LEFT.right}px` })
  })

  it("keeps the list's own minimum width, not the small trigger's", () => {
    const { wrap } = renderWithTrigger(() => AT)
    expect(wrap()).not.toHaveStyle({ minWidth: `${AT.width}px` })
  })

  it('follows its trigger when a region scrolls', () => {
    let rect = AT
    const { wrap } = renderWithTrigger(() => rect)
    rect = { ...AT, top: 40, bottom: 68 }
    act(() => {
      document.dispatchEvent(new Event('scroll'))
    })
    expect(wrap()).toHaveStyle({ top: '72px' })
  })

  it('a mousedown in the portaled list keeps it open; one outside both roots closes it', () => {
    const { onClose, anchor } = renderWithTrigger(() => AT)
    const inList = row('t-deploy')
    fireEvent(inList, new MouseEvent('mousedown', { bubbles: true }))
    fireEvent(anchor(), new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent(document.body, new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).toHaveBeenCalledWith('outside')
  })
})
