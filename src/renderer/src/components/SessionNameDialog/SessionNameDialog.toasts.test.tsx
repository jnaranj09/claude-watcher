// The name prompt's refusal is a toast (spec 2026-10-26 dialog toasts): the caller's `error` (a
// refused launch or rename) is ONE error toast keyed `dialog:session-name`, never a line in the
// dialog. `Too long — N/<max> characters.` stays inline: it is live, per keystroke, and has a
// reason to sit by the field. The board nulls the error on every attempt (busy) and on every edit, so
// each refusal is a null → text change, which is what pushes the toast again after a ✕.
import { describe, it, expect, afterEach } from 'vitest'
import { act, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { dialogToast } from '../../test/toasts'
import { toastStore } from '../../stores/toastStore'
import { Presence } from '../Presence/Presence'
import { SESSION_NAME_MAX_LENGTH } from '../../../../shared/schemas/launch'
import { SessionNameDialog } from './SessionNameDialog'

let r: RenderResult | undefined
afterEach(() => {
  r?.unmount()
  r = undefined
  delete document.documentElement.dataset.input
})

function view(error: string | null, initialName = 'api'): JSX.Element {
  return (
    <SessionNameDialog
      initialName={initialName}
      onSubmit={() => {}}
      onCancel={() => {}}
      error={error}
    />
  )
}

function inline(): Element | null {
  return document.querySelector('[data-testid="session-name-error"]')
}

describe('SessionNameDialog — the refusal is a toast', () => {
  it('a refusal shows as an error toast, not inline', () => {
    r = renderComponent(view(null))
    act(() => r?.root.render(view('Could not start the session.')))
    expect(dialogToast('session-name')).toMatchObject({
      kind: 'error',
      title: 'Could not start the session.'
    })
    expect(inline()).toBeNull()
  })

  it('editing (error prop → null) fades it', () => {
    r = renderComponent(view('Could not start the session.'))
    expect(dialogToast('session-name')).toBeDefined()
    act(() => r?.root.render(view(null)))
    expect(dialogToast('session-name')).toBeUndefined()
  })

  it('the same refusal again shows again after the operator closed the toast', () => {
    r = renderComponent(view(null))
    act(() => r?.root.render(view('Could not start the session.')))
    const first = dialogToast('session-name')
    act(() => toastStore.getState().dismiss(first?.id ?? ''))
    expect(dialogToast('session-name')).toBeUndefined()
    // The next attempt: busy nulls the error, then the same text lands.
    act(() => r?.root.render(view(null)))
    act(() => r?.root.render(view('Could not start the session.')))
    expect(dialogToast('session-name')).toMatchObject({ title: 'Could not start the session.' })
  })

  it('closing the prompt fades it before the exit ends', () => {
    document.documentElement.dataset.input = 'pointer'
    const open = (on: boolean): JSX.Element => (
      <Presence value={on || null}>{() => view('Could not start the session.')}</Presence>
    )
    r = renderComponent(open(true))
    expect(dialogToast('session-name')).toBeDefined()
    act(() => r?.root.render(open(false)))
    expect(r.container.querySelector('[data-leaving]')).not.toBeNull()
    expect(dialogToast('session-name')).toBeUndefined()
  })

  it('unmounting fades it', () => {
    r = renderComponent(view('Could not start the session.'))
    r.unmount()
    r = undefined
    expect(dialogToast('session-name')).toBeUndefined()
  })

  it('the too-long line stays inline and is not a toast', () => {
    r = renderComponent(view(null, 'x'.repeat(SESSION_NAME_MAX_LENGTH + 5)))
    expect(inline()?.textContent).toBe(
      `Too long — ${SESSION_NAME_MAX_LENGTH + 5}/${SESSION_NAME_MAX_LENGTH} characters.`
    )
    expect(dialogToast('session-name')).toBeUndefined()
  })

  it('a refusal beside a too-long name: the line is inline, the refusal a toast', () => {
    r = renderComponent(view('That folder no longer exists.', 'x'.repeat(200)))
    expect(inline()?.textContent).toMatch(/^Too long/)
    expect(dialogToast('session-name')?.title).toBe('That folder no longer exists.')
  })
})
