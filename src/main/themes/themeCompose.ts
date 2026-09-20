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
const URL_CALL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/g

export function rewriteCssUrls(
  css: string,
  reader: ThemeReader
): { ok: true; css: string } | { ok: false; code: ThemeErrorCode } {
  const inlined = new Map<string, string>()
  let total = 0
  let failure = null as ThemeErrorCode | null

  const out = css.replace(URL_CALL, (whole, _q: string, raw: string) => {
    if (failure !== null) return whole
    const name = raw.trim()
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
  })
  return failure === null ? { ok: true, css: out } : { ok: false, code: failure }
}

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
