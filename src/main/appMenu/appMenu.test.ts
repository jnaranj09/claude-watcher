import { describe, expect, it, vi } from 'vitest'
import { applicationMenuTemplate, installDevToolsToggle, type DevToolsTarget } from './appMenu'

describe('applicationMenuTemplate', () => {
  it('is null on Linux and Windows: no menu, so no accelerator eats a key claude needs', () => {
    expect(applicationMenuTemplate('linux')).toBeNull()
    expect(applicationMenuTemplate('win32')).toBeNull()
  })

  it('keeps only the app and Edit menus on macOS (Cmd+C/V/Q), never View (Cmd+R reload)', () => {
    const template = applicationMenuTemplate('darwin')
    expect(template?.map((item) => item.role)).toEqual(['appMenu', 'editMenu'])
  })
})

type InputListener = Parameters<DevToolsTarget['on']>[1]

function fakeWebContents(): {
  wc: DevToolsTarget
  press: (input: { type: string; code: string }) => boolean
  isOpen: () => boolean
} {
  let open = false
  let listener: InputListener | undefined
  const wc: DevToolsTarget = {
    on: (_event, l) => {
      listener = l
    },
    isDevToolsOpened: () => open,
    openDevTools: vi.fn(() => {
      open = true
    }),
    closeDevTools: vi.fn(() => {
      open = false
    })
  }
  return {
    wc,
    press: (input) => {
      if (listener === undefined) throw new Error('no before-input-event listener installed')
      let prevented = false
      listener({ preventDefault: () => (prevented = true) }, input)
      return prevented
    },
    isOpen: () => open
  }
}

describe('installDevToolsToggle', () => {
  it('F12 opens DevTools, then closes them, and never reaches the page', () => {
    const f = fakeWebContents()
    installDevToolsToggle(f.wc)
    expect(f.press({ type: 'keyDown', code: 'F12' })).toBe(true)
    expect(f.isOpen()).toBe(true)
    expect(f.press({ type: 'keyDown', code: 'F12' })).toBe(true)
    expect(f.isOpen()).toBe(false)
  })

  it('leaves every other key alone — Ctrl+R included', () => {
    const f = fakeWebContents()
    installDevToolsToggle(f.wc)
    expect(f.press({ type: 'keyDown', code: 'KeyR' })).toBe(false)
    expect(f.press({ type: 'keyUp', code: 'F12' })).toBe(false)
    expect(f.isOpen()).toBe(false)
  })
})
