// Tags — the checkbox list that edits one card's tags (spec §4.3). jsdom `unit` project.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { TagPicker, type TagPickerProps } from './TagPicker'
import type { Tag } from '../../../../shared/ipc/contract'

const DEPLOY: Tag = { id: 't-deploy', name: 'deploy', color: 'amber', workspaceId: null }
const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
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

const row = (r: RenderResult, id: string): HTMLButtonElement => {
  const el = r.container.querySelector<HTMLButtonElement>(`[data-testid="picker-row-${id}"]`)
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
    expect(r.container.querySelector('input')).toBeNull()
    expect(row(r, 't-deploy').getAttribute('role')).toBe('checkbox')
    expect(isOn(r, 't-deploy')).toBe(false)
    expect(isOn(r, 't-prod')).toBe(true)
    expect(row(r, 't-deploy').querySelector('[data-testid="tag-chip"]')?.textContent).toBe('deploy')
    expect(r.container.querySelector('[data-testid="picker"]')?.getAttribute('aria-label')).toBe(
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
    const { r } = render({ tags: [] })
    expect(r.container.querySelector('[data-testid="picker-empty"]')?.textContent).toMatch(
      /no tags/i
    )
  })

  it('a nested tag shows its full name in the chip, like the filter list', () => {
    const { r } = render({ tags: [DEPLOY, { ...PROD, name: 'deploy/prod' }] })
    expect(row(r, 't-prod').querySelector('[data-testid="tag-chip"]')?.textContent).toBe(
      'deploy/prod'
    )
  })
})
