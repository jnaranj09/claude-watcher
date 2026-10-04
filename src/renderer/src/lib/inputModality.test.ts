// Overlay motion (spec 2026-10-04 §2) — the last input decides if an overlay animates.
import { describe, it, expect, afterEach } from 'vitest'
import { installInputModality, lastInput } from './inputModality'

let uninstall: (() => void) | undefined
afterEach(() => {
  uninstall?.()
  uninstall = undefined
})

describe('inputModality', () => {
  it('is null before any input (jsdom .click() fires no pointerdown)', () => {
    uninstall = installInputModality()
    expect(lastInput()).toBeNull()
    expect(document.documentElement.dataset.input).toBeUndefined()
  })
  it('a keydown sets keyboard, a pointerdown sets pointer', () => {
    uninstall = installInputModality()
    window.dispatchEvent(new Event('keydown'))
    expect(lastInput()).toBe('keyboard')
    expect(document.documentElement.dataset.input).toBe('keyboard')
    window.dispatchEvent(new Event('pointerdown'))
    expect(lastInput()).toBe('pointer')
  })
  it('listens in the capture phase, so a handler that stops propagation cannot hide the input', () => {
    uninstall = installInputModality()
    const stop = (e: Event): void => e.stopPropagation()
    document.body.addEventListener('keydown', stop)
    document.body.dispatchEvent(new Event('keydown', { bubbles: true }))
    document.body.removeEventListener('keydown', stop)
    expect(lastInput()).toBe('keyboard')
  })
  it('uninstall stops listening and clears the flag', () => {
    const off = installInputModality()
    window.dispatchEvent(new Event('pointerdown'))
    off()
    expect(lastInput()).toBeNull()
    window.dispatchEvent(new Event('keydown'))
    expect(lastInput()).toBeNull()
  })
})
