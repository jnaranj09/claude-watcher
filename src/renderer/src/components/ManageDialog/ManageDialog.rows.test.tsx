// ManageDialog — the list rail: Row, RowActions, New. Same harness as ManageDialog.test.tsx.
//
// RowActions exists for the Rules dialog's ↑/↓ (spec §0.1): actions the form does NOT own. They
// must render OUTSIDE the row's select button — a <button> inside a <button> is invalid HTML — and
// pressing one must not select the row.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
                <ManageDialog.RowFavorite>
                  <button type="button" data-testid="pin-b">
                    *
                  </button>
                </ManageDialog.RowFavorite>
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

function TintHarness(): JSX.Element {
  const dialog = useManageDialog({ title: 'Workspaces', testIdPrefix: 'ws', onClose: () => {} })
  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame>
        <ManageDialog.Columns>
          <ManageDialog.List>
            <ManageDialog.Rows>
              <ManageDialog.Row id="a" testId="row-a" tint="green">
                A
              </ManageDialog.Row>
              <ManageDialog.Row id="b" testId="row-b">
                B
              </ManageDialog.Row>
            </ManageDialog.Rows>
          </ManageDialog.List>
        </ManageDialog.Columns>
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}

describe('ManageDialog.Row tint (spec 2026-09-29)', () => {
  it('marks a tinted row with data-tone; an untinted row has none', () => {
    const r = renderComponent(<TintHarness />)
    cleanup = r.unmount
    expect(r.container.querySelector('[data-testid="row-a"]')?.getAttribute('data-tone')).toBe(
      'green'
    )
    expect(r.container.querySelector('[data-testid="row-b"]')?.getAttribute('data-tone')).toBeNull()
  })

  // The fill IS the workspace's colour, so hover and selected move to the border.
  it('moves a tinted row states to the border, never the fill', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/ManageDialog/ManageDialog.module.css'),
      'utf8'
    )
    expect(css).toMatch(/\.row\[data-tone\]\s*\{[^}]*background:\s*var\(--ws-fill, transparent\)/)
    expect(css).toMatch(
      /\.row\[data-tone\]\s*\{[^}]*border-color:\s*var\(--ws-border, transparent\)/
    )
    expect(css).toMatch(/\.row\[data-tone\]:hover\s*\{[^}]*border-color:\s*var\(--text-secondary\)/)
    expect(css).toMatch(
      /\.row\[data-tone\]\[data-selected='true'\]\s*\{[^}]*border-color:\s*var\(--text-primary\)/
    )
    expect(css).toMatch(/\.row\[data-tone\] \.rowSelect:hover\s*\{[^}]*background:\s*transparent/)
  })
})

function CheckHarness(props: { onCheck: (next: boolean) => void }): JSX.Element {
  const dialog = useManageDialog({ title: 'Things', testIdPrefix: 'things', onClose: () => {} })
  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame>
        <ManageDialog.Columns>
          <ManageDialog.List>
            <ManageDialog.Rows>
              <ManageDialog.Row id="a" testId="row-a" selectTestId="select-a">
                <ManageDialog.RowCheck
                  checked={false}
                  onChange={props.onCheck}
                  label="Select a"
                  testId="check-a"
                />
                Row a
              </ManageDialog.Row>
            </ManageDialog.Rows>
          </ManageDialog.List>
          <Selected />
        </ManageDialog.Columns>
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}

describe('ManageDialog.RowCheck (spec 2026-10-03 D)', () => {
  it('sits BEFORE the select button, never inside it, and is labelled', () => {
    const r = renderComponent(<CheckHarness onCheck={vi.fn()} />)
    cleanup = r.unmount
    const check = r.container.querySelector<HTMLInputElement>('[data-testid="check-a"]')
    const select = r.container.querySelector('[data-testid="select-a"]')
    expect(check?.type).toBe('checkbox')
    expect(check?.getAttribute('aria-label')).toBe('Select a')
    expect(check?.closest('button')).toBeNull()
    // The box's wrapper is the select button's previous sibling.
    expect(select?.previousElementSibling?.contains(check ?? null)).toBe(true)
    // Drawn ONCE, outside the button: never a second copy inside it (final review 4e).
    expect(r.container.querySelectorAll('[data-testid="check-a"]')).toHaveLength(1)
    expect(select?.querySelector('input')).toBeNull()
  })

  it('checking it reports the new value and does NOT select the row', () => {
    const onCheck = vi.fn()
    const r = renderComponent(<CheckHarness onCheck={onCheck} />)
    cleanup = r.unmount
    act(() => r.container.querySelector<HTMLInputElement>('[data-testid="check-a"]')?.click())
    expect(onCheck).toHaveBeenCalledWith(true)
    expect(r.container.querySelector('[data-testid="probe-selected"]')?.textContent).toBe('none')
  })
})

describe('ManageDialog.RowFavorite', () => {
  it('renders before the select button, outside it', () => {
    const { r } = render()
    const row = q<HTMLElement>(r, '[data-testid="rule-row-b"]')
    const pin = q<HTMLElement>(r, '[data-testid="pin-b"]')
    const select = q<HTMLElement>(r, '[data-testid="rule-select-b"]')
    expect(select.contains(pin)).toBe(false)
    expect(row.firstElementChild?.contains(pin)).toBe(true)
  })
  it('pressing the pin does not select the row', () => {
    const { r } = render()
    click(q(r, '[data-testid="pin-b"]'))
    expect(q(r, '[data-testid="probe-selected"]').textContent).toBe('none')
  })
  it('its slot is never hidden by CSS', () => {
    const css = readFileSync(join(__dirname, 'ManageDialog.module.css'), 'utf8')
    const rule = /\.rowFavorite\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rule).not.toBe('')
    expect(rule).not.toMatch(/visibility|display:\s*none|opacity/)
  })
})
