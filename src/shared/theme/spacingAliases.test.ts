// `gutter` and `card-gap` are documented theme tokens (THEMES.md). The spacing roles read FROM
// them, so a theme that sets either still moves the board (spec 2026-10-01-spacing-roles).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { TOKENS } from './tokens'

const board = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/board/Board.module.css'),
  'utf8'
)

describe('board spacing follows the theme tokens gutter and card-gap', () => {
  it('the page role reads --gutter and the card role reads --card-gap', () => {
    expect(TOKENS['gap-page']).toBe('var(--gutter)')
    expect(TOKENS['gap-card']).toBe('var(--card-gap)')
    expect(TOKENS.gutter).toBe('var(--space-4)')
    expect(TOKENS['card-gap']).toBe('var(--space-3)')
  })

  it('cards in a column are spaced by --gap-card', () => {
    expect(board).toMatch(/\.column\s*\{[^}]*gap:\s*var\(--gap-card\)/)
    expect(board).toMatch(/\.cardStack\s*\{[^}]*gap:\s*var\(--gap-card\)/)
  })
})
