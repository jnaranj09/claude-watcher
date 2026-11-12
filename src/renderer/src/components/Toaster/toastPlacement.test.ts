// toastPlacement (the DIALOG toast stack) — with no dialog it sits in the window corner; with one
// open it sits inside the dialog's panel (`[data-toast-anchor]`), bottom-right, and rises above a
// button row (`[data-toast-clearance]`) only when it would cover it. A closing dialog
// (`[data-leaving]` ancestor) does not hold the stack.
import { describe, it, expect, afterEach } from 'vitest'
import { toastPlacement } from './toastPlacement'

afterEach(() => {
  document.body.replaceChildren()
})

const VIEWPORT = { width: 1000, height: 700 }
const STACK = { height: 56, gap: 16 }

function rect(r: { top: number; right: number; bottom: number; width: number }): () => DOMRect {
  return () => r as DOMRect
}

/** A 900x620 panel centred in the 1000x700 viewport: right edge 950, bottom edge 660. */
function addPanel(parent: HTMLElement = document.body): HTMLElement {
  const panel = document.createElement('div')
  panel.setAttribute('data-toast-anchor', '')
  panel.getBoundingClientRect = rect({ top: 40, right: 950, bottom: 660, width: 900 })
  parent.append(panel)
  return panel
}

function addRow(panel: HTMLElement, top: number, bottom: number): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-toast-clearance', '')
  row.getBoundingClientRect = rect({ top, right: 930, bottom, width: 540 })
  panel.append(row)
  return row
}

describe('toastPlacement', () => {
  it('is the window corner with no dialog open', () => {
    expect(toastPlacement(document, VIEWPORT, STACK)).toEqual({ right: 0, bottom: 0, room: null })
  })
  it("sits in the panel's bottom-right corner, as wide as the panel at most", () => {
    addPanel()
    expect(toastPlacement(document, VIEWPORT, STACK)).toEqual({ right: 50, bottom: 40, room: 900 })
  })
  it('stays at the panel bottom when the button row is higher than the stack', () => {
    // The Workspaces form: [Delete] [Save] mid-panel, far above the bottom corner.
    addRow(addPanel(), 362, 398)
    expect(toastPlacement(document, VIEWPORT, STACK).bottom).toBe(40)
  })
  it('rises above a button row the stack would cover', () => {
    // A long form: the row is pinned at the panel bottom (top 600 = 100 from the viewport bottom).
    addRow(addPanel(), 600, 650)
    expect(toastPlacement(document, VIEWPORT, STACK).bottom).toBe(100)
  })
  it('a closing dialog does not hold the stack', () => {
    const leaving = document.createElement('div')
    leaving.setAttribute('data-leaving', '')
    document.body.append(leaving)
    addPanel(leaving)
    expect(toastPlacement(document, VIEWPORT, STACK)).toEqual({ right: 0, bottom: 0, room: null })
  })
  it('the topmost (last) open panel wins', () => {
    addPanel()
    const prompt = document.createElement('div')
    prompt.setAttribute('data-toast-anchor', '')
    prompt.getBoundingClientRect = rect({ top: 250, right: 730, bottom: 450, width: 460 })
    document.body.append(prompt)
    expect(toastPlacement(document, VIEWPORT, STACK)).toEqual({
      right: 270,
      bottom: 250,
      room: 460
    })
  })
  it('is never negative', () => {
    const panel = document.createElement('div')
    panel.setAttribute('data-toast-anchor', '')
    panel.getBoundingClientRect = rect({ top: 0, right: 1100, bottom: 800, width: 1100 })
    document.body.append(panel)
    expect(toastPlacement(document, VIEWPORT, STACK)).toEqual({ right: 0, bottom: 0, room: 1100 })
  })
})
