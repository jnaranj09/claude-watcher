// technical-taste §4 "Same thing, same word" — the design-time half. A spec written from
// 2026-10-06 on must carry a `## Copy` table that sets every new word beside how the app names the
// same thing today, so the owner sees the wording before any code exists. The hook
// (.claude/hooks/spec-copy-table.mjs, PreToolUse on Write/Edit/MultiEdit) blocks the write
// otherwise (exit 2, reason on stderr).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const HOOK = resolve(__dirname, '../../.claude/hooks/spec-copy-table.mjs')
const SPEC = '/repo/docs/superpowers/specs/2026-10-06-thing-design.md'
const TABLE = [
  '## Copy',
  '',
  '| New text | Same thing in the app today |',
  '| --- | --- |',
  '| `>_ Shell` | `>_ Shell` (views/FocusedSession.tsx:255) |'
].join('\n')

function run(payload: object): { status: number | null; stderr: string } {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' })
  return { status: r.status, stderr: r.stderr }
}
const write = (file_path: string, content: string): { status: number | null; stderr: string } =>
  run({ tool_name: 'Write', tool_input: { file_path, content } })

describe('spec Copy-table hook', () => {
  it('blocks a new spec with no ## Copy table, and says what to add', () => {
    const r = write(SPEC, '# Thing\n\n## Goal\n\nText.\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('## Copy')
    expect(r.stderr).toContain('Same thing in the app today')
  })

  it('lets a spec with the table through', () => {
    expect(write(SPEC, `# Thing\n\n${TABLE}\n`).status).toBe(0)
  })

  it('a row with an empty "today" cell is blocked (the search is the point)', () => {
    const r = write(SPEC, `# Thing\n\n${TABLE}\n| \`Open shell\` |  |\n`)
    expect(r.status).toBe(2)
  })

  it('"No new text." in the section is enough for a spec with no operator-facing words', () => {
    expect(write(SPEC, '# Thing\n\n## Copy\n\nNo new text.\n').status).toBe(0)
  })

  it('ignores files that are not specs, and specs dated before the rule', () => {
    expect(write('/repo/src/x.md', '# x').status).toBe(0)
    expect(write('/repo/docs/superpowers/plans/2026-10-06-p.md', '# p').status).toBe(0)
    expect(write('/repo/docs/superpowers/specs/2026-10-05-old-design.md', '# old').status).toBe(0)
  })

  it('checks an Edit against the file it would produce', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spec-hook-'))
    const file = join(dir, 'docs/superpowers/specs')
    const path = `${file}/2026-10-07-x-design.md`
    mkdirSync(file, { recursive: true })
    writeFileSync(path, `# X\n\n${TABLE}\n`)
    const keep = run({
      tool_name: 'Edit',
      tool_input: { file_path: path, old_string: '# X', new_string: '# X2' }
    })
    expect(keep.status).toBe(0)
    const drop = run({
      tool_name: 'Edit',
      tool_input: { file_path: path, old_string: TABLE, new_string: '' }
    })
    expect(drop.status).toBe(2)
  })
})
