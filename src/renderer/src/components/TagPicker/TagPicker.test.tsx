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

const check = (r: RenderResult, id: string): HTMLInputElement => {
  const el = r.container.querySelector<HTMLInputElement>(`[data-testid="picker-check-${id}"]`)
  if (el === null) throw new Error(`missing checkbox ${id}`)
  return el
}

describe('TagPicker', () => {
  it('one checkbox per offered tag, ticked when the card carries it, drawn with its chip', () => {
    const { r } = render()
    expect(check(r, 't-deploy').checked).toBe(false)
    expect(check(r, 't-prod').checked).toBe(true)
    expect(
      r.container.querySelector('[data-testid="picker-row-t-deploy"] [data-testid="tag-chip"]')
        ?.textContent
    ).toBe('deploy')
    expect(r.container.querySelector('[data-testid="picker"]')?.getAttribute('aria-label')).toBe(
      'Tags for api'
    )
  })

  it('ticking adds and unticking removes, handing back the list in tag-list order', () => {
    const { r, onChange } = render()
    act(() => check(r, 't-deploy').click())
    expect(onChange).toHaveBeenLastCalledWith(['t-deploy', 't-prod'])
    act(() => check(r, 't-prod').click())
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('clicks and Enter/Space inside never reach the parent (a board card is a role="button")', () => {
    const { r, onParentClick, onParentKey } = render()
    act(() => check(r, 't-deploy').click())
    fireEvent(check(r, 't-deploy'), new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    fireEvent(check(r, 't-deploy'), new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(onParentClick).not.toHaveBeenCalled()
    expect(onParentKey).not.toHaveBeenCalled()
  })

  it('Escape closes it and stops there', () => {
    const { r, onClose, onParentKey } = render()
    fireEvent(check(r, 't-deploy'), new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(onParentKey).not.toHaveBeenCalled()
  })

  it('a mousedown outside the anchor closes it; inside does not', () => {
    const { r, onClose } = render()
    fireEvent(check(r, 't-deploy'), new MouseEvent('mousedown', { bubbles: true }))
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
})
