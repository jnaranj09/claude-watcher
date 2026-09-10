// The shared workspace swatch + label. jsdom `unit` project, `renderComponent` harness (this
// repo does not install @testing-library/react — Story 1.3).
//
// The completeness check reads the CSS FILE, it does not index `styles`. Vitest is configured
// without `css: true` (vitest.config.ts), so a `*.module.css` import resolves to a proxy that
// returns a string for EVERY key — `expect(styles[color]).toBeTruthy()` passes even when the
// stylesheet declares nothing at all. That was the shape of the old check in
// WorkspaceSwitcher.test.tsx: it stayed green after its six color classes were deleted from
// that module, which is exactly the regression it claimed to catch.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { WORKSPACE_COLORS } from '../../../../shared/schemas/workspace'
import { WorkspaceDot } from './WorkspaceDot'

// Read from the repo root — vitest runs with cwd there. `import.meta.url` is NOT a file: URL
// under the vite transform, so `fileURLToPath` throws on it.
const CSS = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/WorkspaceDot/WorkspaceDot.module.css'),
  'utf8'
)

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(el: Parameters<typeof renderComponent>[0]): RenderResult {
  const r = renderComponent(el)
  cleanup = r.unmount
  return r
}

describe('WorkspaceDot', () => {
  // The swatch is decorative — the name always carries the meaning (the StatusDot precedent).
  // Without aria-hidden a screen reader announces an empty element between real content.
  it('hides the dot from assistive tech', () => {
    const { container } = render(<WorkspaceDot tone="rose" />)
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })

  // Completeness net over the CANONICAL array (never a hand-typed copy): a 7th WORKSPACE_COLORS
  // entry that gets no CSS class turns this red instead of rendering an invisible dot.
  it('declares a CSS class for every WORKSPACE_COLORS entry', () => {
    for (const color of WORKSPACE_COLORS) {
      expect(CSS, `missing .${color} in WorkspaceDot.module.css`).toContain(`.${color} {`)
    }
  })

  // Global and (no workspace) are NOT workspaces — they get their own swatches, and they must
  // stay apart from each other in greyscale, so the difference is shape (ring) vs fill (disc),
  // not two shades of the same disc.
  it('declares the two non-workspace tones with distinguishable shapes', () => {
    expect(CSS).toContain('.global {')
    expect(CSS).toContain('.orphan {')
    const global = CSS.slice(CSS.indexOf('.global {'), CSS.indexOf('.orphan {'))
    expect(global).toContain('box-shadow')
    expect(global).toContain('background: transparent')
  })
})
