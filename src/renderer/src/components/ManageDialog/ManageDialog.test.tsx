// ManageDialog — the ONE shell every Manage dialog is built on (spec 2026-09-11 §0). jsdom `unit`
// project, `renderComponent` harness (this repo has no @testing-library/react — Story 1.3).
//
// The arm-in-place Delete, the error line and the selection contract are proved ONCE here, so the
// dialogs built on the shell do not each re-prove them (spec §6).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { ManageDialog, useManageDialog, useManageDialogContext } from './ManageDialog'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

/** Reads the shared state and calls the actions the way a dialog's own code does. */
function Probe(): JSX.Element {
  const { state, actions } = useManageDialogContext()
  return (
    <div>
      <span data-testid="probe-selected">{state.selectedId ?? 'none'}</span>
      <span data-testid="probe-armed">{String(state.armed)}</span>
      <button
        type="button"
        data-testid="probe-fail"
        onClick={() => actions.setError('Could not save.')}
      >
        fail
      </button>
      <button type="button" data-testid="probe-select" onClick={() => actions.select('b')}>
        select b
      </button>
    </div>
  )
}

function Harness(props: { onClose: () => void; onConfirm: () => void }): JSX.Element {
  const dialog = useManageDialog({
    title: 'Things',
    testIdPrefix: 'things',
    onClose: props.onClose
  })
  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame>
        <ManageDialog.Header />
        <Probe />
        <ManageDialog.Form testId="things-form" onSubmit={(e) => e.preventDefault()}>
          <ManageDialog.Label htmlFor="thing-name">Name</ManageDialog.Label>
          <ManageDialog.Label>Color</ManageDialog.Label>
          <ManageDialog.Hint testId="things-hint">Pick a name.</ManageDialog.Hint>
          <ManageDialog.Footer>
            <ManageDialog.Delete
              testId="thing-delete"
              armedTestId="thing-delete-confirm"
              onConfirm={props.onConfirm}
            />
            <ManageDialog.Save testId="thing-save" disabled={false} />
          </ManageDialog.Footer>
        </ManageDialog.Form>
        <ManageDialog.Error testId="things-error" />
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}

function render(): {
  r: RenderResult
  onClose: ReturnType<typeof vi.fn>
  onConfirm: ReturnType<typeof vi.fn>
} {
  const onClose = vi.fn()
  const onConfirm = vi.fn()
  const r = renderComponent(<Harness onClose={onClose} onConfirm={onConfirm} />)
  cleanup = r.unmount
  return { r, onClose, onConfirm }
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

const click = (el: Element): void => act(() => (el as HTMLElement).click())

function key(el: Element, k: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

describe('ManageDialog — the shell', () => {
  it('is a labelled modal dialog with the prefix test ids and the title as a heading', () => {
    const { r } = render()
    const overlay = q(r, '[data-testid="things-overlay"]')
    expect(overlay.getAttribute('role')).toBe('dialog')
    expect(overlay.getAttribute('aria-modal')).toBe('true')
    expect(overlay.getAttribute('aria-label')).toBe('Things')
    expect(q(r, '[data-testid="things-panel"]').parentElement).toBe(overlay)
    expect(q(r, 'h2').textContent).toBe('Things')
    expect(q(r, '[data-testid="things-close"]').getAttribute('aria-label')).toBe('Close things')
  })

  it('✕ closes, and so does an Escape nothing inside claimed', () => {
    const { r, onClose } = render()
    click(q(r, '[data-testid="things-close"]'))
    key(q(r, '[data-testid="thing-save"]'), 'Escape')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('Save submits the form it sits in; Label is a <label for> only when it names a control', () => {
    const { r } = render()
    expect(q(r, '[data-testid="thing-save"]').getAttribute('type')).toBe('submit')
    expect(q(r, '[data-testid="thing-save"]').textContent).toBe('Save')
    expect(q(r, 'label[for="thing-name"]').textContent).toBe('Name')
    const labels = [...r.container.querySelectorAll('label')].map((l) => l.textContent)
    expect(labels).not.toContain('Color')
  })
})

describe('ManageDialog.Delete — arm in place', () => {
  it('the first press arms "Confirm delete"; only the second press confirms', () => {
    const { r, onConfirm } = render()
    click(q(r, '[data-testid="thing-delete"]'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(r.container.querySelector('[data-testid="thing-delete"]')).toBeNull()
    expect(q(r, '[data-testid="thing-delete-confirm"]').textContent).toBe('Confirm delete')
    click(q(r, '[data-testid="thing-delete-confirm"]'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  // design.md: arming must read as the SAME button changing, never a new control appearing.
  it('the armed button is the same element as the resting one', () => {
    const { r } = render()
    const resting = q(r, '[data-testid="thing-delete"]')
    click(resting)
    expect(q(r, '[data-testid="thing-delete-confirm"]')).toBe(resting)
  })

  it('blur disarms', () => {
    const { r } = render()
    click(q(r, '[data-testid="thing-delete"]'))
    act(() => {
      q(r, '[data-testid="thing-delete-confirm"]').dispatchEvent(
        new FocusEvent('focusout', { bubbles: true })
      )
    })
    expect(q(r, '[data-testid="thing-delete"]').textContent).toBe('Delete')
  })

  it('Escape on the armed button disarms and STOPS there; the next Escape closes', () => {
    const { r, onClose } = render()
    click(q(r, '[data-testid="thing-delete"]'))
    key(q(r, '[data-testid="thing-delete-confirm"]'), 'Escape')
    expect(onClose).not.toHaveBeenCalled()
    expect(q(r, '[data-testid="thing-delete"]').textContent).toBe('Delete')
    key(q(r, '[data-testid="thing-delete"]'), 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape from anywhere else in the form also disarms first', () => {
    const { r, onClose } = render()
    click(q(r, '[data-testid="thing-delete"]'))
    key(q(r, '[data-testid="thing-save"]'), 'Escape')
    expect(onClose).not.toHaveBeenCalled()
    expect(q(r, '[data-testid="probe-armed"]').textContent).toBe('false')
  })
})

// R2: Delete has its OWN Escape guard, independent of Form's — proved by rendering it OUTSIDE a
// Form (Provider + Frame only), the shape ShortcutsDialog uses it in (Task 5). Every other test in
// this file puts Delete inside a Form, whose own Escape handler would also catch the key and mask
// a fault injected into Delete's own handler.
function DeleteOutsideFormHarness(props: {
  onClose: () => void
  onConfirm: () => void
}): JSX.Element {
  const dialog = useManageDialog({
    title: 'Things',
    testIdPrefix: 'things',
    onClose: props.onClose
  })
  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame>
        <ManageDialog.Header />
        <ManageDialog.Delete
          testId="thing-delete"
          armedTestId="thing-delete-confirm"
          onConfirm={props.onConfirm}
        />
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}

describe('ManageDialog.Delete outside a Form — its own Escape guard', () => {
  it('Escape on the armed Delete disarms it and does NOT close the dialog', () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    const r = renderComponent(<DeleteOutsideFormHarness onClose={onClose} onConfirm={onConfirm} />)
    cleanup = r.unmount

    click(q(r, '[data-testid="thing-delete"]'))
    key(q(r, '[data-testid="thing-delete-confirm"]'), 'Escape')
    expect(onClose).not.toHaveBeenCalled()
    expect(q(r, '[data-testid="thing-delete"]').textContent).toBe('Delete')
  })
})

describe('ManageDialog — the error line and the selection contract', () => {
  it('renders the ONE error line as role=alert, only while there is an error', () => {
    const { r } = render()
    expect(r.container.querySelector('[data-testid="things-error"]')).toBeNull()
    click(q(r, '[data-testid="probe-fail"]'))
    const line = q(r, '[data-testid="things-error"]')
    expect(line.getAttribute('role')).toBe('alert')
    expect(line.textContent).toBe('Could not save.')
  })

  it('select() moves the selection, clears the error line and disarms Delete', () => {
    const { r } = render()
    click(q(r, '[data-testid="thing-delete"]'))
    click(q(r, '[data-testid="probe-fail"]'))
    click(q(r, '[data-testid="probe-select"]'))
    expect(q(r, '[data-testid="probe-selected"]').textContent).toBe('b')
    expect(q(r, '[data-testid="probe-armed"]').textContent).toBe('false')
    expect(r.container.querySelector('[data-testid="things-error"]')).toBeNull()
  })

  it('arming Delete clears a stale error line', () => {
    const { r } = render()
    click(q(r, '[data-testid="probe-fail"]'))
    click(q(r, '[data-testid="thing-delete"]'))
    expect(r.container.querySelector('[data-testid="things-error"]')).toBeNull()
  })
})
