// Session-naming — the SessionNameDialog component contract.
//
// The App-level tests (App.launch.test.tsx) cover the FLOW (picker → prompt → launch, cancel is a
// no-op). These cover the component's own contract, which the flow tests cannot see:
//   - the input is focused AND its text SELECTED on mount (so typing replaces the prefill);
//   - submit is disabled while the trimmed value is empty, and the submitted value is TRIMMED;
//   - the props are generic enough for the deferred RENAME pass to reuse this component
//     unchanged (overridable title / confirm label / hint).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { SessionNameDialog } from './SessionNameDialog'
import { SESSION_NAME_MAX_LENGTH } from '../../../../shared/schemas/launch'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(props: Partial<Parameters<typeof SessionNameDialog>[0]> = {}): {
  r: RenderResult
  onSubmit: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
} {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  const r = renderComponent(
    <SessionNameDialog initialName="project" onSubmit={onSubmit} onCancel={onCancel} {...props} />
  )
  cleanup = r.unmount
  return { r, onSubmit, onCancel }
}

/** Type into the input through the native setter so React's onChange fires. */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function inputOf(r: RenderResult): HTMLInputElement {
  const el = r.container.querySelector<HTMLInputElement>('[data-testid="session-name-input"]')
  if (el === null) throw new Error('input not rendered')
  return el
}

function confirmOf(r: RenderResult): HTMLButtonElement {
  const el = r.container.querySelector<HTMLButtonElement>('[data-testid="session-name-confirm"]')
  if (el === null) throw new Error('confirm button not rendered')
  return el
}

describe('SessionNameDialog — mount focus', () => {
  it('focuses the input AND selects its text, so typing REPLACES the prefill', () => {
    const { r } = render()
    const input = inputOf(r)
    expect(document.activeElement).toBe(input)
    // The whole prefill is selected — this is what makes the prefill a suggestion rather than a
    // prefix the operator has to delete first.
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('project'.length)
  })

  it('starts at the given initial value', () => {
    const { r } = render({ initialName: 'billing api' })
    expect(inputOf(r).value).toBe('billing api')
  })
})

describe('SessionNameDialog — submit guard', () => {
  it('submits the TRIMMED value', () => {
    const { r, onSubmit } = render()
    typeInto(inputOf(r), '  billing api  ')
    act(() => {
      confirmOf(r).click()
    })
    expect(onSubmit).toHaveBeenCalledWith('billing api')
  })

  it('disables submit while the value is EMPTY and never calls onSubmit', () => {
    const { r, onSubmit } = render()
    typeInto(inputOf(r), '')
    expect(confirmOf(r).disabled).toBe(true)
    act(() => {
      confirmOf(r).click()
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('disables submit for a WHITESPACE-ONLY value (it trims to empty)', () => {
    const { r, onSubmit } = render()
    typeInto(inputOf(r), '    ')
    expect(confirmOf(r).disabled).toBe(true)
    act(() => {
      confirmOf(r).click()
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('the Enter/form-submit path is guarded too, not just the button', () => {
    const { r, onSubmit } = render()
    typeInto(inputOf(r), '   ')
    const form = r.container.querySelector<HTMLFormElement>('[data-testid="session-name-panel"]')
    act(() => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('the Enter/form-submit path SUBMITS a valid name (the documented primary interaction)', () => {
    // Without this, `type="submit"` could be downgraded to `type="button"` — or the form's
    // onSubmit dropped — and every other test here would still pass via the button click,
    // while Enter silently stopped working.
    const { r, onSubmit } = render()
    typeInto(inputOf(r), 'billing api')
    const form = r.container.querySelector<HTMLFormElement>('[data-testid="session-name-panel"]')
    act(() => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onSubmit).toHaveBeenCalledWith('billing api')
  })

  it('refuses an OVER-LONG value and says why (reachable only via an over-long prefill)', () => {
    // `maxLength` caps TYPING but does not truncate a programmatically-set value, so the dialog
    // must enforce the cap itself — otherwise an over-long prefill submits and main rejects it
    // after the modal has already closed, failing silently.
    const { r, onSubmit } = render({ initialName: 'x'.repeat(SESSION_NAME_MAX_LENGTH + 5) })
    expect(confirmOf(r).disabled).toBe(true)
    expect(r.container.querySelector('[data-testid="session-name-error"]')).not.toBeNull()
    expect(inputOf(r).getAttribute('aria-invalid')).toBe('true')
    act(() => {
      confirmOf(r).click()
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('accepts a name of exactly SESSION_NAME_MAX_LENGTH (the boundary is inclusive)', () => {
    const { r, onSubmit } = render({ initialName: 'x'.repeat(SESSION_NAME_MAX_LENGTH) })
    expect(confirmOf(r).disabled).toBe(false)
    expect(r.container.querySelector('[data-testid="session-name-error"]')).toBeNull()
    act(() => {
      confirmOf(r).click()
    })
    expect(onSubmit).toHaveBeenCalledWith('x'.repeat(SESSION_NAME_MAX_LENGTH))
  })

  it('re-enables submit once a non-empty value is typed back', () => {
    const { r } = render()
    typeInto(inputOf(r), '  ')
    expect(confirmOf(r).disabled).toBe(true)
    typeInto(inputOf(r), 'api')
    expect(confirmOf(r).disabled).toBe(false)
  })

  it('caps the input at SESSION_NAME_MAX_LENGTH so an over-long name cannot be typed', () => {
    const { r } = render()
    expect(inputOf(r).maxLength).toBe(SESSION_NAME_MAX_LENGTH)
  })
})

describe('SessionNameDialog — cancel', () => {
  it('Cancel calls onCancel and never onSubmit', () => {
    const { r, onSubmit, onCancel } = render()
    const cancel = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="session-name-cancel"]'
    )
    act(() => {
      cancel?.click()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('SessionNameDialog — reusable by the deferred rename pass', () => {
  it('title and confirm label are overridable (rename wording), and drive the a11y label', () => {
    const { r } = render({ title: 'Rename session', confirmLabel: 'Rename' })
    expect(r.container.querySelector('[data-testid="session-name-title"]')?.textContent).toBe(
      'Rename session'
    )
    expect(confirmOf(r).textContent).toBe('Rename')
    const overlay = r.container.querySelector('[data-testid="session-name-overlay"]')
    expect(overlay?.getAttribute('aria-label')).toBe('Rename session')
    expect(overlay?.getAttribute('role')).toBe('dialog')
    expect(overlay?.getAttribute('aria-modal')).toBe('true')
    // The INPUT keeps its own accessible name — it must not echo the dialog title, or a screen
    // reader announces "Rename session" twice and never names the field.
    expect(inputOf(r).getAttribute('aria-label')).toBe('Session name')
  })

  it('the hint is optional — omitted means no hint node at all', () => {
    const { r } = render()
    expect(r.container.querySelector('[data-testid="session-name-hint"]')).toBeNull()
  })

  it('renders the hint when given (the picked cwd on create)', () => {
    const { r } = render({ hint: '/home/op/project' })
    expect(r.container.querySelector('[data-testid="session-name-hint"]')?.textContent).toBe(
      '/home/op/project'
    )
  })

  it('renders the helper line under the field only when given', () => {
    const { r } = render({ helper: 'Applies in Claude on your next prompt.' })
    expect(r.container.querySelector('[data-testid="session-name-helper"]')?.textContent).toBe(
      'Applies in Claude on your next prompt.'
    )
    r.unmount()
    const { r: r2 } = render()
    expect(r2.container.querySelector('[data-testid="session-name-helper"]')).toBeNull()
  })
})
