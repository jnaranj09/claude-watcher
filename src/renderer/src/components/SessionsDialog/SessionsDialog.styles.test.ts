// The Sessions dialog's own sheet (jsdom has no layout; the drive run measured the rail). Pins the
// two things the 2026-10-03 drive found: the bulk bar's count never wraps, and Select all's box
// lines up with the row boxes.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SessionsDialog/SessionsDialog.module.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (selector: string): string =>
  new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(
    css
  )?.[1] ?? ''

describe('Sessions dialog sheet', () => {
  it('the bulk count takes its own line above [Archive] [Delete]: the armed `Confirm delete` leaves it no room on one line in the rail', () => {
    expect(rule('.bulkBar')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule('.bulkCount')).toMatch(/flex:\s*1 0 100%/)
    expect(rule('.bulkCount')).toMatch(/white-space:\s*nowrap/)
  })

  it('Select all`s box drops the browser margin, so it lines up with the row boxes', () => {
    expect(rule('.selectAll input')).toMatch(/margin:\s*0/)
  })
})
