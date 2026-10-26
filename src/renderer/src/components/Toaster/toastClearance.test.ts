// toastClearance — how far from the viewport bottom the toast stack must clear to sit above an open
// dialog's buttons. Only `[data-toast-clearance]` elements count; a closing dialog (`[data-leaving]`
// ancestor) does not hold the stack up.
import { describe, it, expect, afterEach } from 'vitest'
import { toastClearance } from './toastClearance'

afterEach(() => {
  document.body.replaceChildren()
})

function add(top: number, parent: HTMLElement = document.body): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-toast-clearance', '')
  el.getBoundingClientRect = () => ({ top }) as DOMRect
  parent.append(el)
  return el
}

describe('toastClearance', () => {
  it('is 0 with no clearance element', () => {
    expect(toastClearance(document, 900)).toBe(0)
  })
  it('is the distance from the element top to the viewport bottom', () => {
    add(700)
    expect(toastClearance(document, 900)).toBe(200)
  })
  it('takes the highest of several elements', () => {
    add(700)
    add(650)
    expect(toastClearance(document, 900)).toBe(250)
  })
  it('is never negative', () => {
    add(950)
    expect(toastClearance(document, 900)).toBe(0)
  })
  it('ignores an element inside [data-leaving]', () => {
    const leaving = document.createElement('div')
    leaving.setAttribute('data-leaving', '')
    document.body.append(leaving)
    add(500, leaving)
    expect(toastClearance(document, 900)).toBe(0)
    add(700)
    expect(toastClearance(document, 900)).toBe(200)
  })
})
