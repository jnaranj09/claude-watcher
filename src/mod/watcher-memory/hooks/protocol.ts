// The memory mod's protocol with main (memory phase 3, addendum §1): where main listens and the
// header it wants, the body of each request and how to read each answer. PURE: no engine call, no
// import outside this folder (layer guard), so it is unit-tested under node. The mod has no zod,
// so it reads every answer by hand and treats anything it cannot read as "no memory text".
// `tests/main/modMemoryContract.test.ts` keeps this copy of main's paths, shapes and limits in
// step with main's real schemas (`src/shared/schemas/modMemory.ts`) and routes.
// A prompt's text and memory text are SENSITIVE: nothing here logs, throws or writes either.

/** The env var main sets on a session given this mod: the path of its `--mcp-config` file. */
export const CONFIG_ENV = 'CLAUDE_WATCHER_MEMORY_CONFIG'
/** The memory server's key in that file (main's MEMORY_MCP_SERVER_NAME). */
export const SERVER_NAME = 'claude-watcher-memory'
/** The memory server's path (main's MEMORY_MCP_PATH); the mod's routes share its listener. */
export const MCP_PATH = '/mcp/memory'
/** main's MOD_MEMORY_PATHS. */
export const MOD_PATHS = {
  index: '/mod/memory/index',
  recall: '/mod/memory/recall',
  atUse: '/mod/memory/at-use',
  remember: '/mod/memory/remember'
} as const
/** How long each call waits for main before it goes on without memory. */
export const WAIT_MS = { index: 500, recall: 250, atUse: 250, remember: 3000 } as const
/** After main did not answer well, the mod asks nothing for this long. */
export const PAUSE_MS = 30_000
/** main's MEMORY_LIMITS.recallPromptChars. */
export const PROMPT_CHARS = 2000
/** main's MEMORY_LIMITS.atUseFolders. */
export const FOLDERS_PER_CALL = 5
/** main's MEMORY_LIMITS.rememberChars. */
export const REMEMBER_CHARS = 8000
/** The tools whose result may get the keys saved for the folders they touch. */
export const FILE_TOOLS = ['Read', 'Edit', 'Write', 'NotebookEdit'] as const
/** The id of the one `session` section the mod adds (the memory index). */
export const SECTION_ID = 'watcher-memory:index'
export const REMEMBER_COMMAND = {
  name: 'remember',
  description: "Save a line to this app's memory. No model turn.",
  argumentHint: '<text> | <key> = <value>'
} as const

/** main's longest origin (its schema's max); a longer one is cut, so it is never an operator's. */
const ORIGIN_CHARS = 64
/** main's longest folder in an at-use body. */
const FOLDER_CHARS = 4096

export interface Link {
  base: string
  authorization: string
}

export type RememberAnswer =
  | { ok: true; kind: 'specific' | 'fact'; id: string }
  | { ok: false; code: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `text` parsed as JSON, or undefined when it is not JSON (the caller's answer is then "nothing";
 *  no log: the text may hold memory text). */
function json(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** `text`'s first `max` characters, never half of a surrogate pair (one shorter then). */
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const code = text.charCodeAt(max - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max)
}

/** The session's `--mcp-config` file → where to POST and the header; undefined for any other text. */
export function parseConfig(text: string): Link | undefined {
  const file = json(text)
  if (!isRecord(file) || !isRecord(file.mcpServers)) return undefined
  const server = file.mcpServers[SERVER_NAME]
  if (!isRecord(server) || !isRecord(server.headers)) return undefined
  const { url } = server
  const authorization = server.headers.Authorization
  if (typeof url !== 'string' || typeof authorization !== 'string' || authorization === '') {
    return undefined
  }
  if (!url.endsWith(MCP_PATH)) return undefined
  const base = url.slice(0, -MCP_PATH.length)
  if (!/^https?:\/\/[^/]+$/.test(base)) return undefined
  return { base, authorization }
}

/** main's largest window (its WindowSchema max). */
export const WINDOW_MAX = 1_000_000

/** The window after a `/clear` or a compaction of the main conversation. Past main's largest it
 *  starts again at 0: main resets a session's sets on any window that differs from the one it
 *  keeps (P3-C16), so 0 is a new window to it, and every body stays one main takes. */
export function nextWindow(window: number): number {
  return window >= WINDOW_MAX ? 0 : window + 1
}

export function indexBody(window: number): string {
  return JSON.stringify({ version: 1, window })
}

/** undefined when there is nothing to match (an empty or blank text). */
export function recallBody(window: number, origin: string, text: string): string | undefined {
  const sent = cut(text, PROMPT_CHARS)
  if (sent.trim() === '') return undefined
  return JSON.stringify({ version: 1, window, origin: cut(origin, ORIGIN_CHARS), text: sent })
}

export function atUseBody(window: number, folders: readonly string[]): string {
  return JSON.stringify({ version: 1, window, folders: folders.slice(0, FOLDERS_PER_CALL) })
}

/** Cuts `text` to its first 8,000 characters (main's MEMORY_LIMITS.rememberChars), so a longer
 *  line gets main's `remember_too_long` row, never a 400 (which would print the did-not-answer row
 *  and start a pause). */
export function rememberBody(origin: string, text: string): string {
  return JSON.stringify({
    version: 1,
    origin: cut(origin, ORIGIN_CHARS),
    text: cut(text, REMEMBER_CHARS)
  })
}

export function readIndexAnswer(text: string): { text: string; folders: string[] } | undefined {
  const answer = json(text)
  if (!isRecord(answer) || answer.ok !== true || typeof answer.text !== 'string') return undefined
  const { folders } = answer
  if (!Array.isArray(folders)) return undefined
  const named: string[] = []
  for (const folder of folders) {
    if (typeof folder !== 'string') return undefined
    named.push(folder)
  }
  return { text: answer.text, folders: named }
}

/** The block to add, or undefined (not ok, not JSON, or an empty text). */
export function readTextAnswer(text: string): string | undefined {
  const answer = json(text)
  if (!isRecord(answer) || answer.ok !== true) return undefined
  return typeof answer.text === 'string' && answer.text !== '' ? answer.text : undefined
}

export function readRememberAnswer(text: string): RememberAnswer | undefined {
  const answer = json(text)
  if (!isRecord(answer)) return undefined
  if (answer.ok === true) {
    const { kind, id } = answer
    if ((kind !== 'specific' && kind !== 'fact') || typeof id !== 'string' || id === '') {
      return undefined
    }
    return { ok: true, kind, id }
  }
  if (answer.ok === false && typeof answer.code === 'string' && answer.code !== '') {
    return { ok: false, code: answer.code }
  }
  return undefined
}

/** `folder` without its trailing `/`s (`/` itself becomes empty, which holds every path). */
function trimmed(folder: string): string {
  return folder.replace(/\/+$/, '')
}

/** Folders of `folders` that hold `path` (equal, or under it on a `/` boundary) and are not in
 *  `asked`, deepest first, at most FOLDERS_PER_CALL. A relative path matches nothing. */
export function foldersFor(
  path: string,
  folders: readonly string[],
  asked: ReadonlySet<string>
): string[] {
  if (!path.startsWith('/')) return []
  const file = trimmed(path)
  const holding = new Set<string>()
  for (const folder of folders) {
    if (!folder.startsWith('/') || folder.length > FOLDER_CHARS || asked.has(folder)) continue
    const root = trimmed(folder)
    if (file === root || file.startsWith(`${root}/`)) holding.add(folder)
  }
  return [...holding]
    .sort((a, b) => trimmed(b).length - trimmed(a).length)
    .slice(0, FOLDERS_PER_CALL)
}

/** The row for each refusal main can send; an unknown code reads as not available. */
const REFUSAL_ROWS: ReadonlyMap<string, string> = new Map([
  ['memory_not_available', 'Memory is not available.'],
  ['remember_empty', 'Nothing to save. Type /remember and the text.'],
  ['remember_too_long', 'Too long to save. A fact holds at most 2,000 characters.'],
  ['remember_invalid', 'That text cannot be saved: it holds a control character.'],
  ['remember_secret', 'That looks like a secret, so it was not saved.'],
  ['remember_not_operator', 'Only you can use /remember.'],
  ['store_write_failed', 'Memory could not be saved.']
])

/** The command's result row. `undefined` = main did not answer in time. */
export function rememberRow(answer: RememberAnswer | undefined): string {
  if (answer === undefined) return 'Memory did not answer. The line may not be saved.'
  if (answer.ok) return `Saved as a ${answer.kind}. id=${answer.id}`
  return REFUSAL_ROWS.get(answer.code) ?? 'Memory is not available.'
}
