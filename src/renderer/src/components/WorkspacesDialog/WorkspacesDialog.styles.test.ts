// The Workspaces dialog sheet. Tests can't see layout; these pin the rules the CSS must keep.
import { describe, it, expect } from 'vitest'
import { cssRule } from '../../test/cssRule'

const rule = (selector: string): string =>
  cssRule('components/WorkspacesDialog/WorkspacesDialog.module.css', selector)

describe('Workspaces dialog sheet', () => {
  // design.md, label → its control: a colour's swatch names its radio, so it sits `--gap-field`
  // from it (Radio drops the browser margin that stood in for that gap).
  it('a colour swatch sits --gap-field from its radio', () => {
    expect(rule('.colorOption')).toMatch(/gap: var\(--gap-field\);/)
  })
})
