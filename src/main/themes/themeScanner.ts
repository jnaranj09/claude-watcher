// Custom themes — the disk shell around composeTheme. Reads `<dir>/<id>/theme.json`, maps the
// ONE Zod boundary's issues to theme codes, and hands composeTheme a reader rooted in the
// theme folder. Logs `code=` (+ `path=`, a zod path) only — never a manifest value, never a
// folder name that failed the id pattern, never an errno message.
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
    const keys = 'keys' in issue && Array.isArray(issue.keys) ? issue.keys : []
    const mapped = codeForIssue(issue)
    const path =
      mapped.code === 'theme_unknown_token' && keys[0] !== undefined
        ? `${mapped.path}.${String(keys[0])}`
        : mapped.path
    return { ok: false, code: mapped.code, path }
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
        st = statSync(file)
      } catch {
        return null
      }
      if (!st.isFile()) return null
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
    mkdirSync(opts.dir, { recursive: true })
    const out: ThemeSummary[] = []
    for (const entry of readdirSync(opts.dir, { withFileTypes: true })) {
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
      const m = readManifest(join(opts.dir, id))
      if (m.ok) {
        out.push({
          id,
          name: m.manifest.name,
          ...(m.manifest.author !== undefined ? { author: m.manifest.author } : {}),
          colorScheme: m.manifest.colorScheme
        })
      } else {
        log(`${LOG_PREFIX} code=${m.code} id=${id}${m.path !== undefined ? ` path=${m.path}` : ''}`)
        out.push({
          id,
          name: id,
          colorScheme: 'dark',
          error: m.code,
          ...(m.path !== undefined ? { path: m.path } : {})
        })
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  return { dir: () => opts.dir, scan, load }
}
