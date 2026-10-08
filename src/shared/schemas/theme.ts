// Custom themes (spec 2026-09-20) — the theme package standard as ONE Zod boundary.
//
// OUR shape, so it is `.strict()` like settings (zod-boundaries.md): an unknown manifest key,
// an unknown token name or an unknown terminal key FAILS THE WHOLE THEME CLOSED. A typo must
// never be a silent no-op. A token value is a VALUE inside the generated `:root` block, never
// an injection point into it, so the characters that could close a declaration or open a
// `url()` are refused here, before anything reaches a stylesheet.
//
// NEVER-LOG-THE-VALUE: the manifest is author content. Callers log the issue PATH + CODE only.
import { z } from 'zod'
import type { ITheme } from '@xterm/xterm'
import { TOKENS, type TokenName } from '../theme/tokens'

export const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
export const DEFAULT_THEME_ID = 'default'
/** A folder id, or `default` (which matches the pattern too). */
export const ThemeIdSchema = z.string().regex(THEME_ID_PATTERN)

export const THEME_MANIFEST_VERSION = 1 as const
export const THEME_MANIFEST_MAX_BYTES = 64 * 1024
export const THEME_CSS_MAX_BYTES = 1024 * 1024
export const THEME_ASSETS_MAX_BYTES = 5 * 1024 * 1024
export const THEME_TOKEN_VALUE_MAX = 500
export const THEME_TERMINAL_VALUE_MAX = 100
/** A file NAME in the theme folder: no separators, no `..`, lower-case `.css`. */
export const THEME_CSS_FILE_PATTERN = /^[A-Za-z0-9_.-]+\.css$/
export const THEME_WALLPAPERS_MAX = 8
/** A plain file NAME with a wallpaper extension (png, jpg, jpeg, webp — a subset of
 *  THEME_ASSET_MIME: no svg, no fonts): no separators, lower- or upper-case ext. */
const THEME_WALLPAPER_FILE_PATTERN = /^[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$/i

/** Extension → MIME for the assets a theme's CSS may reference (inlined as data: URIs). */
export const THEME_ASSET_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf'
}

export const TOKEN_NAMES = Object.keys(TOKENS) as readonly TokenName[]

/** The xterm ITheme keys a theme may set. `satisfies` makes a typo a compile error. */
export const TERMINAL_THEME_KEYS = [
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'selectionForeground',
  'selectionInactiveBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
] as const satisfies readonly (keyof ITheme)[]
export type TerminalThemeKey = (typeof TERMINAL_THEME_KEYS)[number]

// CSS function names are ASCII case-insensitive (`URL(...)` is valid CSS), so this carries
// the `i` flag — an uppercase URL(...) must not slip past the value guard. A backslash is
// forbidden too: CSS lets an ident sequence like `\75 rl` consume to `url` before a `(`, so
// an escaped form would otherwise reach `--x: <value>;` untouched by the literal `url\(` check.
const FORBIDDEN_IN_VALUE = /url\(|[;{}\r\n\\]|\/\*/i
/** True when a string can sit as the VALUE of a `--x: <value>;` declaration. */
export function isSafeCssValue(value: string): boolean {
  return !FORBIDDEN_IN_VALUE.test(value)
}

export const THEME_ERROR_CODES = [
  'theme_not_found',
  'theme_id_invalid',
  'theme_id_reserved',
  'theme_manifest_missing',
  'theme_manifest_invalid',
  'theme_manifest_too_large',
  'theme_unknown_token',
  'theme_token_value_invalid',
  'theme_css_missing',
  'theme_css_too_large',
  'theme_css_url_invalid',
  'theme_asset_missing',
  'theme_asset_type_invalid',
  'theme_asset_too_large',
  'theme_read_failed'
] as const
export type ThemeErrorCode = (typeof THEME_ERROR_CODES)[number]
export const ThemeErrorCodeSchema = z.enum(THEME_ERROR_CODES)

export const ColorSchemeSchema = z.enum(['dark', 'light'])
export type ColorScheme = z.infer<typeof ColorSchemeSchema>

const tokenValue = z
  .string()
  .max(THEME_TOKEN_VALUE_MAX)
  .refine(isSafeCssValue, { error: 'theme_token_value_invalid' })
const terminalValue = z
  .string()
  .max(THEME_TERMINAL_VALUE_MAX)
  .refine(isSafeCssValue, { error: 'theme_token_value_invalid' })

/** `{ [k in K]: ZodOptional<ZodString> }` from a key list — keeps the inferred type keyed. */
function optionalStrings<K extends string>(
  keys: readonly K[],
  value: z.ZodString
): { [P in K]: z.ZodOptional<z.ZodString> } {
  const shape: Record<string, z.ZodOptional<z.ZodString>> = {}
  for (const key of keys) shape[key] = value.optional()
  return shape as { [P in K]: z.ZodOptional<z.ZodString> }
}

export const ThemeTokensSchema = z.object(optionalStrings(TOKEN_NAMES, tokenValue)).strict()
export type ThemeTokens = z.infer<typeof ThemeTokensSchema>

export const ThemeTerminalSchema = z
  .object({
    ...optionalStrings(TERMINAL_THEME_KEYS, terminalValue),
    allowTransparency: z.boolean().optional()
  })
  .strict()
export type ThemeTerminal = z.infer<typeof ThemeTerminalSchema>

// Theme wallpapers (spec 2026-09-24). `.strict()` like every entry of our shape; the id shares
// the theme-id pattern so it is safe in a log line and a Select option testid.
export const ThemeWallpaperSchema = z
  .object({
    id: ThemeIdSchema,
    name: z.string().trim().min(1).max(40),
    file: z
      .string()
      .regex(THEME_WALLPAPER_FILE_PATTERN)
      .refine((name) => !name.includes('..'), { error: 'no ..' })
  })
  .strict()
export type ThemeWallpaper = z.infer<typeof ThemeWallpaperSchema>

const ThemeWallpapersSchema = z
  .array(ThemeWallpaperSchema)
  .min(1)
  .max(THEME_WALLPAPERS_MAX)
  .refine((list) => new Set(list.map((w) => w.id)).size === list.length, {
    error: 'duplicate wallpaper id'
  })

/** The surfaces the WebGL glass layer draws (spec 2026-10-08). `data-glass` values are pinned
 *  to this list by `glassHooks.guard.test.ts`. */
export const GLASS_SURFACES = ['header', 'column', 'card', 'control', 'field'] as const
export type GlassSurface = (typeof GLASS_SURFACES)[number]

const glassColor = z.string().regex(/^#[0-9a-f]{6}$/i)
const glassRange = (min: number, max: number): z.ZodNumber => z.number().min(min).max(max)

/** One surface's material — the `lens-lit.glsl` uniforms, named for authors. Every field is
 *  required: schemas carry no defaults (technical-taste §6). */
export const GlassMaterialSchema = z
  .object({
    refract: glassRange(0, 40),
    edge: glassRange(1, 60),
    blur: glassRange(0, 40),
    chroma: glassRange(0, 1),
    tint: glassColor,
    tintAmount: glassRange(0, 1),
    rim: glassRange(0, 1),
    exposure: glassRange(1, 3),
    lift: glassRange(0, 0.3),
    glow: glassRange(0, 0.3)
  })
  .strict()
export type GlassMaterial = z.infer<typeof GlassMaterialSchema>

export const GlassSpecSchema = z
  .object({
    renderer: z.literal('webgl'),
    lightFollowsCursor: z.boolean(),
    surfaces: z
      .object({
        header: GlassMaterialSchema,
        column: GlassMaterialSchema.extend({ tintNeedsYou: glassColor.optional() }).strict(),
        card: GlassMaterialSchema,
        control: GlassMaterialSchema,
        field: GlassMaterialSchema
      })
      .strict()
  })
  .strict()
export type GlassSpec = z.infer<typeof GlassSpecSchema>

export const ThemeManifestSchema = z
  .object({
    /** For the author's editor; accepted and ignored. */
    $schema: z.string().max(500).optional(),
    version: z.literal(THEME_MANIFEST_VERSION),
    name: z.string().trim().min(1).max(80),
    author: z.string().max(80).optional(),
    colorScheme: ColorSchemeSchema.default('dark'),
    tokens: ThemeTokensSchema.default({}),
    terminal: ThemeTerminalSchema.default({}),
    css: z
      .string()
      .regex(THEME_CSS_FILE_PATTERN)
      .refine((name) => !name.includes('..'), { error: 'no ..' })
      .optional(),
    /** Predefined wallpapers; the first is the default. The app inlines the chosen one as
     *  `--theme-wallpaper` (spec 2026-09-24). */
    wallpapers: ThemeWallpapersSchema.optional(),
    /** WebGL board glass (spec 2026-10-08); absent → CSS only. */
    glass: GlassSpecSchema.optional()
  })
  .strict()
export type ThemeManifest = z.infer<typeof ThemeManifestSchema>

/** One row of `themes:list`. A broken theme is listed with `error` (+ the zod `path`). */
export const ThemeSummarySchema = z
  .object({
    id: ThemeIdSchema,
    name: z.string().min(1).max(80),
    author: z.string().max(80).optional(),
    colorScheme: ColorSchemeSchema,
    /** The theme's wallpapers for the Settings dropdown — never the file names. */
    wallpapers: z
      .array(z.object({ id: ThemeIdSchema, name: z.string().min(1).max(40) }).strict())
      .max(THEME_WALLPAPERS_MAX)
      .optional(),
    error: ThemeErrorCodeSchema.optional(),
    path: z.string().max(200).optional()
  })
  .strict()
export type ThemeSummary = z.infer<typeof ThemeSummarySchema>

/** What main pushes on `theme:applied` — validated AT SOURCE before the send. */
export const ThemeBundleSchema = z
  .object({
    id: ThemeIdSchema,
    name: z.string().min(1).max(80),
    colorScheme: ColorSchemeSchema,
    /** ONE string: the `:root` tokens block, then the theme's own CSS with assets inlined. */
    css: z.string(),
    terminal: ThemeTerminalSchema,
    /** The wallpaper actually applied; null for a theme without wallpapers and for Default. */
    wallpaperId: ThemeIdSchema.nullable(),
    /** The theme's WebGL glass; null for a theme without one and for Default. */
    glass: GlassSpecSchema.nullable()
  })
  .strict()
export type ThemeBundle = z.infer<typeof ThemeBundleSchema>

export type ThemeApplyResult =
  | { ok: true; id: string }
  | { ok: false; id: string; code: ThemeErrorCode }

/** The compiled-in look: no CSS on top of tokens.css, no terminal override, dark. */
export const DEFAULT_THEME_BUNDLE: ThemeBundle = {
  id: DEFAULT_THEME_ID,
  name: 'Default',
  colorScheme: 'dark',
  css: '',
  terminal: {},
  wallpaperId: null,
  glass: null
}
