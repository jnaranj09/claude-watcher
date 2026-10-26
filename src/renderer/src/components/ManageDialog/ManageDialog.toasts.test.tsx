// A dialog's action result is a toast (spec 2026-10-26 dialog toasts): `showSuccess` and
// `setError` push ONE toast keyed `dialog:<testIdPrefix>`, so a new result replaces the last. An
// error toast goes when the error clears (an edit, select, startNew, arm) and when the dialog
// closes or unmounts; a success is left to fade on its own timer. No slot in the dialog.
import { describe, it, expect, afterEach } from 'vitest'
import { act, useEffect, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { dialogToast } from '../../test/toasts'
import { toastStore } from '../../stores/toastStore'
import { Presence } from '../Presence/Presence'
import { ManageDialog, useManageDialog, type ManageDialogContextValue } from './ManageDialog'

let api: ManageDialogContextValue | null = null
function Harness(): JSX.Element {
  const dialog = useManageDialog({ title: 'Probe', testIdPrefix: 't', onClose: () => {} })
  useEffect(() => {
    api = dialog
  })
  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame>
        <ManageDialog.Header />
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}

function actions(): ManageDialogContextValue['actions'] {
  if (api === null) throw new Error('not rendered')
  return api.actions
}

let r: RenderResult | undefined
afterEach(() => {
  r?.unmount()
  r = undefined
  api = null
  delete document.documentElement.dataset.input
})

describe('ManageDialog result toasts', () => {
  it('showSuccess pushes a success toast keyed to the dialog', () => {
    r = renderComponent(<Harness />)
    act(() => actions().showSuccess('Template saved.'))
    expect(dialogToast('t')).toMatchObject({ kind: 'success', title: 'Template saved.' })
  })

  it('setError pushes an error toast; a later success replaces it', () => {
    r = renderComponent(<Harness />)
    act(() => actions().setError('Could not save the template.'))
    expect(dialogToast('t')).toMatchObject({ kind: 'error', title: 'Could not save the template.' })
    act(() => actions().showSuccess('Template saved.'))
    const live = toastStore.getState().toasts.filter((t) => !t.leaving)
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ kind: 'success', title: 'Template saved.' })
  })

  it('setError(null), select, startNew, arm each fade the error toast', () => {
    r = renderComponent(<Harness />)
    for (const clear of [
      () => actions().setError(null),
      () => actions().select('x'),
      () => actions().startNew(),
      () => actions().arm()
    ]) {
      act(() => actions().setError('No.'))
      expect(dialogToast('t')?.kind).toBe('error')
      act(clear)
      expect(dialogToast('t')).toBeUndefined()
    }
  })

  it('an edit (setError(null)) leaves a success toast to fade on its own', () => {
    r = renderComponent(<Harness />)
    act(() => actions().showSuccess('Saved.'))
    act(() => actions().setError(null))
    expect(dialogToast('t')).toMatchObject({ kind: 'success', title: 'Saved.' })
  })

  it('the same error twice after ✕ shows again', () => {
    r = renderComponent(<Harness />)
    act(() => actions().setError('X'))
    const first = dialogToast('t')
    expect(first?.title).toBe('X')
    act(() => toastStore.getState().dismiss(first?.id ?? ''))
    expect(dialogToast('t')).toBeUndefined()
    act(() => actions().setError('X'))
    expect(dialogToast('t')).toMatchObject({ kind: 'error', title: 'X' })
  })

  it('unmount fades the error toast and keeps a success', () => {
    r = renderComponent(<Harness />)
    act(() => actions().setError('No.'))
    r.unmount()
    r = renderComponent(<Harness />)
    expect(dialogToast('t')).toBeUndefined()
    act(() => actions().showSuccess('Saved.'))
    r.unmount()
    r = undefined
    expect(dialogToast('t')).toMatchObject({ kind: 'success', title: 'Saved.' })
  })

  // A pointer close plays the dialog's exit inside <Presence> before it unmounts: the error goes
  // when the exit starts, not MOTION_EXIT_MS later.
  it('closing the dialog fades the error toast before the exit ends', () => {
    document.documentElement.dataset.input = 'pointer'
    const view = (open: boolean): JSX.Element => (
      <Presence value={open || null}>{() => <Harness />}</Presence>
    )
    r = renderComponent(view(true))
    act(() => actions().setError('No.'))
    act(() => r?.root.render(view(false)))
    expect(r.container.querySelector('[data-leaving]')).not.toBeNull()
    expect(dialogToast('t')).toBeUndefined()
  })

  it('the dialog renders no message slot', () => {
    r = renderComponent(<Harness />)
    act(() => actions().showSuccess('Saved.'))
    expect(document.querySelector('[data-testid$="-message"]')).toBeNull()
    expect(document.querySelector('[data-testid$="-success"]')).toBeNull()
  })
})
