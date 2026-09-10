// Driving the project's custom dropdown from a test. A native <select> is banned
// (.claude/rules/design.md), so there is no `.value` to set and no `change` event to fire — the
// popup is our own listbox, and a test changes it the way an operator does: open, then click.
//
// Lives beside renderComponent.ts because four test files need the same two moves, and a copy in
// each is how they drift.
import { act } from 'react'

function el(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector)
  if (found === null) throw new Error(`missing ${selector}`)
  return found as HTMLElement
}

/** Open the dropdown `testId` and pick `value`. */
export function chooseOption(root: ParentNode, testId: string, value: string): void {
  act(() => el(root, `[data-testid="${testId}"]`).click())
  act(() => el(root, `[data-testid="${testId}-option-${value}"]`).click())
}

/** The dropdown's current value — the trigger mirrors it on `data-value`. */
export function selectedValue(root: ParentNode, testId: string): string {
  return el(root, `[data-testid="${testId}"]`).getAttribute('data-value') ?? ''
}

/** One option's visible label. Opens the dropdown and closes it again, same as `optionValues`. */
export function optionLabel(root: ParentNode, testId: string, value: string): string {
  const trigger = el(root, `[data-testid="${testId}"]`)
  act(() => trigger.click())
  const text = el(root, `[data-testid="${testId}-option-${value}"]`).textContent ?? ''
  act(() => trigger.click())
  return text
}

/** The values the dropdown offers. It must be OPEN to read them, same as for a person, so this
 *  opens it and closes it again. */
export function optionValues(root: ParentNode, testId: string): string[] {
  const trigger = el(root, `[data-testid="${testId}"]`)
  act(() => trigger.click())
  const values = [...root.querySelectorAll(`[data-testid^="${testId}-option-"]`)].map(
    (o) => o.getAttribute('data-value') ?? ''
  )
  act(() => trigger.click())
  return values
}
