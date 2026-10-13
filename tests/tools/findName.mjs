// Find every place that names a thing — the search step of "nothing stale survives the change that
// made it stale". Run it for every name a change renames, moves, removes or redefines, then fix
// each hit (or add a "Superseded:" line to a dated record).
//
//   npm run find-name -- <name> [<name>…]
//
// Why not a bare `rg <name>`: it reads the name as a regex (`Ctrl+Alt+X`, `$1`, `[c9watch]` match
// the wrong lines), takes a leading `--` as a flag (`--motion-exit`), skips the hidden `.claude/`,
// and skips the gitignored records — including the nested `_bmad-output/_bmad-output/` that a
// named folder does not un-ignore, and `docs/reports/`, which ignores itself. Records are
// untracked, so each worktree holds its own.
//
// What is searched, one exact string per line (no regex):
// - TREE: the current checkout's files git sees (`git ls-files --cached --others
//   --exclude-standard`) — code, tests, `.claude/`, every living doc.
// - RECORDS: `docs/superpowers`, `docs/reports` and `_bmad-output` in EVERY worktree
//   (`git worktree list`), ignore rules disregarded.
// A file path (a `/` and a basename with an extension) is also searched by its basename, which
// catches relative paths in comments (`../profile.ts`); a folder or a chord is not. A name of two
// or more words also matches when a hard wrap splits it across lines, comment leader included
// (`// + New` / `// session`), or a hand-wrapped string join (`'Manage ' +` / `'dialog'`) or a
// JSX `{' '}` break does. `.superpowers/` is
// scratch and never searched, ignored or not. A file it cannot read, or a worktree missing on disk, is reported
// on stderr (`code=find_name_*`), never skipped quietly. Exit 1 when nothing was found.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const RECORD_DIRS = ['docs/superpowers', 'docs/reports', '_bmad-output']
// Scratch, skipped by name: only a clone's local `.git/info/exclude` may ignore it.
const SCRATCH = '.superpowers/'

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' })

function worktrees(root) {
  return git(root, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length))
}

const warn = (msg) => process.stderr.write(`[claude-watcher][find-name] ${msg}\n`)

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

// Between two words of a name: spaces; a line break plus an optional comment leader; a
// hand-wrapped string join (`'… Manage ' +` / `'dialog …'`, a space on at least one side of it,
// else the words are glued in the real string); or a JSX `{' '}` line break.
const Q = '[\'"`]'
const JOIN = String.raw`${Q}[ \t]*\+[ \t]*\r?\n[ \t]*${Q}`
const GAP = [
  String.raw`[ \t]+`,
  String.raw`[ \t]*\r?\n[ \t]*(?:\/\/+|\*|#+|>)?[ \t]*`,
  String.raw`[ \t]+${JOIN}[ \t]*`,
  String.raw`${JOIN}[ \t]+`,
  String.raw`[ \t]*\{${Q} ${Q}\}[ \t]*\r?\n[ \t]*`
]
  .map((alt) => `(?:${alt})`)
  .join('|')
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** The wrap-tolerant pattern for a name of two or more words; null for one word. */
export function wrapRegex(needle) {
  const words = needle.trim().split(/\s+/)
  return words.length < 2 ? null : new RegExp(words.map(escapeRegex).join(`(?:${GAP})`), 'g')
}

/** The offset where each line starts. */
function lineStarts(text) {
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

/** The 1-based line holding `offset`: binary search, so many hits in a big file stay linear-ish. */
function lineOf(starts, offset) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

function grepFile(file, needles) {
  let buf
  try {
    buf = readFileSync(file)
  } catch (err) {
    warn(`code=find_name_unreadable file=${file} errno=${err?.code ?? 'unknown'}`)
    return []
  }
  if (buf.subarray(0, 8000).includes(0)) return [] // binary
  const text = buf.toString('utf8')
  const lines = text.split('\n')
  const found = new Set()
  lines.forEach((line, i) => {
    if (needles.some((n) => line.includes(n))) found.add(i + 1)
  })
  const starts = lineStarts(text)
  for (const n of needles) {
    const re = wrapRegex(n)
    if (re === null) continue
    for (const m of text.matchAll(re)) found.add(lineOf(starts, m.index))
  }
  return [...found]
    .sort((a, b) => a - b)
    .map((line) => ({ line, text: (lines[line - 1] ?? '').trim() }))
}

// A basename with a file extension (`profile.ts`, `THEMES.md`). A folder
// (`src/renderer/src/glass/`, `src/main/c9watch`) or a chord (`Ctrl+/`) gets no basename needle:
// it would flood the output.
const FILE_BASENAME = /^[\w.-]+\.[A-Za-z0-9]+$/

/** Every needle searched for one name: the name, and its basename when it is a file path. */
export function needlesFor(name) {
  if (!name.includes('/') || name.endsWith('/')) return [name]
  const base = path.basename(name)
  return FILE_BASENAME.test(base) && base !== name ? [name, base] : [name]
}

/** All hits for `name` from the checkout at `root`: `{ kind, worktree, file, line, text }`. */
export function findName(root, name) {
  const needles = needlesFor(name)
  const hits = []
  const tracked = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter((f) => f !== '' && !f.startsWith(SCRATCH))
  const trackedSet = new Set(tracked)
  for (const rel of tracked) {
    const full = path.join(root, rel)
    if (!existsSync(full) || !lstatSync(full).isFile()) continue
    for (const h of grepFile(full, needles))
      hits.push({ kind: 'tree', worktree: '', file: rel, ...h })
  }
  const all = worktrees(root)
  const label = (wt) => {
    const base = path.basename(wt)
    return all.filter((w) => path.basename(w) === base).length > 1 ? wt : base
  }
  for (const wt of all) {
    if (!existsSync(wt)) {
      warn(`code=find_name_worktree_missing path=${wt} (git worktree prune?)`)
      continue
    }
    for (const dir of RECORD_DIRS) {
      const abs = path.join(wt, dir)
      if (!existsSync(abs)) continue
      for (const full of walk(abs, [])) {
        const rel = path.relative(wt, full)
        // A tracked record is already in TREE when this is the current checkout.
        if (wt === root && trackedSet.has(rel)) continue
        for (const h of grepFile(full, needles))
          hits.push({ kind: 'record', worktree: label(wt), file: rel, ...h })
      }
    }
  }
  return hits
}

function main(argv) {
  if (argv.length === 0) {
    process.stderr.write('usage: npm run find-name -- <name> [<name>…]\n')
    process.exit(2)
  }
  // `| head` closes the pipe early: stop quietly instead of an EPIPE stack trace.
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') process.exit(0)
    throw err
  })
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim()
  let total = 0
  for (const name of argv) {
    const hits = findName(root, name)
    total += hits.length
    process.stdout.write(`== ${JSON.stringify(name)}: ${hits.length} line(s)\n`)
    for (const h of hits) {
      const where = h.kind === 'tree' ? h.file : `[${h.worktree}] ${h.file}`
      process.stdout.write(`${h.kind.padEnd(6)} ${where}:${h.line}: ${h.text.slice(0, 160)}\n`)
    }
  }
  process.exitCode = total === 0 ? 1 : 0
}

// A leading `--` is the usual end-of-options marker (`node findName.mjs -- --motion-exit`).
const args = process.argv.slice(2)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main(args[0] === '--' ? args.slice(1) : args)
