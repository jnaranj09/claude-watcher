// Tags — the checkbox list that edits one card's tags (spec §4.3). jsdom `unit` project.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, type JSX } from 'react'
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

// The list is portaled to document.body, so every query reads the document (`r` stays in the
// signatures: the render it belongs to).
const row = (_r: RenderResult, id: string): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>(`[data-testid="picker-row-${id}"]`)
  if (el === null) throw new Error(`missing row ${id}`)
  return el
}
const isOn = (r: RenderResult, id: string): boolean =>
  row(r, id).getAttribute('aria-checked') === 'true'

describe('TagPicker', () => {
  // 2026-09-29 — the board filter's tag list look: a coloured chip per row, a ✓ on the chosen
  // ones, and no native checkbox (the desktop theme painted it white on a dark app).
  it('one checkbox row per offered tag, on when the card carries it, drawn as a chip', () => {
    const { r } = render()
    expect(document.querySelector('input')).toBeNull()
    expect(row(r, 't-deploy').getAttribute('role')).toBe('checkbox')
    expect(isOn(r, 't-deploy')).toBe(false)
    expect(isOn(r, 't-prod')).toBe(true)
    expect(row(r, 't-deploy').querySelector('[data-testid="tag-chip"]')?.textContent).toBe('deploy')
    expect(document.querySelector('[data-testid="picker"]')?.getAttribute('aria-label')).toBe(
      'Tags for api'
    )
  })

  it('a chosen row carries the check mark; an unchosen one does not', () => {
    const { r } = render()
    expect(row(r, 't-prod').querySelector('[data-testid="tag-menu-check"]')).not.toBeNull()
    expect(row(r, 't-deploy').querySelector('[data-testid="tag-menu-check"]')).toBeNull()
  })

  it('ticking adds and unticking removes, handing back the list in tag-list order', () => {
    const { r, onChange } = render()
    act(() => row(r, 't-deploy').click())
    expect(onChange).toHaveBeenLastCalledWith(['t-deploy', 't-prod'])
    act(() => row(r, 't-prod').click())
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('clicks and Enter/Space inside never reach the parent (a board card is a role="button")', () => {
    const { r, onParentClick, onParentKey } = render()
    act(() => row(r, 't-deploy').click())
    fireEvent(row(r, 't-deploy'), new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    fireEvent(row(r, 't-deploy'), new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(onParentClick).not.toHaveBeenCalled()
    expect(onParentKey).not.toHaveBeenCalled()
  })

  it('Escape closes it and stops there', () => {
    const { r, onClose, onParentKey } = render()
    fireEvent(row(r, 't-deploy'), new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(onParentKey).not.toHaveBeenCalled()
  })

  it('a mousedown outside the anchor closes it; inside does not', () => {
    const { r, onClose } = render()
    fireEvent(row(r, 't-deploy'), new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent(document.body, new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).toHaveBeenCalledWith('outside')
  })

  it('says so when the workspace has no tags', () => {
    render({ tags: [] })
    expect(document.querySelector('[data-testid="picker-empty"]')?.textContent).toMatch(/no tags/i)
  })

  it('a nested tag shows its full name in the chip, like the filter list', () => {
    const { r } = render({ tags: [DEPLOY, { ...PROD, name: 'deploy/prod' }] })
    expect(row(r, 't-prod').querySelector('[data-testid="tag-chip"]')?.textContent).toBe(
      'deploy/prod'
    )
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
    expect(document.querySelector('[data-testid="tp"]')).not.toBeNull()
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
    const wrap = (): HTMLElement => {
      const el = document.querySelector('[data-testid="picker"]')?.parentElement
      if (el === null || el === undefined) throw new Error('picker not drawn')
      return el
    }
    const anchor = (): HTMLElement => {
      if (anchorRef.current === null) throw new Error('no anchor')
      return anchorRef.current
    }
    return { r, onClose, wrap, anchor }
  }

  const AT = { top: 100, bottom: 128, left: 300, right: 328, width: 28, height: 28 }

  it('draws the list in document.body, outside the anchor', () => {
    const { r, wrap } = renderWithTrigger(() => AT)
    expect(r.container.contains(wrap())).toBe(false)
    expect(wrap().parentElement).toBe(document.body)
  })

  it('sits under its trigger, right edges lined up', () => {
    const { wrap } = renderWithTrigger(() => AT)
    expect(wrap()).toHaveStyle({
      top: `${AT.bottom + 4}px`,
      right: `${window.innerWidth - AT.right}px`
    })
    expect(wrap()).not.toHaveStyle({ visibility: 'hidden' })
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
    const { r, onClose, anchor } = renderWithTrigger(() => AT)
    const inList = row(r, 't-deploy')
    fireEvent(inList, new MouseEvent('mousedown', { bubbles: true }))
    fireEvent(anchor(), new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent(document.body, new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).toHaveBeenCalledWith('outside')
  })
})
