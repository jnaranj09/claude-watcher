// submenuSide — which side the filter's type submenu opens on (spec 2026-10-16 §3).
import { describe, it, expect } from 'vitest'
import { cssRule } from '../../test/cssRule'
import {
  FILTER_LIST_MAX,
  popupAlign,
  SUBMENU_GAP,
  submenuSide,
  SUBMENU_ROOM
} from './submenuSide'

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

// The flip rule reserves SUBMENU_ROOM beside the type menu, so no value list may be wider than the
// room minus the gap it opens at. TS owns the numbers; the CSS writes them again (rule 1: CSS
// cannot import TS), and this test reads both sides.
describe('FILTER_LIST_MAX — every value list fits in SUBMENU_ROOM', () => {
  it('the list plus its gap is SUBMENU_ROOM', () => {
    expect(FILTER_LIST_MAX + SUBMENU_GAP).toBe(SUBMENU_ROOM)
  })

  it('the gap is the submenu offset Popover draws (--space-2 + --space-1)', () => {
    const offset = /calc\(100% \+ var\(--space-2\) \+ var\(--space-1\)\)/
    expect(cssRule('components/Popover/Popover.module.css', ".submenuWrap[data-side='right']")).toMatch(
      offset
    )
    const tokens = cssRule('styles/tokens.css', ':root')
    const px = (name: string): number => Number(new RegExp(`--${name}: (\\d+)px;`).exec(tokens)?.[1])
    expect(px('space-2') + px('space-1')).toBe(SUBMENU_GAP)
  })

  it('the chip row caps every popup it opens at FILTER_LIST_MAX, and the Surface reads the cap', () => {
    expect(cssRule('components/FilterChips/FilterChips.module.css', '.chipRow')).toMatch(
      new RegExp(`--popover-max-width: ${FILTER_LIST_MAX}px;`)
    )
    expect(cssRule('components/Popover/Popover.module.css', '.surface')).toMatch(
      /max-width: var\(--popover-max-width, none\);/
    )
  })
})
