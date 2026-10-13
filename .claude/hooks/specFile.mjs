// Shared by the spec hooks (spec-copy-table.mjs, spec-taste-line.mjs): which file is a dated spec,
// what its text will be once the Write/Edit/MultiEdit lands, and the stdin → exit-code loop.
// Exit 2 blocks the write and shows stderr to the agent; exit 0 lets it through.
import { existsSync, readFileSync } from 'node:fs'

/** The `YYYY-MM-DD` of a dated spec under docs/superpowers/specs/, or null for any other file. */
export function specDate(file) {
  const m = /docs\/superpowers\/specs\/(\d{4}-\d{2}-\d{2})-[^/]*\.md$/.exec(file)
  return m === null ? null : m[1]
}

/** The file's text after the edit, or null when it cannot be known (Edit of a missing file). */
export function resultingText(tool, input) {
  if (tool === 'Write') return input.content ?? ''
  if (!existsSync(input.file_path)) return null
  let text = readFileSync(input.file_path, 'utf8')
  const edits = tool === 'MultiEdit' ? (input.edits ?? []) : [input]
  for (const e of edits) {
    if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string') return null
    text = e.replace_all
      ? text.split(e.old_string).join(e.new_string)
      : text.replace(e.old_string, () => e.new_string)
  }
  return text
}

/** Runs `check(text, file, date)` on a spec write; a returned string blocks it with that message. */
export function runSpecHook(check) {
  let raw = ''
  process.stdin.on('data', (d) => (raw += d))
  process.stdin.on('end', () => {
    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      process.exit(0)
    }
    const input = payload.tool_input ?? {}
    const file = String(input.file_path ?? '')
    const date = specDate(file)
    if (date === null) process.exit(0)
    const text = resultingText(payload.tool_name, input)
    if (text === null) process.exit(0)
    const message = check(text, file, date)
    if (typeof message !== 'string') process.exit(0)
    process.stderr.write(message)
    process.exit(2)
  })
}
