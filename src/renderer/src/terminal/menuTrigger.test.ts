import { describe, it, expect } from 'vitest'
import { opensTerminalMenu } from './menuTrigger'

const plain = { shiftKey: false, ctrlKey: false }
const shift = { shiftKey: true, ctrlKey: false }
const ctrl = { shiftKey: false, ctrlKey: true }

describe('opensTerminalMenu', () => {
  it('right-click (default) opens on any right-click, as before', () => {
    expect([plain, shift, ctrl].map((e) => opensTerminalMenu('right-click', e))).toEqual([
      true,
      true,
      true
    ])
  })

  it('shift-right-click opens only with Shift', () => {
    expect([plain, shift, ctrl].map((e) => opensTerminalMenu('shift-right-click', e))).toEqual([
      false,
      true,
      false
    ])
  })

  it('ctrl-right-click opens only with Ctrl', () => {
    expect([plain, shift, ctrl].map((e) => opensTerminalMenu('ctrl-right-click', e))).toEqual([
      false,
      false,
      true
    ])
  })
})
