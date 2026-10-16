// submenuSide — which side the filter's type submenu opens on (spec 2026-10-16 §3).
import { describe, it, expect } from 'vitest'
import { submenuSide, SUBMENU_ROOM } from './submenuSide'

describe('submenuSide', () => {
  it('opens right while there is room, left at the window edge', () => {
    expect(submenuSide(400, 1280)).toBe('right')
    expect(submenuSide(1280 - SUBMENU_ROOM + 1, 1280)).toBe('left')
  })
})
