// Custom themes — the PURE core of the loader. No fs, no Electron: `composeTheme` takes a
// validated manifest and an injected reader and returns ONE bundle or ONE code. It never
// throws (a throwing reader is `theme_read_failed`), so the shell around it can never crash
// main over a theme folder. A failure fails the WHOLE theme — no partial bundle.
import {
  THEME_ASSET_MIME,
  THEME_ASSETS_MAX_BYTES,
  THEME_CSS_MAX_BYTES,
  type ThemeBundle,
  type ThemeErrorCode,
  type ThemeManifest,
  type ThemeTokens
} from '../../shared/schemas/theme'

export interface ThemeReader {
  /** Bytes of `name` inside the theme folder, or null when it does not exist. May throw. */
  read(name: string): Uint8Array | null
}

export type ThemeLoadResult =
  | { ok: true; bundle: ThemeBundle }
  | { ok: false; code: ThemeErrorCode; path?: string }

/** An in-memory reader for tests and the docs examples. Strings are UTF-8. */
export function createMapReader(files: Record<string, Uint8Array | string>): ThemeReader {
  return {
    read(name) {
      const v = files[name]
      if (v === undefined) return null
      return typeof v === 'string' ? new TextEncoder().encode(v) : v
    }
  }
}

/** `:root { --k: v; }` from the manifest's tokens. Values were checked by the schema. */
export function renderTokensBlock(tokens: ThemeTokens): string {
  const lines = Object.entries(tokens)
    .filter((e): e is [string, string] => typeof e[1] === 'string')
    .map(([k, v]) => `  --${k}: ${v};`)
  return lines.length === 0 ? '' : `:root {\n${lines.join('\n')}\n}\n`
}

/** A plain file name with an allow-listed extension: `name.ext`, nothing else. */
const ASSET_NAME = /^([A-Za-z0-9_.-]+)\.([A-Za-z0-9]+)$/
// CSS function names are ASCII case-insensitive (`URL(...)`, `Url(...)` are valid CSS), so this
// carries the `i` flag. A quoted url() may legally contain `)` and the OPPOSITE quote character
// (`url("a).png")`, `url('a".png')`), which a single optional-quote backreference cannot express —
// so the double-quoted, single-quoted and unquoted forms are three separate alternatives, each
// captured on its own group.
const URL_CALL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi
/** Matches exactly the `url("data:...")` calls THIS function emits, so the residual scan below
 *  does not trip over its own successful substitutions. */
const OWN_DATA_URI_CALL = /url\("data:[^"]*"\)/g

export function rewriteCssUrls(
  css: string,
  reader: ThemeReader
): { ok: true; css: string } | { ok: false; code: ThemeErrorCode } {
  const inlined = new Map<string, string>()
  let total = 0
  let failure = null as ThemeErrorCode | null

  const out = css.replace(
    URL_CALL,
    (whole: string, dq: string | undefined, sq: string | undefined, uq: string | undefined) => {
      if (failure !== null) return whole
      const name = (dq ?? sq ?? uq ?? '').trim()
      const m = ASSET_NAME.exec(name)
      if (m === null || name.includes('..')) {
        failure = 'theme_css_url_invalid'
        return whole
      }
      const mime = THEME_ASSET_MIME[(m[2] ?? '').toLowerCase()]
      if (mime === undefined) {
        failure = 'theme_asset_type_invalid'
        return whole
      }
      let data = inlined.get(name)
      if (data === undefined) {
        let bytes: Uint8Array | null
        try {
          bytes = reader.read(name)
        } catch {
          failure = 'theme_read_failed'
          return whole
        }
        if (bytes === null) {
          failure = 'theme_asset_missing'
          return whole
        }
        total += bytes.byteLength
        if (total > THEME_ASSETS_MAX_BYTES) {
          failure = 'theme_asset_too_large'
          return whole
        }
        data = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
        inlined.set(name, data)
      }
      return `url("${data}")`
    }
  )
  if (failure !== null) return { ok: false, code: failure }

  // Fail closed on any `url(` form the pattern above could not fully consume — an unterminated
  // call, or any other shape nobody anticipated. Strip our OWN inlined data: URIs first, so the
  // check does not trip over the very substitutions it made.
  const residual = out.replace(OWN_DATA_URI_CALL, '')
  if (/url\(/i.test(residual)) return { ok: false, code: 'theme_css_url_invalid' }

  return { ok: true, css: out }
}

// A backstop, not more whack-a-mole: the CSS Syntax spec lets an ident sequence like `\75 rl`
// or `\000075rl` consume to `url` before a `(`, producing a url-token our literal-text matching
// above cannot see — and `@import "..."` / `image-set("..." )` are separate constructs that
// reach a network address without ever spelling `url(` at all. A theme CSS file containing a
// backslash, `@import`, or `image-set(` (the latter two case-insensitively — CSS keywords are
// ASCII case-insensitive) is refused wholesale under the same code, rather than chasing every
// individual escape form. Accepted cost: a theme using a legitimate CSS escape (e.g.
// `content: "\201C"`) is refused too.
const CSS_ESCAPE_OR_IMPORT = /\\|@import|image-set\(/i

export function composeTheme(
  id: string,
  manifest: ThemeManifest,
  reader: ThemeReader
): ThemeLoadResult {
  let css = renderTokensBlock(manifest.tokens)
  if (manifest.css !== undefined) {
    let bytes: Uint8Array | null
    try {
      bytes = reader.read(manifest.css)
    } catch {
      return { ok: false, code: 'theme_read_failed' }
    }
    if (bytes === null) return { ok: false, code: 'theme_css_missing' }
    if (bytes.byteLength > THEME_CSS_MAX_BYTES) return { ok: false, code: 'theme_css_too_large' }
    const rewritten = rewriteCssUrls(new TextDecoder().decode(bytes), reader)
    if (!rewritten.ok) return rewritten
    if (CSS_ESCAPE_OR_IMPORT.test(rewritten.css)) {
      return { ok: false, code: 'theme_css_url_invalid' }
    }
    css += rewritten.css
  }
  return {
    ok: true,
    bundle: {
      id,
      name: manifest.name,
      colorScheme: manifest.colorScheme,
      css,
      terminal: manifest.terminal
    }
  }
}
