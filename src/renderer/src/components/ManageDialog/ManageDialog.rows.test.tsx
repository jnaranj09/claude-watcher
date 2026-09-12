// ManageDialog — the list rail: Row, RowActions, New. Same harness as ManageDialog.test.tsx.
//
// RowActions exists for the Rules dialog's ↑/↓ (spec §0.1): actions the form does NOT own. They
// must render OUTSIDE the row's select button — a <button> inside a <button> is invalid HTML — and
// pressing one must not select the row.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { ManageDialog, useManageDialog, useManageDialogContext } from './ManageDialog'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function Selected(): JSX.Element {
  const { state } = useManageDialogContext()
  return <span data-testid="probe-selected">{state.selectedId ?? 'none'}</span>
}

function Harness(props: { onMoveUp: () => void }): JSX.Element {
  const dialog = useManageDialog({ title: 'Rules', testIdPrefix: 'rules', onClose: () => {} })
  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame>
        <ManageDialog.Columns>
          <ManageDialog.List>
            <ManageDialog.Rows>
              <ManageDialog.Row
                id="a"
                testId="rule-row-a"
                selectTestId="rule-select-a"
                dataAttributes={{ 'data-rule-id': 'a' }}
              >
                First rule
                <ManageDialog.RowActions>
                  <button type="button" data-testid="rule-up-a" onClick={props.onMoveUp}>
                    ↑
                  </button>
                </ManageDialog.RowActions>
              </ManageDialog.Row>
              <ManageDialog.Row id="b" testId="rule-row-b" selectTestId="rule-select-b">
                Second rule
              </ManageDialog.Row>
            </ManageDialog.Rows>
            <ManageDialog.New testId="rule-new" />
          </ManageDialog.List>
          <Selected />
        </ManageDialog.Columns>
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}

function render(): { r: RenderResult; onMoveUp: ReturnType<typeof vi.fn> } {
  const onMoveUp = vi.fn()
  const r = renderComponent(<Harness onMoveUp={onMoveUp} />)
  cleanup = r.unmount
  return { r, onMoveUp }
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

const click = (el: Element): void => act(() => (el as HTMLElement).click())

describe('ManageDialog.Row', () => {
  // design.md: the list is FLAT — no section wrapper may ever sit between the rows.
  it('rows are the direct children of Rows', () => {
    const { r } = render()
    const rows = [q(r, '[data-testid="rule-row-a"]'), q(r, '[data-testid="rule-row-b"]')]
    const parent = rows[0]?.parentElement
    expect(parent?.children).toHaveLength(rows.length)
    for (const row of rows) expect(row.parentElement).toBe(parent)
  })

  it('the select button selects its row; data-selected follows the selection', () => {
    const { r } = render()
    expect(q(r, '[data-testid="rule-select-a"]').getAttribute('data-rule-id')).toBe('a')
    click(q(r, '[data-testid="rule-select-b"]'))
    expect(q(r, '[data-testid="probe-selected"]').textContent).toBe('b')
    expect(q(r, '[data-testid="rule-row-b"]').getAttribute('data-selected')).toBe('true')
    expect(q(r, '[data-testid="rule-row-a"]').getAttribute('data-selected')).toBe('false')
  })

  it('the label is the select button; RowActions sit in their own slot OUTSIDE it', () => {
    const { r } = render()
    const select = q(r, '[data-testid="rule-select-a"]')
    const up = q(r, '[data-testid="rule-up-a"]')
    expect(select.textContent).toBe('First rule')
    expect(select.contains(up)).toBe(false)
    const slot = up.closest('[data-testid="manage-row-actions"]')
    expect(slot?.parentElement).toBe(q(r, '[data-testid="rule-row-a"]'))
  })

  it('a row action acts without selecting the row', () => {
    const { r, onMoveUp } = render()
    click(q(r, '[data-testid="rule-up-a"]'))
    expect(onMoveUp).toHaveBeenCalledTimes(1)
    expect(q(r, '[data-testid="probe-selected"]').textContent).toBe('none')
  })

  it('a row without RowActions renders no slot', () => {
    const { r } = render()
    expect(
      q(r, '[data-testid="rule-row-b"]').querySelector('[data-testid="manage-row-actions"]')
    ).toBeNull()
  })
})

describe('ManageDialog.New', () => {
  it('returns to the New form (selection null)', () => {
    const { r } = render()
    click(q(r, '[data-testid="rule-select-a"]'))
    expect(q(r, '[data-testid="probe-selected"]').textContent).toBe('a')
    click(q(r, '[data-testid="rule-new"]'))
    expect(q(r, '[data-testid="probe-selected"]').textContent).toBe('none')
    expect(q(r, '[data-testid="rule-new"]').textContent).toBe('+ New')
  })
})
