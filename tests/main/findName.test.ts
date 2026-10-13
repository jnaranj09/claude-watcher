// Pins tests/tools/findName.mjs — the search step of "nothing stale survives". Each case is a
// place a plain `rg <name>` missed or got wrong while the rule was stress-tested (2026-10-13):
// regex characters, a leading `--`, the hidden `.claude/`, the nested `_bmad-output/_bmad-output/`
// a named folder does not un-ignore, the self-ignoring `docs/reports/`, records that live only in
// another worktree, a moved file cited by a relative path, a name a hard wrap splits across
// comment lines, a hand-wrapped string join or a JSX `{' '}` break, an untracked new file, the
// CLI's `--` handling and exit codes. Round 11 added the two stderr warnings, the full-path label
// for worktrees that share a folder name, and no basename needle for a folder or a chord.
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs tool, no type declarations
import { findName, needlesFor } from '../tools/findName.mjs'

const TOOL = path.resolve(__dirname, '../tools/findName.mjs')

interface Hit {
  kind: 'tree' | 'record'
  worktree: string
  file: string
  line: number
  text: string
}

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function initRepo(dir: string): void {
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
}

function put(root: string, rel: string, body: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), body)
}

let root = ''
let other = ''
const files = (name: string): string[] =>
  (findName(root, name) as Hit[]).map((h) =>
    h.kind === 'tree' ? h.file : `[${h.worktree}] ${h.file}`
  )

beforeAll(() => {
  const base = mkdtempSync(path.join(tmpdir(), 'find-name-'))
  root = path.join(base, 'main')
  other = path.join(base, 'branch')
  mkdirSync(root)
  initRepo(root)
  // `.superpowers/` is NOT ignored here: in a real clone only a local `.git/info/exclude` may
  // ignore it, so the tool must skip it by name.
  put(root, '.gitignore', 'docs/superpowers/\n_bmad-output/\nnode_modules/\n')
  put(root, 'src/motion.ts', "export const css = 'var(--motion-exit)'\n")
  put(root, 'src/regex.ts', '// press Ctrl+Alt+X, then $1\n// CtrlAAltXX must not match\n')
  put(root, 'src/settings.ts', '// see ../profile.ts for the ports\n')
  put(root, '.claude/rules/design.md', 'isDialogOpen lives in App.tsx\n')
  put(root, 'docs/reports/.gitignore', '*\n')
  put(root, 'docs/reports/bug-hunt.md', 'isDialogOpen was racy\n')
  put(root, 'docs/superpowers/specs/x.md', 'isDialogOpen spec\n')
  put(root, '_bmad-output/_bmad-output/epics.md', 'isDialogOpen story\n')
  put(root, '.superpowers/sdd/brief.md', 'isDialogOpen scratch\n')
  put(root, 'node_modules/dep/index.js', 'isDialogOpen vendored\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'init')
  git(root, 'worktree', 'add', '-q', other, '-b', 'feat')
  put(other, 'docs/superpowers/specs/only-here.md', 'isDialogOpen on the branch\n')
  // After the commit: a new file not yet added is still part of the tree.
  put(root, 'docs/wrap.md', '> the Liquid\n> Glass theme\n')
  put(root, 'tools/wrap.sh', '# the Paper\n# theme is light\n')
  put(
    root,
    'src/wrap.ts',
    "// the header's `+ New\n// session` popover\n/** the Manage\n *  dialog's filter */\n"
  )
  put(
    root,
    'src/concat.ts',
    "const a = 'open the Ready ' +\n  'column first'\n" +
      'const b = "then the Dead" +\n  ` column`\n' +
      "const c = 'Gluedword' +\n  'tail'\n"
  )
  put(root, 'src/jsx.tsx', "const p = (\n  <p>\n    the Past{' '}\n    sessions list\n  </p>\n)\n")
  put(root, 'src/glassy.ts', '// the glass shader, bound to Ctrl+\n')
})

describe('findName', () => {
  it('reads the name as an exact string, never a regex or a flag', () => {
    expect(files('--motion-exit')).toEqual(['src/motion.ts'])
    const chord = findName(root, 'Ctrl+Alt+X') as Hit[]
    expect(chord.map((h) => `${h.file}:${h.line}`)).toEqual(['src/regex.ts:1'])
    expect(files('$1')).toEqual(['src/regex.ts'])
  })

  it('searches the hidden .claude/ and every record folder, nested or self-ignored', () => {
    const hits = files('isDialogOpen')
    expect(hits).toContain('.claude/rules/design.md')
    expect(hits).toContain('[main] docs/reports/bug-hunt.md')
    expect(hits).toContain('[main] docs/superpowers/specs/x.md')
    expect(hits).toContain('[main] _bmad-output/_bmad-output/epics.md')
  })

  it('reaches records that live only in another worktree', () => {
    expect(files('isDialogOpen')).toContain('[branch] docs/superpowers/specs/only-here.md')
  })

  it('skips scratch and ignored build or vendor folders', () => {
    const hits = files('isDialogOpen')
    expect(hits.some((f) => f.includes('.superpowers'))).toBe(false)
    expect(hits.some((f) => f.includes('node_modules'))).toBe(false)
  })

  it('searches a moved file by its basename too, so a relative path is found', () => {
    expect(needlesFor('src/main/profile.ts')).toEqual(['src/main/profile.ts', 'profile.ts'])
    expect(files('src/main/profile.ts')).toEqual(['src/settings.ts'])
  })

  it('adds a basename needle only for a file path, never a folder or a chord', () => {
    expect(needlesFor('docs/themes/THEMES.md')).toEqual(['docs/themes/THEMES.md', 'THEMES.md'])
    expect(needlesFor('src/renderer/src/glass/')).toEqual(['src/renderer/src/glass/'])
    expect(needlesFor('src/main/c9watch')).toEqual(['src/main/c9watch'])
    expect(needlesFor('Ctrl+/')).toEqual(['Ctrl+/'])
    expect(files('src/renderer/src/glass/')).toEqual([])
    expect(files('Ctrl+/')).toEqual([])
  })

  it('finds a name split across a hand-wrapped string join or a JSX space break', () => {
    const at = (name: string): string[] =>
      (findName(root, name) as Hit[]).map((h) => `${h.file}:${h.line}`)
    expect(at('Ready column')).toEqual(['src/concat.ts:1'])
    expect(at('Dead column')).toEqual(['src/concat.ts:3'])
    expect(at('Past sessions')).toEqual(['src/jsx.tsx:3'])
    // No space on either side of the join: the words are glued in the real string.
    expect(at('Gluedword tail')).toEqual([])
  })

  it('finds a name a hard wrap splits across comment lines, in an untracked file', () => {
    const plus = findName(root, '+ New session') as Hit[]
    expect(plus.map((h) => `${h.file}:${h.line}`)).toEqual(['src/wrap.ts:1'])
    const manage = findName(root, 'Manage dialog') as Hit[]
    expect(manage.map((h) => `${h.file}:${h.line}`)).toEqual(['src/wrap.ts:3'])
    expect(files('Liquid Glass')).toEqual(['docs/wrap.md'])
    expect(files('Paper theme')).toEqual(['tools/wrap.sh'])
  })

  it('CLI: `--` ends options, a `--name` is searched, exit 1 when nothing is found', () => {
    const cli = (...args: string[]): ReturnType<typeof spawnSync> =>
      spawnSync('node', [TOOL, ...args], { cwd: root, encoding: 'utf8' })
    const hit = cli('--', '--motion-exit')
    expect(hit.status).toBe(0)
    expect(hit.stdout).toContain('src/motion.ts:1')
    expect(cli('--', 'no-such-name-anywhere').status).toBe(1)
  })
})

// A separate repo: an unreadable file and a deleted worktree would warn in every case above.
describe('findName warnings and worktree labels (CLI)', () => {
  let main = ''
  let base = ''
  beforeAll(() => {
    base = mkdtempSync(path.join(tmpdir(), 'find-name-warn-'))
    main = path.join(base, 'main')
    mkdirSync(main)
    initRepo(main)
    put(main, '.gitignore', 'docs/superpowers/\n')
    put(main, 'src/a.ts', 'shared needle\n')
    git(main, 'add', '-A')
    git(main, 'commit', '-q', '-m', 'init')
    for (const [dir, branch] of [
      ['x/wt', 'b1'],
      ['y/wt', 'b2'],
      ['gone', 'b3']
    ] as const) {
      git(main, 'worktree', 'add', '-q', path.join(base, dir), '-b', branch)
      put(path.join(base, dir), 'docs/superpowers/r.md', 'shared needle record\n')
    }
    rmSync(path.join(base, 'gone'), { recursive: true, force: true })
  })

  const cli = (): ReturnType<typeof spawnSync> =>
    spawnSync('node', [TOOL, 'shared needle'], { cwd: main, encoding: 'utf8' })

  it('labels worktrees that share a folder name by their full path', () => {
    const out = String(cli().stdout)
    expect(out).toContain(`[${path.join(base, 'x/wt')}] docs/superpowers/r.md:1`)
    expect(out).toContain(`[${path.join(base, 'y/wt')}] docs/superpowers/r.md:1`)
    expect(out).toContain('src/a.ts:1')
  })

  it('warns on stderr for a worktree missing on disk', () => {
    const run = cli()
    expect(run.status).toBe(0)
    expect(String(run.stderr)).toContain(
      `code=find_name_worktree_missing path=${path.join(base, 'gone')}`
    )
  })

  it.skipIf(process.getuid?.() === 0)('warns on stderr for a file it cannot read', () => {
    const locked = path.join(main, 'src/locked.ts')
    put(main, 'src/locked.ts', 'shared needle\n')
    chmodSync(locked, 0o000)
    try {
      const run = cli()
      expect(String(run.stderr)).toContain(`code=find_name_unreadable file=${locked} errno=EACCES`)
      expect(String(run.stdout)).not.toContain('src/locked.ts')
    } finally {
      chmodSync(locked, 0o644)
    }
  })
})
