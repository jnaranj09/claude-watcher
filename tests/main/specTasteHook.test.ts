// technical-taste §0: a spec written from 2026-10-13 on names the technical-taste sections it
// applied, on a `Taste:` line before its first `## ` heading. The hook
// (.claude/hooks/spec-taste-line.mjs, PreToolUse on Write/Edit/MultiEdit) blocks the write when the
// line is missing, names no `§`, or names a `§` that technical-taste.md has no `## <id>.` heading
// for — so the line cannot be filled with made-up sections.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '../../.claude/hooks/spec-taste-line.mjs')
const TASTE = '# Taste\n\n## 0. How\n\n## 4. Copy\n\n## 5. Eng\n\n## 5b. Canon\n\n## 10. Process\n'

let repo = ''
let spec = ''
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'taste-hook-'))
  mkdirSync(join(repo, 'docs/superpowers/specs'), { recursive: true })
  writeFileSync(join(repo, 'technical-taste.md'), TASTE)
  spec = join(repo, 'docs/superpowers/specs/2026-10-13-thing-design.md')
})

function run(payload: object): { status: number | null; stderr: string } {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: repo
  })
  return { status: r.status, stderr: r.stderr }
}
const write = (file_path: string, content: string): { status: number | null; stderr: string } =>
  run({ tool_name: 'Write', tool_input: { file_path, content } })

describe('spec Taste-line hook', () => {
  it('lets a spec with a valid Taste: line through', () => {
    expect(write(spec, '# Thing\n\nTaste: §0, §4, §5b-17, §10\n\n## Goal\n').status).toBe(0)
  })

  it('blocks a spec with no Taste: line, and says what to add', () => {
    const r = write(spec, '# Thing\n\n## Goal\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('Taste:')
    expect(r.stderr).toContain('technical-taste.md')
  })

  it('blocks a Taste: line written after the first ## heading', () => {
    expect(write(spec, '# Thing\n\n## Goal\n\nTaste: §4\n').status).toBe(2)
  })

  it('blocks a Taste: line that names no §', () => {
    expect(write(spec, '# Thing\n\nTaste: copy tone\n\n## Goal\n').status).toBe(2)
  })

  it('blocks a § with no heading, matching ids exactly (never by prefix)', () => {
    const r = write(spec, '# Thing\n\nTaste: §4, §99\n\n## Goal\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('§99')
    // `## 10.` exists but `## 1.` does not; `## 5b.` exists but `## 5c.` does not.
    expect(write(spec, '# T\n\nTaste: §1\n\n## G\n').status).toBe(2)
    expect(write(spec, '# T\n\nTaste: §5c\n\n## G\n').status).toBe(2)
  })

  it('blocks when technical-taste.md is missing (fail closed), and says why', () => {
    rmSync(join(repo, 'technical-taste.md'))
    const r = write(spec, '# Thing\n\nTaste: §4\n\n## Goal\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('technical-taste.md')
  })

  it('finds technical-taste.md from a relative spec path via the cwd', () => {
    const rel = 'docs/superpowers/specs/2026-10-13-thing-design.md'
    expect(write(rel, '# T\n\nTaste: §4\n\n## G\n').status).toBe(0)
    expect(write(rel, '# T\n\nTaste: §99\n\n## G\n').status).toBe(2)
  })

  it('ignores files that are not specs, and specs dated before the rule', () => {
    expect(write(join(repo, 'src/x.md'), '# x').status).toBe(0)
    expect(write(join(repo, 'docs/superpowers/plans/2026-10-13-p.md'), '# p').status).toBe(0)
    expect(write(join(repo, 'docs/superpowers/specs/2026-10-12-old-design.md'), '# o').status).toBe(
      0
    )
  })

  it('checks an Edit and a MultiEdit against the file they would produce', () => {
    writeFileSync(spec, '# X\n\nTaste: §4\n\n## Goal\n')
    const keep = run({
      tool_name: 'Edit',
      tool_input: { file_path: spec, old_string: '# X', new_string: '# X2' }
    })
    expect(keep.status).toBe(0)
    const drop = run({
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: spec,
        edits: [
          { old_string: '# X', new_string: '# X2' },
          { old_string: 'Taste: §4\n', new_string: '' }
        ]
      }
    })
    expect(drop.status).toBe(2)
  })
})
