// Action feedback (spec 2026-09-29 §1.2) — the Toaster is mounted ONCE, and outside the subtree
// that goes inert under a modal (the header and the view layers inside <main>). jsdom cannot see
// `inert` stacking, so read the source: one <Toaster />, after </main>.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const app = readFileSync(join(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')

describe('App mounts the Toaster once, outside the inert subtree', () => {
  it('renders exactly one <Toaster />', () => {
    expect(app.match(/<Toaster \/>/g) ?? []).toHaveLength(1)
  })

  it('renders it after </main> (never inside the header or a view layer)', () => {
    expect(app.lastIndexOf('<Toaster />')).toBeGreaterThan(app.lastIndexOf('</main>'))
  })
})
