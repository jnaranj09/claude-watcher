#!/usr/bin/env node
// technical-taste §4 "Same thing, same word" — the design-time check (PreToolUse on
// Write/Edit/MultiEdit). A spec in docs/superpowers/specs/ dated 2026-10-06 or later must carry a
// `## Copy` section: a table that sets every new operator-facing word beside how the app names the
// same thing today (file:line, or "none, searched"), or the line "No new text.". The owner then
// sees the wording in one place, before any code exists. Exit 2 blocks the write; stderr says why.
// Older specs are left alone. Tested by tests/main/specCopyHook.test.ts.
import { runSpecHook } from './specFile.mjs'

const RULE_START = '2026-10-06'
const HEADER = '| New text | Same thing in the app today |'

/** The problem with `text`, or null when its Copy section is fine. */
function copyProblem(text) {
  const m = /^##\s+Copy\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(text)
  if (m === null) return 'it has no `## Copy` section'
  const body = m[1]
  if (/^No new text\.\s*$/m.test(body)) return null
  const lines = body.split('\n').map((l) => l.trim())
  const head = lines.findIndex((l) =>
    /^\|\s*New text\s*\|\s*Same thing in the app today\s*\|$/i.test(l)
  )
  if (head === -1) return 'its `## Copy` section has no `' + HEADER + '` table'
  const rows = lines.slice(head + 2).filter((l) => l.startsWith('|'))
  if (rows.length === 0) return 'its `## Copy` table has no rows'
  for (const row of rows) {
    const cells = row
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    if (cells.length < 2 || cells[0] === '' || cells[1] === '') {
      return `the row \`${row}\` leaves a cell empty (write "none, searched" when nothing exists)`
    }
  }
  return null
}

runSpecHook((text, _file, date) => {
  if (date < RULE_START) return null
  const problem = copyProblem(text)
  if (problem === null) return null
  return (
    `Spec blocked: ${problem}.\n` +
    'technical-taste §4 "Same thing, same word": before naming anything the operator sees, search ' +
    'how the app already names that thing and reuse the word. Add:\n\n' +
    '## Copy\n\n' +
    `${HEADER}\n| --- | --- |\n` +
    '| `<button / title / toast text>` | `<the existing text>` (file:line), or none, searched |\n\n' +
    'or the line "No new text." when the spec adds no operator-facing words.\n'
  )
})
