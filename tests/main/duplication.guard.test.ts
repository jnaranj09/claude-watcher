// Duplication guard (maintainability.md "Habits": search before you write; technical-taste §5b-14).
// `npm run lint` runs jscpd with a 0.5% threshold, so one new pasted block stays green until the
// repo total crosses it. This guard pins the clones jscpd finds today, by file pair: a new copy
// in any file fails, and so does a swap (fix one, paste another). The list only shrinks: fold a
// clone, delete its line in the same commit. jscpd reads `.jscpd.json` (same scope as lint).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'

const ROOT = resolve(__dirname, '../..')

/** Clones that existed when this guard landed (2026-11-23), as "fileA <-> fileB", sorted. */
const PINNED_CLONES = [
  'src/main/kde/attentionReminders.ts <-> src/main/rules/ruleTimers.ts',
  'src/main/pty/terminalManager.ts <-> src/main/pty/terminalManager.ts',
  'src/main/pty/terminalManager.ts <-> src/main/pty/terminalManager.ts',
  'src/renderer/src/components/RulesDialog/RuleForm.tsx <-> src/renderer/src/components/TemplatesDialog/TemplateForm.tsx',
  'src/renderer/src/components/Settings/Settings.tsx <-> src/renderer/src/components/Settings/Settings.tsx',
  'src/renderer/src/components/ShortcutsDialog/ShortcutForm.tsx <-> src/renderer/src/components/TemplatesDialog/TemplateForm.tsx',
  'src/renderer/src/components/TagsDialog/TagsPage.tsx <-> src/renderer/src/components/TemplatesDialog/TemplateForm.tsx'
]

const ReportSchema = z.object({
  statistics: z.object({ total: z.object({ sources: z.number() }) }),
  duplicates: z.array(
    z.object({
      firstFile: z.object({ name: z.string() }),
      secondFile: z.object({ name: z.string() })
    })
  )
})

/** "fileA <-> fileB" per clone, both names sorted, the list sorted. */
export function clonePairs(report: z.infer<typeof ReportSchema>): string[] {
  return report.duplicates
    .map((d) => [d.firstFile.name, d.secondFile.name].sort().join(' <-> '))
    .sort()
}

describe('clonePairs', () => {
  it('names each clone by its sorted file pair', () => {
    const report = {
      statistics: { total: { sources: 2 } },
      duplicates: [{ firstFile: { name: 'src/b.ts' }, secondFile: { name: 'src/a.ts' } }]
    }
    expect(clonePairs(report)).toEqual(['src/a.ts <-> src/b.ts'])
  })
})

describe('duplication budget', () => {
  it('jscpd finds exactly the pinned clones (the list only shrinks)', { timeout: 60_000 }, () => {
    const out = mkdtempSync(join(tmpdir(), 'cw-jscpd-'))
    try {
      const run = spawnSync(
        join(ROOT, 'node_modules/.bin/jscpd'),
        ['--reporters', 'json', '--output', out, '--silent'],
        { cwd: ROOT, encoding: 'utf8' }
      )
      expect(run.error).toBeUndefined()
      const report = ReportSchema.parse(
        JSON.parse(readFileSync(join(out, 'jscpd-report.json'), 'utf8'))
      )
      // A walk that reads no files is broken, not clean.
      expect(report.statistics.total.sources).toBeGreaterThan(100)
      expect(clonePairs(report)).toEqual(PINNED_CLONES)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})
