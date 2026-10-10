// The moving light on the CSS glass of overlays (owner, 2026-10-08): which element under the
// pointer takes the angle, and how it is written for the theme.
import { afterEach, describe, expect, it } from 'vitest'
import { GLASS_LIGHT_PROP, overlayLightTarget, setOverlayLight } from './overlayLight'

afterEach(() => document.body.replaceChildren())

function dom(html: string): (id: string) => HTMLElement {
  document.body.innerHTML = html
  return (id) => {
    const el = document.getElementById(id)
    if (el === null) throw new Error(`no #${id}`)
    return el
  }
}

describe('overlayLightTarget', () => {
  it('takes the innermost lit surface inside a popover: the row, not its box', () => {
    const $ = dom(
      `<div data-popover id="box"><button data-popover-item id="row"><span id="text">Ops</span></button></div>`
    )
    expect(overlayLightTarget($('text'))).toBe($('row'))
    expect(overlayLightTarget($('box'))).toBeNull() // the box has no rim to light
  })

  it('takes a primary/secondary button inside a modal or a toast, and the toast itself', () => {
    const $ = dom(`
      <div role="dialog" aria-modal="true"><button data-variant="primary" id="save">Save</button></div>
      <div data-toast id="toast"><span id="msg">Saved</span><button data-variant="secondary" id="undo">Undo</button></div>`)
    expect(overlayLightTarget($('save'))).toBe($('save'))
    expect(overlayLightTarget($('undo'))).toBe($('undo'))
    expect(overlayLightTarget($('msg'))).toBe($('toast'))
  })

  it('leaves board controls to the WebGL layer, and skips ghost, danger and disabled buttons', () => {
    const $ = dom(`
      <header><button data-variant="secondary" id="board">+ New session</button></header>
      <div data-popover><button data-variant="ghost" id="ghost">x</button><button data-variant="danger" id="danger">x</button>
        <button data-popover-item disabled id="off">Off</button></div>`)
    expect(overlayLightTarget($('board'))).toBeNull()
    expect(overlayLightTarget($('ghost'))).toBeNull()
    expect(overlayLightTarget($('danger'))).toBeNull()
    expect(overlayLightTarget($('off'))).toBeNull()
    expect(overlayLightTarget(null)).toBeNull()
  })
})

describe('setOverlayLight', () => {
  it('writes the angle as the --glass-light custom property, and removes it', () => {
    const $ = dom(`<div id="el"></div>`)
    setOverlayLight($('el'), 30)
    expect($('el').style.getPropertyValue(GLASS_LIGHT_PROP)).toBe('30deg')
    setOverlayLight($('el'), null)
    expect($('el').style.getPropertyValue(GLASS_LIGHT_PROP)).toBe('')
  })
})
