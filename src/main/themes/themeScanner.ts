// Custom themes — the disk shell around composeTheme. Reads `<dir>/<id>/theme.json`, maps the
// ONE Zod boundary's issues to theme codes, and hands composeTheme a reader rooted in the
// theme folder. Logs `code=` (+ `path=`, a zod path) only — never a manifest value, never a
// folder name that failed the id pattern, never an errno message.
import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_THEME_BUNDLE,
  DEFAULT_THEME_ID,
  THEME_ID_PATTERN,
  THEME_MANIFEST_MAX_BYTES,
  ThemeManifestSchema,
  type ThemeErrorCode,
  type ThemeManifest,
  type ThemeSummary
} from '../../shared/schemas/theme'
import { composeTheme, type ThemeLoadResult, type ThemeReader } from './themeCompose'

const LOG_PREFIX = '[claude-watcher][themes]'
const MANIFEST = 'theme.json'

export interface ThemeScanner {
  dir(): string
  /** `mkdir -p` the folder, then every subfolder whose id matches, sorted by name. Broken
   *  manifests are LISTED with their code so the author sees why (spec §2). */
  scan(): ThemeSummary[]
  load(id: string): ThemeLoadResult
}

export function codeForIssue(issue: { path: PropertyKey[]; code: string }): {
  code: ThemeErrorCode
  path: string
} {
  const path = issue.path.map(String).join('.')
  const head = issue.path[0]
  const valueIssue = issue.code === 'custom' || issue.code === 'too_big'
  if (head === 'tokens') {
    if (issue.code === 'unrecognized_keys') return { code: 'theme_unknown_token', path }
    if (valueIssue) return { code: 'theme_token_value_invalid', path }
  }
  if (head === 'terminal' && valueIssue) return { code: 'theme_token_value_invalid', path }
  return { code: 'theme_manifest_invalid', path }
}

export function readManifest(
  folder: string
): { ok: true; manifest: ThemeManifest } | { ok: false; code: ThemeErrorCode; path?: string } {
  let raw: string
  try {
    const file = join(folder, MANIFEST)
    let st
    try {
      st = statSync(file)
    } catch {
      return { ok: false, code: 'theme_manifest_missing' }
    }
    if (!st.isFile()) return { ok: false, code: 'theme_read_failed' }
    if (st.size > THEME_MANIFEST_MAX_BYTES) return { ok: false, code: 'theme_manifest_too_large' }
    raw = readFileSync(file, 'utf8')
  } catch {
    return { ok: false, code: 'theme_read_failed' }
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, code: 'theme_manifest_invalid' }
  }
  const r = ThemeManifestSchema.safeParse(json)
  if (!r.success) {
    const issue = r.error.issues[0]
    if (issue === undefined) return { ok: false, code: 'theme_manifest_invalid' }
    // `unrecognized_keys` carries the offending keys; name the first so the helper line can.
    // The manifest cap is 64 KB, so an author-typed key can itself be huge — truncate to 64
    // chars before it goes anywhere near a log line or `ThemeSummary.path` (which is capped
    // at 200 chars by its own schema; naming the misspelled token is still useful truncated).
    const keys = 'keys' in issue && Array.isArray(issue.keys) ? issue.keys : []
    const mapped = codeForIssue(issue)
    const firstKey = keys[0]
    const path =
      mapped.code === 'theme_unknown_token' && firstKey !== undefined
        ? `${mapped.path}.${String(firstKey).slice(0, 64)}`
        : mapped.path
    // A root-level issue (e.g. an unknown top-level key) has an empty zod path — omit it
    // rather than ship/log a bare trailing `path=`.
    return { ok: false, code: mapped.code, ...(path !== '' ? { path } : {}) }
  }
  return { ok: true, manifest: r.data }
}

function folderReader(folder: string): ThemeReader {
  return {
    read(name) {
      // `name` was checked against the file-name pattern by the caller (no separators).
      const file = join(folder, name)
      let st
      try {
        // lstat, NOT stat — lstat reports the path ITSELF, never resolving a symlink. A
        // shared theme package's asset must never be a link out of its own folder (e.g. an
        // author-crafted `bg.png -> ~/.ssh/id_rsa`, base64-inlined straight into the bundle).
        st = lstatSync(file)
      } catch {
        return null
      }
      if (st.isSymbolicLink() || !st.isFile()) return null
      return readFileSync(file)
    }
  }
}

export function createThemeScanner(opts: {
  dir: string
  log?: (message: string) => void
}): ThemeScanner {
  const log = opts.log ?? ((message: string): void => console.warn(message))

  function load(id: string): ThemeLoadResult {
    if (id === DEFAULT_THEME_ID) return { ok: true, bundle: DEFAULT_THEME_BUNDLE }
    if (!THEME_ID_PATTERN.test(id)) return { ok: false, code: 'theme_id_invalid' }
    const folder = join(opts.dir, id)
    try {
      if (!statSync(folder).isDirectory()) return { ok: false, code: 'theme_not_found' }
    } catch {
      return { ok: false, code: 'theme_not_found' }
    }
    const m = readManifest(folder)
    if (!m.ok) return m
    return composeTheme(id, m.manifest, folderReader(folder))
  }

  function scan(): ThemeSummary[] {
    let entries
    try {
      // Both calls can throw past this boundary — a regular FILE sitting at the themes path
      // (ENOTDIR/EEXIST), a read-only or permission-denied userData dir, or the dir removed
      // between the two calls. `scan()` must never throw (Global Constraints), so both are
      // inside the same try; on any failure it logs a code (never an errno message, which
      // quotes the absolute path) and reports no themes rather than crashing main.
      mkdirSync(opts.dir, { recursive: true })
      entries = readdirSync(opts.dir, { withFileTypes: true })
    } catch {
      log(`${LOG_PREFIX} code=theme_read_failed`)
      return []
    }
    const out: ThemeSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const id = entry.name
      if (id === DEFAULT_THEME_ID) {
        log(`${LOG_PREFIX} code=theme_id_reserved id=${id}`)
        continue
      }
      if (!THEME_ID_PATTERN.test(id)) {
        log(`${LOG_PREFIX} code=theme_id_invalid`)
        continue
      }
      const folder = join(opts.dir, id)
      const m = readManifest(folder)
      if (!m.ok) {
        log(`${LOG_PREFIX} code=${m.code} id=${id}${m.path !== undefined ? ` path=${m.path}` : ''}`)
        out.push({
          id,
          name: id,
          colorScheme: 'dark',
          error: m.code,
          ...(m.path !== undefined ? { path: m.path } : {})
        })
        continue
      }
      // Finding 1(a): the manifest alone is not the whole theme. Go through composeTheme the
      // same way `load()` does, so a theme broken only in its CSS/assets is caught HERE too and
      // never offered as loadable (Settings keys the picker + the broken-themes line off
      // `error === undefined`). Discard the composed bundle — scan() returns summaries, not
      // bundles. Settings is opened rarely, so the extra CSS/asset read per theme (bounded by
      // the existing 1 MB / 5 MB caps) is worth it over silently offering a broken theme.
      const composed = composeTheme(id, m.manifest, folderReader(folder))
      const base = {
        id,
        name: m.manifest.name,
        ...(m.manifest.author !== undefined ? { author: m.manifest.author } : {}),
        colorScheme: m.manifest.colorScheme
      }
      if (composed.ok) {
        out.push(base)
      } else {
        log(
          `${LOG_PREFIX} code=${composed.code} id=${id}${composed.path !== undefined ? ` path=${composed.path}` : ''}`
        )
        out.push({
          ...base,
          error: composed.code,
          ...(composed.path !== undefined ? { path: composed.path } : {})
        })
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  return { dir: () => opts.dir, scan, load }
}
