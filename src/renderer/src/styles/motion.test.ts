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
