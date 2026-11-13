// Cleans a transcript slice for the extraction call, with no model (addendum "Cleaning a slice",
// D2–D5): only `user` and `assistant` lines that are not a sidechain, meta or compact summary; an
// operator prompt only when claude did not write it (D3); no thinking; results of web, MCP,
// subagent and other agents' tools kept without their text (D4, P3-R3); every text with its
// secrets taken out, then capped (D5); entries numbered on from the session's count.
//
// What memory itself told the session is never evidence (P3-R2): its blocks are their own
// `attachment` lines (left out above); in a typed prompt each text part is judged alone, every
// system-reminder span is cut and a text still holding `MEMORY_BLOCK_MARKER` is dropped whole;
// a result with a line that starts with the marker is not kept.
//
// The shared line schema leaves the keys read here `unknown` (D40, so the interrupt watcher never
// loses a line to them); this file narrows each where it reads it and skips a part or a line whose
// key has another type. SENSITIVE: the text is the operator's conversation. Nothing here logs.
import {
  CUT_END,
  CUT_MIDDLE,
  EXTRACT_LIMITS,
  RESULT_NOT_KEPT
} from '../../../shared/schemas/memoryExtract'
import type { TranscriptEntry } from '../../../shared/schemas/transcriptEntry'
import { INTERRUPT_MARKERS } from '../../hooks/transcriptSignal'
import { MEMORY_BLOCK_MARKER } from '../promptText'
import { redactSecrets } from './secretScan'
import type { ReadLine } from './transcriptReader'

export type CleanEntry = {
  n: number
  kind: 'operator' | 'claude' | 'tool' | 'result'
  tool: string | null
  status: 'ok' | 'error' | null
  text: string
  entryId: string
  /** The `end` of the transcript line it came from: where a job may stop reading after it. */
  lineEnd: number
  /** false for a result whose text was not kept (D4): it never proves a quote. */
  evidence: boolean
}

/** Tools whose results are never evidence (D4), with every `mcp__*` tool.
 *  A test keeps this export on purpose. */
export const NON_EVIDENCE_TOOLS: ReadonlySet<string> = new Set([
  'WebFetch',
  'WebSearch',
  'Agent',
  'Task',
  // claude's own MCP resource tools: their results are MCP results too (R12)
  'ReadMcpResourceTool',
  'ListMcpResourcesTool',
  'ReadMcpResourceDirTool',
  // they carry another agent's or a task's text (P3-R3, M8; names from claude 2.1.323's tool
  // table, their result shapes not probed, so they fail closed)
  'SendMessage',
  'GetTask',
  'FetchInboxMessage',
  'ReadNotifications',
  'Workflow'
])

/** A test keeps this export on purpose. */
export function isNonEvidenceTool(name: string): boolean {
  return NON_EVIDENCE_TOOLS.has(name) || name.startsWith('mcp__')
}

/** A line claude wrote itself starts with a lowercase tag (`<command-name>`, `<task-notification>`). */
const LEADING_TAG = /^<[a-z][a-z-]*>/

/** A `system-reminder` tag, opening or closing (a `/` among the spaces after `<`), in any case,
 *  with or without its `>`. Only spaces and `/` may stand around the name, so the tag never takes
 *  the text after it. Linear on any input: every try starts at a `<` and scans one run of spaces
 *  and `/` on each side of the name. */
const REMINDER_TAG = /<([\s/]*)system-reminder[\s/]*>?/gi

/** P3-R2: every `system-reminder` span cut out, nested ones whole; an opening tag that never
 *  closes cuts to the end, and a closing tag with no opening one is cut alone. */
function cutReminders(text: string): string {
  let kept = ''
  let depth = 0
  let from = 0
  for (const tag of text.matchAll(REMINDER_TAG)) {
    if (depth === 0) kept += text.slice(from, tag.index)
    depth = (tag[1] ?? '').includes('/') ? Math.max(0, depth - 1) : depth + 1
    from = tag.index + tag[0].length
  }
  return depth === 0 ? kept + text.slice(from) : kept
}

/** Text as the marker test reads it: no white space or format character, lower case, so a
 *  marker in another case or spacing is still the marker. */
const fold = (text: string): string => text.replace(/[\s\p{Cf}]+/gu, '').toLowerCase()
const FOLDED_MARKER = fold(MEMORY_BLOCK_MARKER)

/** P3-R2 rule 3: a text that holds memory's block marker anywhere. */
const holdsMarker = (text: string): boolean => fold(text).includes(FOLDED_MARKER)

/** Every line break claude may read as one (the set `promptText.ts` ends a line on). */
const LINE_BREAK = /\r\n|[\n\v\f\r\u0085\u2028\u2029]/

/** P3-R2 rule 4: a result with a line that starts with memory's block marker (after its leading
 *  space; a `system-reminder` tag starts a line too). A marker inside a line is not one. The
 *  folded lines are read as one text, so a marker broken over two lines still counts. */
function holdsMemoryBlock(text: string): boolean {
  let folded = ''
  const starts: number[] = []
  for (const line of text.replace(REMINDER_TAG, '\n').split(LINE_BREAK)) {
    starts.push(folded.length)
    folded += fold(line)
  }
  return starts.some((at) => folded.startsWith(FOLDED_MARKER, at))
}

type Part = Exclude<NonNullable<TranscriptEntry['message']>['content'], string | undefined>[number]

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v !== ''

function cutMiddle(text: string, max: number, head: number, tail: number): string {
  return text.length <= max
    ? text
    : text.slice(0, head) + CUT_MIDDLE + text.slice(text.length - tail)
}

/** Secrets first, then the cap: a cut never leaves part of a secret that no pattern matches. */
const cleanText = (text: string): string =>
  cutMiddle(
    redactSecrets(text),
    EXTRACT_LIMITS.textChars,
    EXTRACT_LIMITS.textHeadChars,
    EXTRACT_LIMITS.textTailChars
  )

const cleanResult = (text: string): string =>
  cutMiddle(
    redactSecrets(text),
    EXTRACT_LIMITS.resultChars,
    EXTRACT_LIMITS.resultHeadChars,
    EXTRACT_LIMITS.resultTailChars
  )

function cleanArgs(input: unknown): string {
  const args = redactSecrets(JSON.stringify(input ?? null))
  return args.length <= EXTRACT_LIMITS.toolArgsChars
    ? args
    : args.slice(0, EXTRACT_LIMITS.toolArgsChars) + CUT_END
}

/** D3: a `user` text is the operator's unless claude wrote it. */
function isOperatorText(entry: TranscriptEntry, text: string): boolean {
  const trimmed = text.trim()
  return (
    trimmed !== '' &&
    entry.promptSource !== 'system' &&
    !INTERRUPT_MARKERS.has(trimmed) &&
    !LEADING_TAG.test(trimmed)
  )
}

/** A tool result's text parts, or null when its `content` has another type. */
function resultText(content: unknown): string | null {
  if (content === undefined) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const texts: string[] = []
  for (const part of content) {
    if (
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string'
    ) {
      texts.push(part.text)
    }
  }
  return texts.join('\n')
}

type Draft = Omit<CleanEntry, 'n'>

function resultDraft(
  part: Part,
  calls: ReadonlyMap<string, string>,
  base: Pick<Draft, 'entryId' | 'lineEnd'>
): Draft | null {
  if (!nonEmptyString(part.tool_use_id)) return null
  if (part.is_error !== undefined && typeof part.is_error !== 'boolean') return null
  const tool = calls.get(part.tool_use_id)
  if (tool === undefined) return null // its call is not in this slice
  const text = resultText(part.content)
  if (text === null) return null
  const status = part.is_error === true ? 'error' : 'ok'
  return isNonEvidenceTool(tool) || holdsMemoryBlock(text)
    ? { ...base, kind: 'result', tool, status, text: RESULT_NOT_KEPT, evidence: false }
    : { ...base, kind: 'result', tool, status, text: cleanResult(text), evidence: true }
}

function userDrafts(
  entry: TranscriptEntry,
  calls: ReadonlyMap<string, string>,
  base: Pick<Draft, 'entryId' | 'lineEnd'>
): Draft[] {
  const content = entry.message?.content
  if (content === undefined) return []
  const parts = typeof content === 'string' ? [] : content
  const texts =
    typeof content === 'string'
      ? [content]
      : parts.filter((p) => p.type === 'text').map((p) => p.text ?? '')
  // P3-R2: each text part is judged alone (M7: a part claude tagged never joins a typed one), then
  // every system-reminder span is cut, and a text still holding memory's marker is not the operator's.
  const text = cutReminders(texts.filter((t) => !LEADING_TAG.test(t.trim())).join(''))
  const drafts: Draft[] = []
  if (isOperatorText(entry, text) && !holdsMarker(text)) {
    drafts.push({
      ...base,
      kind: 'operator',
      tool: null,
      status: null,
      text: cleanText(text),
      evidence: true
    })
  }
  for (const part of parts) {
    if (part.type !== 'tool_result') continue
    const draft = resultDraft(part, calls, base)
    if (draft !== null) drafts.push(draft)
  }
  return drafts
}

function assistantDrafts(
  entry: TranscriptEntry,
  calls: Map<string, string>,
  base: Pick<Draft, 'entryId' | 'lineEnd'>
): Draft[] {
  const content = entry.message?.content
  if (content === undefined) return []
  const said = (text: string): Draft[] =>
    text.trim() === ''
      ? []
      : [
          {
            ...base,
            kind: 'claude',
            tool: null,
            status: null,
            text: cleanText(text),
            evidence: true
          }
        ]
  if (typeof content === 'string') return said(content)
  const drafts: Draft[] = []
  for (const part of content) {
    if (part.type === 'text') drafts.push(...said(part.text ?? ''))
    else if (part.type === 'tool_use' && nonEmptyString(part.id) && nonEmptyString(part.name)) {
      calls.set(part.id, part.name)
      drafts.push({
        ...base,
        kind: 'tool',
        tool: part.name,
        status: null,
        text: cleanArgs(part.input),
        evidence: true
      })
    }
    // a `thinking` part, or any other, is dropped
  }
  return drafts
}

/** Addendum "Cleaning a slice": rules D2–D5, numbers from `startAt + 1`. `prompts` = operator entries. */
export function cleanSlice(
  lines: readonly ReadLine[],
  startAt: number
): { entries: CleanEntry[]; prompts: number } {
  const calls = new Map<string, string>()
  const entries: CleanEntry[] = []
  for (const { entry, end } of lines) {
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    if (entry.isSidechain === true || entry.isMeta === true || entry.isCompactSummary === true)
      continue
    if (!nonEmptyString(entry.uuid)) continue
    const base = { entryId: entry.uuid, lineEnd: end }
    const drafts =
      entry.type === 'user' ? userDrafts(entry, calls, base) : assistantDrafts(entry, calls, base)
    for (const draft of drafts) entries.push({ n: startAt + entries.length + 1, ...draft })
  }
  return { entries, prompts: entries.filter((e) => e.kind === 'operator').length }
}

/** `[#12 operator]\n<text>`, `[#14 tool Bash] <args>`, `[#15 result Bash ok]\n<text>`.
 *  A test keeps this export on purpose. */
export function renderEntry(entry: CleanEntry): string {
  // A line of text that starts with `[#` gets one space in front (R13), so transcript text never
  // reads as an entry header. Only the rendering changes: the quote check reads `entry.text`, and
  // its whitespace folding makes a quote copied from the rendered line match as well.
  const text = entry.text.replace(/^\[#/gm, ' [#')
  if (entry.kind === 'tool') return `[#${entry.n} tool ${entry.tool ?? ''}] ${text}`
  const header =
    entry.kind === 'result'
      ? `[#${entry.n} result ${entry.tool ?? ''} ${entry.status ?? 'ok'}]`
      : `[#${entry.n} ${entry.kind}]`
  return text === '' ? header : `${header}\n${text}`
}

/** The entries joined by one blank line. */
export function renderEntries(entries: readonly CleanEntry[]): string {
  return entries.map(renderEntry).join('\n\n')
}

/** Consecutive runs whose rendered length stays within `maxChars`. A run always holds one entry, and
 *  the entries of one transcript line (same `lineEnd`) are never split over two runs. */
export function chunkEntries(entries: readonly CleanEntry[], maxChars: number): CleanEntry[][] {
  const groups: CleanEntry[][] = []
  for (const entry of entries) {
    const last = groups.at(-1)
    if (last !== undefined && last[0]?.lineEnd === entry.lineEnd) last.push(entry)
    else groups.push([entry])
  }
  const chunks: CleanEntry[][] = []
  let run: CleanEntry[] = []
  let runChars = 0
  for (const group of groups) {
    const groupChars = renderEntries(group).length
    const joined = run.length === 0 ? groupChars : runChars + 2 + groupChars
    if (run.length > 0 && joined > maxChars) {
      chunks.push(run)
      run = [...group]
      runChars = groupChars
    } else {
      run.push(...group)
      runChars = joined
    }
  }
  if (run.length > 0) chunks.push(run)
  return chunks
}
