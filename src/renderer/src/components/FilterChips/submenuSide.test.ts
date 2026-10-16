// submenuSide — which side the filter's type submenu opens on (spec 2026-10-16 §3).
import { describe, it, expect } from 'vitest'
import { popupAlign, submenuSide, SUBMENU_ROOM } from './submenuSide'

describe('submenuSide', () => {
  it('opens right while there is room, left at the window edge', () => {
    expect(submenuSide(400, 1280)).toBe('right')
    expect(submenuSide(1280 - SUBMENU_ROOM + 1, 1280)).toBe('left')
  })
})

describe('popupAlign', () => {
  it('lines a popup up with the trigger left edge while the widest list fits, else its right edge', () => {
    expect(popupAlign(400, 1280)).toBe('start')
    expect(popupAlign(1280 - SUBMENU_ROOM, 1280)).toBe('start')
    expect(popupAlign(1280 - SUBMENU_ROOM + 1, 1280)).toBe('end')
  })
})
