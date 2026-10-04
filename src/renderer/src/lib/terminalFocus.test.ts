// A terminal must not take focus while a dialog holds it — but a dialog that is only fading out
// (overlay motion, data-leaving) no longer holds anything (2026-10-04 review).
import { describe, it, expect, afterEach } from 'vitest'
import { dialogHoldsFocus } from './terminalFocus'

afterEach(() => {
  document.body.innerHTML = ''
})

function buttonIn(attrs: Record<string, string>): HTMLButtonElement {
  const dialog = document.createElement('div')
  for (const [k, v] of Object.entries(attrs)) dialog.setAttribute(k, v)
  const button = document.createElement('button')
  dialog.appendChild(button)
  document.body.appendChild(dialog)
  return button
}

describe('dialogHoldsFocus', () => {
  it('an open dialog holds focus', () => {
    expect(dialogHoldsFocus(buttonIn({ role: 'dialog' }))).toBe(true)
    expect(dialogHoldsFocus(buttonIn({ role: 'alertdialog' }))).toBe(true)
  })
  it('a dialog playing its exit does not', () => {
    expect(dialogHoldsFocus(buttonIn({ role: 'dialog', 'data-leaving': '' }))).toBe(false)
  })
  it('focus outside any dialog, or nowhere, does not', () => {
    expect(dialogHoldsFocus(buttonIn({}))).toBe(false)
    expect(dialogHoldsFocus(null)).toBe(false)
  })
})
