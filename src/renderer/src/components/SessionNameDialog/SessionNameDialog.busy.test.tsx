// Action feedback (spec 2026-09-29 §2.2) — the prompt's own side: busy (confirm disabled, aria-busy,
// the busy label, Enter does nothing, Cancel still works), the caller's mapped error on the ONE
// role="alert" line, and every edit reported so the caller can clear that line.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { SessionNameDialog, type SessionNameDialogProps } from './SessionNameDialog'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(props: Partial<SessionNameDialogProps> = {}): {
  r: RenderResult
  onSubmit: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
} {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  const r = renderComponent(
    <SessionNameDialog initialName="api" onSubmit={onSubmit} onCancel={onCancel} {...props} />
  )
  cleanup = r.unmount
  return { r, onSubmit, onCancel }
}

function el<T extends Element = HTMLElement>(r: RenderResult, id: string): T {
  const found = r.container.querySelector<T>(`[data-testid="${id}"]`)
  if (found === null) throw new Error(`missing ${id}`)
  return found
}

describe('SessionNameDialog — busy and the caller error', () => {
  it('busy: the confirm is disabled, aria-busy, and reads the busy label', () => {
    const { r } = render({ busy: true, busyLabel: 'Starting…' })
    const confirm = el<HTMLButtonElement>(r, 'session-name-confirm')
    expect(confirm.disabled).toBe(true)
    expect(confirm.getAttribute('aria-busy')).toBe('true')
    expect(confirm.textContent).toBe('Starting…')
    expect(el<HTMLButtonElement>(r, 'session-name-cancel').disabled).toBe(false)
  })

  it('busy: Enter (a form submit) does not submit again', () => {
    const { r, onSubmit } = render({ busy: true, busyLabel: 'Starting…' })
    act(() => {
      el(r, 'session-name-panel').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows the caller error on the one role="alert" line, keeping the typed name', () => {
    const { r } = render({ error: 'That folder no longer exists.' })
    const line = el(r, 'session-name-error')
    expect(line.getAttribute('role')).toBe('alert')
    expect(line.textContent).toBe('That folder no longer exists.')
    expect(line.getAttribute('data-callout-tone')).toBe('danger')
    expect(el<HTMLInputElement>(r, 'session-name-input').value).toBe('api')
  })

  it('reports every edit so the caller can clear its error', () => {
    const onEdit = vi.fn()
    const { r } = render({ error: 'x', onEdit })
    const input = el<HTMLInputElement>(r, 'session-name-input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(input, 'api2')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('an over-long name still says so first', () => {
    const { r } = render({ initialName: 'x'.repeat(200), error: 'That folder no longer exists.' })
    expect(el(r, 'session-name-error').textContent).toMatch(/^Too long/)
  })
})
