// Needs-you detail — one short line that says what a waiting tool wants to do.
//
// `hookStatus` calls this on `PreToolUse` with the event's `tool_input`; the reducer keeps the
// result beside the tool name and the card draws it under the name (`pendingToolDetail`). Only
// the tools below get a line: an unknown input shape (MCP tools included) has no safe one-line
// form, so it gets `null` and the card shows the name alone, as before.
//
// PROBE-GROUNDED (claude 2.1.303 through an `http` hook, 2026-10-19): the field names are the
// ones `PreToolUse` carries. Each schema is non-strict: claude adds keys freely
// (`description`, `run_in_background`, …) and an extra key must never cost the line.
//
// PURE apart from ONE value-free log: a KNOWN tool whose input fails its schema logs
// `code=tool_detail_shape` (it returns a `null` that also means "no detail", so it logs where it
// is caught — maintainability rule 6). The input is SENSITIVE (command lines, prompts): never
// log it, a field of it, the tool name or the result. [spec 2026-10-18-needs-you-detail 1.2;
// .claude/rules/zod-boundaries.md]

import { relative, sep } from 'node:path'
import { z } from 'zod'

/** The longest detail main sends. Bounds the wire; CSS cuts the drawn line with an ellipsis. */
export const TOOL_DETAIL_MAX = 200

const SHAPE_LOG = '[claude-watcher][hooks] path=(hook) code=tool_detail_shape'

/** A known tool's reader: the raw string, or `null` when the input has the wrong shape. */
type Reader = (input: unknown, projectPath: string | undefined) => string | null

/** A path inside the project reads relative to it (the project path is on the card one line
 *  above). Only the folder itself or a path under `<project>/` counts: `/w/app-old` is not
 *  inside `/w/app`. */
function displayPath(abs: string, projectPath: string | undefined): string {
  if (projectPath === undefined) return abs
  if (abs === projectPath) return '.'
  if (abs.startsWith(projectPath + sep)) return relative(projectPath, abs)
  return abs
}

function reader<S extends z.ZodType>(
  schema: S,
  pick: (value: z.infer<S>, projectPath: string | undefined) => string
): Reader {
  return (input, projectPath) => {
    const r = schema.safeParse(input)
    return r.success ? pick(r.data, projectPath) : null
  }
}

const filePath = reader(z.object({ file_path: z.string() }), (v, p) => displayPath(v.file_path, p))
const description = reader(z.object({ description: z.string() }), (v) => v.description)

const READERS: Record<string, Reader> = {
  Bash: reader(z.object({ command: z.string() }), (v) => v.command),
  Read: filePath,
  Write: filePath,
  Edit: filePath,
  NotebookEdit: reader(z.object({ notebook_path: z.string() }), (v, p) =>
    displayPath(v.notebook_path, p)
  ),
  WebFetch: reader(z.object({ url: z.string() }), (v) => v.url),
  WebSearch: reader(z.object({ query: z.string() }), (v) => v.query),
  AskUserQuestion: reader(
    z.object({ questions: z.array(z.object({ question: z.string() })).min(1) }),
    (v) => v.questions[0]?.question ?? ''
  ),
  Agent: description,
  Task: description
}

/**
 * The one-line detail for a tool call, or `null` when there is none: an unknown tool, an absent
 * input, an empty line, or a known tool whose input has the wrong shape (the only case that
 * logs). The first line only, trimmed, at most `TOOL_DETAIL_MAX` characters.
 */
export function toolDetail(
  toolName: string,
  toolInput: unknown,
  projectPath: string | undefined,
  log: (line: string) => void = console.warn
): string | null {
  const read = Object.hasOwn(READERS, toolName) ? READERS[toolName] : undefined
  if (read === undefined || toolInput === undefined) return null
  const raw = read(toolInput, projectPath)
  if (raw === null) {
    log(SHAPE_LOG)
    return null
  }
  // The first line, THEN the trim: a command whose first line is blank has no detail.
  const line = raw.split('\n')[0]?.trim() ?? ''
  return line === '' ? null : line.slice(0, TOOL_DETAIL_MAX)
}
