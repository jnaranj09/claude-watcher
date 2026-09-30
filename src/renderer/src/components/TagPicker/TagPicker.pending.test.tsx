// Action feedback (spec 2026-09-29 §2.3) — the picker shows `selectedIds ⊕ pending`, so the ✓
// answers the click before main does, and the next click builds on it.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { TagPicker } from './TagPicker'
import { tagsStore } from '../../stores/tagsStore'
import type { Tag } from '../../../../shared/ipc/contract'

const A: Tag = { id: 'a', name: 'alpha', color: 'amber', workspaceId: null }
const B: Tag = { id: 'b', name: 'beta', color: 'rose', workspaceId: null }

let r: RenderResult | undefined
beforeEach(() => {
  tagsStore.setState({ tags: [A, B], pendingBySession: new Map() })
})
afterEach(() => {
  r?.unmount()
  r = undefined
  tagsStore.setState({ pendingBySession: new Map() })
})

function mount(selectedIds: string[], onChange: (ids: string[]) => void = () => {}): void {
  r = renderComponent(
    <TagPicker
      sessionId="s1"
      tags={[A, B]}
      selectedIds={selectedIds}
      onChange={onChange}
      onClose={() => {}}
      anchorRef={{ current: null }}
      testId="picker"
      label="Tags for api"
    />
  )
}

const checked = (id: string): string | null | undefined =>
  r?.container.querySelector(`[data-testid="picker-row-${id}"]`)?.getAttribute('aria-checked')

describe('TagPicker — pending toggles', () => {
  it('shows a pending tag as ticked, and the next click builds on it', () => {
    const onChange = vi.fn()
    mount([], onChange)
    act(() => tagsStore.getState().setPending('s1', new Map([['a', true]])))
    expect(checked('a')).toBe('true')
    act(() =>
      r?.container.querySelector<HTMLButtonElement>('[data-testid="picker-row-b"]')?.click()
    )
    expect(onChange).toHaveBeenCalledWith(['a', 'b'])
  })

  it('a pending-off tag shows unticked', () => {
    mount(['a'])
    act(() => tagsStore.getState().setPending('s1', new Map([['a', false]])))
    expect(checked('a')).toBe('false')
  })

  it("another session's pending toggles do not show", () => {
    mount([])
    act(() => tagsStore.getState().setPending('s2', new Map([['a', true]])))
    expect(checked('a')).toBe('false')
  })
})
