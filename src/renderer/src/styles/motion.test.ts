// Overlay motion (spec 2026-10-04) — the CSS exit length and the JS unmount timer are one number.
// If they drift, an exit is cut off (timer shorter) or the box sits invisible (timer longer).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { MOTION_EXIT_MS } from './motion'

const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles/motion.css'), 'utf8')
const decl = (name: string): string | undefined =>
  new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim()

describe('motion values', () => {
  it('--motion-exit equals MOTION_EXIT_MS', () => {
    expect(MOTION_EXIT_MS).toBe(150)
    expect(decl('motion-exit')).toBe(`${MOTION_EXIT_MS}ms`)
  })
  it('declares the enter length and both curves', () => {
    expect(decl('motion-enter')).toBe('150ms')
    expect(decl('motion-ease-enter')).toBe('cubic-bezier(0.23, 1, 0.32, 1)')
    expect(decl('motion-ease-exit')).toBe('ease')
  })
  it('is imported once at the renderer root', () => {
    const main = readFileSync(join(process.cwd(), 'src/renderer/src/assets/main.css'), 'utf8')
    expect(main).toContain("@import '../styles/motion.css';")
  })
})

describe('dialog motion (spec 2026-10-04 §6)', () => {
  const D = "[role='dialog'][data-motion='dialog']"
  /** The declarations of the first rule whose selector is exactly `sel`. */
  const rule = (sel: string): string => {
    const i = css.indexOf(`${sel} {`)
    expect(i, sel).toBeGreaterThanOrEqual(0)
    return css.slice(i, css.indexOf('}', i))
  }
  it('the scrim fades its colour, never the overlay opacity (Liquid Glass backdrop root)', () => {
    expect(rule(D)).toContain('background-color var(--motion-enter)')
    expect(rule(D)).not.toContain('opacity')
    expect(rule(`${D}[data-leaving]`)).toContain('background-color: transparent')
  })
  it('the panel moves (translate + scale) and only its content fades', () => {
    expect(rule(`${D} > *`)).not.toContain('opacity')
    expect(rule(`${D} > * > *`)).toContain('opacity var(--motion-enter)')
    expect(rule(`${D}[data-leaving] > *`)).toMatch(/translate:\s*0 6px;\s*scale:\s*0\.98;/)
  })
  it('is instant on keyboard and under reduced motion', () => {
    expect(css).toContain(`:root[data-input='keyboard'] ${D},`)
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\[role='dialog'\]/)
  })
})
