// Custom themes — every loader code mapped to operator copy (design.md: never render a raw
// code or an error.message). The helper line under the Theme picker lists broken themes by id.
import type { ThemeErrorCode, ThemeSummary } from '../../../shared/schemas/theme'

export const THEME_ERROR_COPY: Record<ThemeErrorCode, string> = {
  theme_not_found: 'folder not found',
  theme_id_invalid: 'folder name is not a valid id',
  theme_id_reserved: '"default" is reserved',
  theme_manifest_missing: 'missing theme.json',
  theme_manifest_invalid: 'theme.json is not valid',
  theme_manifest_too_large: 'theme.json is over 64 KB',
  theme_unknown_token: 'unknown token',
  theme_token_value_invalid: 'invalid value',
  theme_css_missing: 'missing theme.css',
  theme_css_too_large: 'CSS file is over 1 MB',
  theme_css_url_invalid: 'a disallowed url(), @import, image-set() or escape in the CSS',
  theme_asset_missing: 'an asset named in the CSS is missing',
  theme_asset_type_invalid: 'an asset has a file type that is not allowed',
  theme_asset_too_large: 'assets are over 5 MB in total',
  theme_read_failed: 'a file could not be read'
}

export function themeErrorCopy(summary: {
  error?: ThemeErrorCode | undefined
  path?: string | undefined
}): string {
  if (summary.error === undefined) return ''
  const base = THEME_ERROR_COPY[summary.error]
  const path = summary.path
  if (summary.error === 'theme_unknown_token' && path !== undefined) {
    const key = path.split('.').slice(1).join('.')
    return key.length > 0 ? `${base} "${key}"` : base
  }
  if (summary.error === 'theme_token_value_invalid' && path !== undefined)
    return `${base} for "${path}"`
  return base
}

export function brokenThemesLine(summaries: ThemeSummary[]): string | null {
  const broken = summaries.filter((s) => s.error !== undefined)
  if (broken.length === 0) return null
  return `Could not load: ${broken.map((s) => `${s.id} (${themeErrorCopy(s)})`).join(', ')}`
}
