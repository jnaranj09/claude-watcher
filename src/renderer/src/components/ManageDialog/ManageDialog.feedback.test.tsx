// Action feedback (spec 2026-09-29 §1.3) — the ManageDialog buttons forward `busy` and `feedback`,
// and an in-flight Delete keeps its ARMED look: a blur must not disarm it (disabling a focused
// button can blur it), and a click on it does nothing.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { ManageDialog, useManageDialog } from './ManageDialog'

function Harness({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }): JSX.Element {
  const dialog = useManageDialog({ title: 'Probe', testIdPrefix: 'probe', onClose: () => {} })
  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Delete testId="del" onConfirm={onConfirm} busy={busy} />
      <ManageDialog.Save
        testId="save"
        disabled={false}
        busy={busy}
        onClick={() => {}}
        feedback="✓ Saved"
        feedbackShown={!busy}
      />
      <ManageDialog.GhostButton
        testId="ghost"
        onClick={() => {}}
        busy={busy}
        feedback="✓ Copied"
        feedbackShown={false}
      >
        Browse…
      </ManageDialog.GhostButton>
    </ManageDialog.Provider>
  )
}

let r: RenderResult | undefined
afterEach(() => {
  r?.unmount()
  r = undefined
})

function el(id: string): HTMLButtonElement {
  const found = r?.container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
  if (found === null || found === undefined) throw new Error(`missing ${id}`)
  return found
}

describe('ManageDialog buttons forward busy and feedback', () => {
  it('Save and GhostButton: busy disables and sets aria-busy; feedback and feedbackShown forward', () => {
    r = renderComponent(<Harness busy={false} onConfirm={() => {}} />)
    expect(el('save').nextElementSibling?.textContent).toBe('✓ Saved')
    expect(el('ghost').nextElementSibling?.textContent).toBe('')
    act(() => r?.root.render(<Harness busy onConfirm={() => {}} />))
    expect(el('save').disabled).toBe(true)
    expect(el('save').getAttribute('aria-busy')).toBe('true')
    expect(el('ghost').disabled).toBe(true)
    expect(el('ghost').getAttribute('aria-busy')).toBe('true')
    expect(el('ghost').nextElementSibling?.getAttribute('role')).toBe('status')
  })

  it('an armed Delete stays armed while busy: a blur does not disarm it, a click does nothing', () => {
    const onConfirm = vi.fn()
    r = renderComponent(<Harness busy={false} onConfirm={onConfirm} />)
    act(() => el('del').click())
    expect(el('del').hasAttribute('data-armed')).toBe(true)
    act(() => r?.root.render(<Harness busy onConfirm={onConfirm} />))
    act(() => {
      el('del').dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(el('del').hasAttribute('data-armed')).toBe(true)
    expect(el('del').textContent).toBe('Confirm delete')
    expect(el('del').getAttribute('aria-busy')).toBe('true')
    act(() => el('del').click())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('not busy, a blur still disarms (the existing contract)', () => {
    r = renderComponent(<Harness busy={false} onConfirm={() => {}} />)
    act(() => el('del').click())
    act(() => {
      el('del').dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(el('del').hasAttribute('data-armed')).toBe(false)
  })
})
