// The dialog's ONE message slot (spec 2026-10-01-feedback-callout-design.md): an error stays until
// the next action; a success shows for SUCCESS_MS. Both are a Callout, never side by side.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, useEffect, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { ManageDialog, useManageDialog, type ManageDialogContextValue } from './ManageDialog'
import { SUCCESS_MS } from './manageDialogState'

let api: ManageDialogContextValue | null = null
function Harness({ compact = false }: { compact?: boolean }): JSX.Element {
  const dialog = useManageDialog({ title: 'Probe', testIdPrefix: 'probe', onClose: () => {} })
  useEffect(() => {
    api = dialog
  })
  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Message testId="probe-error" compact={compact} />
    </ManageDialog.Provider>
  )
}

function actions(): ManageDialogContextValue['actions'] {
  if (api === null) throw new Error('not rendered')
  return api.actions
}

let r: RenderResult | undefined
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  r?.unmount()
  r = undefined
  api = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const q = (id: string): Element | null =>
  r?.container.querySelector(`[data-testid="${id}"]`) ?? null

describe('ManageDialog.Message', () => {
  it('shows a success callout for SUCCESS_MS, then nothing', () => {
    r = renderComponent(<Harness />)
    act(() => actions().showSuccess('Template saved.'))
    expect(q('probe-success')?.textContent).toBe('Template saved.')
    // The SLOT is the live region (always in the page); the callout inside does not announce again.
    expect(q('probe-success')?.hasAttribute('role')).toBe(false)
    expect(q('probe-success')?.getAttribute('data-callout-tone')).toBe('success')
    act(() => {
      vi.advanceTimersByTime(SUCCESS_MS - 1)
    })
    expect(q('probe-success')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(q('probe-success')).toBeNull()
  })

  it('a second success restarts the clock', () => {
    r = renderComponent(<Harness />)
    act(() => actions().showSuccess('A.'))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    act(() => actions().showSuccess('B.'))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(q('probe-success')?.textContent).toBe('B.')
  })

  it('an edit (setError(null)), select, startNew and arm each clear it', () => {
    r = renderComponent(<Harness />)
    for (const clear of [
      () => actions().setError(null),
      () => actions().select('x'),
      () => actions().startNew(),
      () => actions().arm()
    ]) {
      act(() => actions().showSuccess('Saved.'))
      expect(q('probe-success')).not.toBeNull()
      act(clear)
      expect(q('probe-success')).toBeNull()
    }
  })

  it('an error replaces a success in the one slot, as an alert callout', () => {
    r = renderComponent(<Harness />)
    act(() => actions().showSuccess('Saved.'))
    act(() => actions().setError('Could not save the template.'))
    expect(q('probe-success')).toBeNull()
    expect(q('probe-error')?.textContent).toBe('Could not save the template.')
    expect(q('probe-error')?.getAttribute('role')).toBe('alert')
    expect(q('probe-error')?.getAttribute('data-callout-tone')).toBe('danger')
  })

  it('a success replaces an error', () => {
    r = renderComponent(<Harness />)
    act(() => actions().setError('No.'))
    act(() => actions().showSuccess('Saved.'))
    expect(q('probe-error')).toBeNull()
    expect(q('probe-success')?.textContent).toBe('Saved.')
  })

  it('unmounting with a success showing leaves no timer behind', () => {
    r = renderComponent(<Harness />)
    act(() => actions().showSuccess('Saved.'))
    expect(vi.getTimerCount()).toBe(1)
    r.unmount()
    r = undefined
    expect(vi.getTimerCount()).toBe(0)
  })

  // Review fixes: a polite message inserted together with its live region is announced unreliably,
  // and a slot that appears and vanishes moves the centred dialog under the pointer — twice.
  it('the slot is always in the page as the polite live region, empty or not', () => {
    r = renderComponent(<Harness />)
    const slot = q('probe-message')
    expect(slot?.getAttribute('role')).toBe('status')
    expect(slot?.textContent).toBe('')
    act(() => actions().showSuccess('Saved.'))
    expect(q('probe-message')).toBe(slot)
    expect(slot?.textContent).toBe('Saved.')
  })

  // Settings' one-word `Saved` (spec 2026-10-07): a `compact` slot shows its SUCCESS as a compact
  // callout. An error is a block either way — it carries a sentence.
  it('a compact slot shows a compact success; an error stays block; without compact both are block', () => {
    r = renderComponent(<Harness compact />)
    act(() => actions().showSuccess('Saved'))
    expect(q('probe-success')?.getAttribute('data-callout-size')).toBe('compact')
    act(() => actions().setError('No.'))
    expect(q('probe-error')?.getAttribute('data-callout-size')).toBe('block')
    r.unmount()
    r = renderComponent(<Harness />)
    act(() => actions().showSuccess('Saved'))
    expect(q('probe-success')?.getAttribute('data-callout-size')).toBe('block')
  })

  it('the slot reserves one callout of height, with no extra margin', () => {
    const css = readFileSync(join(__dirname, 'ManageDialog.module.css'), 'utf8')
    const rule = /\.message\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/min-height:/)
    expect(rule).not.toMatch(/margin/)
  })
})
