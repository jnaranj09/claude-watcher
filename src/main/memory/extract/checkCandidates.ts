// The check of every candidate the model returns (addendum "Checking and writing candidates", D14–
// D17): the gate that keeps a model's invention out of the operator's memory. A candidate is kept
// only when its evidence is word for word in ONE cleaned entry that may prove a quote, and its basis
// is where that quote was found. Pure: no I/O, no log. Candidate and slice text are SENSITIVE; the
// caller logs the drop reasons as counts, never a text.
import {
  CUT_END,
  CUT_MIDDLE,
  EXTRACT_LIMITS,
  SECRET_MARK,
  type ExtractCandidate,
  type ExtractOutput
} from '../../../shared/schemas/memoryExtract'
import {
  EpisodeTextSchema,
  MemoryCreateSchema,
  MemoryTextSchema,
  type DropReason,
  type MemoryItem,
  type MemoryText
} from '../../../shared/schemas/memory'
import { TaskCheckSchema, TaskTitleSchema, type TaskLeftWith } from '../../../shared/schemas/goal'
import type { ScopeItem, ScopeTask } from './extractPrompt'
import { hasSecret } from './secretScan'
import type { CleanEntry } from './sliceCleaner'

export type Basis = MemoryItem['basis']
export type Found = { basis: Basis; entryId: string }

/** Every whitespace run → one space, trimmed; nothing else (not case, not Unicode form). */
export function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** D14: a result → observed, an operator entry → stated, a claude entry or a tool call → inferred. */
const BASIS_OF: Record<CleanEntry['kind'], Basis> = {
  result: 'observed',
  operator: 'stated',
  claude: 'inferred',
  tool: 'inferred'
}
const STRENGTH: Record<Basis, number> = { observed: 0, stated: 1, inferred: 2 }

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The cleaner's marks. A quote is matched between them, never inside or across one: a cut mark
 *  stands for text the model never saw (D6), a secret mark for text taken out. The middle mark
 *  comes first, since the end mark is a part of it. */
const MARKS = new RegExp([CUT_MIDDLE, CUT_END, SECRET_MARK].map(escapeRegExp).join('|'))

/** The strongest evidence entry where `at` finds something, then the earliest (D14). */
function strongest<T>(
  entries: readonly CleanEntry[],
  at: (segment: string) => T | null
): (Found & { hit: T }) | null {
  let best: (Found & { hit: T }) | null = null
  for (const entry of entries) {
    if (!entry.evidence) continue
    const basis = BASIS_OF[entry.kind]
    if (best !== null && STRENGTH[basis] >= STRENGTH[best.basis]) continue
    for (const segment of entry.text.split(MARKS)) {
      const hit = at(normalise(segment))
      if (hit !== null) {
        best = { basis, entryId: entry.entryId, hit }
        break
      }
    }
  }
  return best
}

const WORD_START = /^[\p{L}\p{N}_]/u
const WORD_END = /[\p{L}\p{N}_]$/u
/** A `.` or `-` joins the value's edge character (a letter, digit or `_`) to a letter or digit on
 *  the far side into one token (`1.2.34`, `2026-11-12`, `README.md`, `__init__.py`); R15. */
const JOIN_START = /^[.-][\p{L}\p{N}]/u
const JOIN_END = /[\p{L}\p{N}][.-]$/u

/** The text left of a cut and the text right of it are one token there: a word character (letter,
 *  digit or `_`) on both sides, or a word character on the value's side and `.` / `-` then a
 *  letter or digit on the other. */
const joins = (left: string, right: string): boolean =>
  (WORD_END.test(left) && (WORD_START.test(right) || JOIN_START.test(right))) ||
  (JOIN_END.test(left) && WORD_START.test(right))

/** Where `value` stands in `text` as a whole: it neither starts nor ends inside a token, so `928`
 *  is not found in `9281`, nor `1.2` in `1.2.34`, nor `README` in `README.md` (R15). -1 when
 *  absent. */
function valueAt(text: string, value: string): number {
  // Two characters on each side decide; 4 code units hold two even outside the BMP.
  const cutAt = (at: number): boolean =>
    joins(text.slice(Math.max(0, at - 4), at), text.slice(at, at + 4))
  for (let i = text.indexOf(value); i !== -1; i = text.indexOf(value, i + 1)) {
    if (!cutAt(i) && !cutAt(i + value.length)) return i
  }
  return -1
}

/** D14: the strongest entry that holds the quote (result → observed, operator → stated, claude or
 *  tool → inferred), then the earliest. Entries with `evidence: false` never match. The quote must
 *  stand whole in the entry (`valueAt`): a quote cut mid-word, such as `version 1.2.3` in
 *  `version 1.2.34`, is not found, so a value cut short with its quote is never kept. */
export function findEvidence(quote: string, entries: readonly CleanEntry[]): Found | null {
  const q = normalise(quote)
  if (q.length < EXTRACT_LIMITS.evidenceMin) return null
  const found = strongest(entries, (segment) => (valueAt(segment, q) === -1 ? null : true))
  return found === null ? null : { basis: found.basis, entryId: found.entryId }
}

const AROUND = 60

/** D26: where a saved value is in the slice, with up to 60 characters around it as the quote
 *  (≤ 500). null for a value under EXTRACT_LIMITS.evidenceMin characters or not found. */
export function findValue(
  value: string,
  entries: readonly CleanEntry[]
): (Found & { quote: string }) | null {
  const v = normalise(value)
  if (v.length < EXTRACT_LIMITS.evidenceMin || v.length > EXTRACT_LIMITS.evidenceMax) return null
  const room = Math.min(AROUND, Math.floor((EXTRACT_LIMITS.evidenceMax - v.length) / 2))
  const found = strongest(entries, (segment) => {
    const i = valueAt(segment, v)
    return i === -1 ? null : segment.slice(Math.max(0, i - room), i + v.length + room).trim()
  })
  return found === null ? null : { basis: found.basis, entryId: found.entryId, quote: found.hit }
}

export type Checked =
  | {
      kind: 'item'
      action: 'add' | 'update' | 'none'
      id: string | null
      text: MemoryText
      check: string | null
      basis: Basis
      source: { entryId: string; quote: string }
    }
  | {
      kind: 'task'
      action: 'add' | 'update'
      id: string | null
      title: string
      check: string | null
      leftWith: TaskLeftWith
      /** Where the quote was found (D14); only `observed` / `stated` moves an update's last-seen
       *  date (R48). */
      basis: Basis
    }
  | {
      kind: 'episode'
      title: string
      body: string
      source: { entryId: string; quote: string } | null
    }

type Ctx = {
  entries: readonly CleanEntry[]
  notes: readonly string[]
  final: boolean
  tasksOn: boolean
  items: readonly ScopeItem[]
  tasks: readonly ScopeTask[]
  /** D16: the newest version of this item was written by the operator. */
  operatorWrote: (id: string) => boolean
}

type Shaped =
  | { kind: 'item'; text: MemoryText; check: string | null }
  | { kind: 'task'; title: string; check: string | null; leftWith: TaskLeftWith }
  | { kind: 'episode'; title: string; body: string }

const ItemCheckSchema = MemoryCreateSchema.shape.check

/** A parsed value, or undefined when the schema refuses it. */
function parsed<T>(result: { success: true; data: T } | { success: false }): T | undefined {
  return result.success ? result.data : undefined
}

/** Step 1, one type: the text the item and task schemas accept (trimmed), or null. */
function shapeOf(c: ExtractCandidate): Shaped | null {
  if (c.type === 'task') {
    const title = parsed(TaskTitleSchema.safeParse(c.head))
    const check = c.check === null ? null : parsed(TaskCheckSchema.safeParse(c.check))
    if (c.body !== null || c.leftWith === null || title === undefined || check === undefined)
      return null
    return { kind: 'task', title, check, leftWith: c.leftWith }
  }
  const check = parsed(ItemCheckSchema.safeParse(c.check))
  if (c.leftWith !== null || c.body === null || check === undefined) return null
  if (c.type === 'episode') {
    const title = parsed(EpisodeTextSchema.shape.title.safeParse(c.head))
    const body = parsed(EpisodeTextSchema.shape.body.safeParse(c.body))
    return title === undefined || body === undefined ? null : { kind: 'episode', title, body }
  }
  const text = parsed(
    MemoryTextSchema.safeParse(
      c.type === 'specific'
        ? { kind: 'specific', key: c.head, value: c.body }
        : { kind: 'fact', title: c.head, body: c.body }
    )
  )
  return text === undefined ? null : { kind: 'item', text, check }
}

/** Step 1 (`invalid`): the shape by type, the evidence's length after normalising, an id for an
 *  `update` or `none`, and an episode only once and only at the end. */
function shape(c: ExtractCandidate, final: boolean, firstEpisode: boolean): Shaped | null {
  const evidence = normalise(c.evidence)
  if (evidence.length < EXTRACT_LIMITS.evidenceMin || evidence.length > EXTRACT_LIMITS.evidenceMax)
    return null
  if (c.action !== 'add' && c.id === null) return null
  if (c.type === 'episode' && (!final || !firstEpisode)) return null
  return shapeOf(c)
}

/** A head or title as D17 and R20 compare it: whitespace normalised, case folded. */
const headKey = (head: string): string => normalise(head).toLowerCase()
const headOf = (text: MemoryText): string => (text.kind === 'specific' ? text.key : text.title)
const bodyOf = (text: MemoryText): string => (text.kind === 'specific' ? text.value : text.body)

/** Step 5 for an item: an id out of scope (or of another kind) → add; D17; an update that changes
 *  nothing → none; a none whose value differs from the saved one → update (R11: a different value
 *  is not a sighting of the saved one); then D16. */
function reconcileItem(
  c: ExtractCandidate,
  text: MemoryText,
  ctx: Ctx
): { action: 'add' | 'update' | 'none'; id: string | null } | 'operator_item' {
  const sameBody = (item: ScopeItem): boolean => normalise(item.body) === normalise(bodyOf(text))
  const inScope = ctx.items.find((item) => item.id === c.id && item.kind === text.kind)
  let action = inScope === undefined ? 'add' : c.action
  let target = inScope
  if (action === 'add') {
    target = ctx.items.find(
      (item) => item.kind === text.kind && headKey(item.head) === headKey(headOf(text))
    )
    if (target !== undefined) action = sameBody(target) ? 'none' : 'update'
  } else if (action === 'none' && target !== undefined && !sameBody(target)) {
    action = 'update'
  } else if (
    action === 'update' &&
    target !== undefined &&
    target.head.trim() === headOf(text) &&
    sameBody(target)
  ) {
    action = 'none'
  }
  if (target === undefined) return { action: 'add', id: null }
  if (action === 'update' && ctx.operatorWrote(target.id)) return 'operator_item'
  return { action, id: target.id }
}

/** Step 5 for a task: `none` is `update`; an id out of scope → add; an add with an open task's
 *  title (whitespace normalised, case ignored) → update of it. */
function reconcileTask(
  c: ExtractCandidate,
  title: string,
  tasks: readonly ScopeTask[]
): { action: 'add' | 'update'; id: string | null } {
  const inScope = c.action !== 'add' && tasks.some((t) => t.id === c.id)
  if (inScope) return { action: 'update', id: c.id }
  const same = tasks.find((t) => headKey(t.title) === headKey(title))
  return same === undefined ? { action: 'add', id: null } : { action: 'update', id: same.id }
}

/** Steps 2 to 5 for one candidate whose shape passed. */
function checkOne(c: ExtractCandidate, s: Shaped, ctx: Ctx): Checked | DropReason {
  if (s.kind === 'task' && !ctx.tasksOn) return 'tasks_off'
  if ([c.head, c.body, c.check, c.evidence].some((v) => v !== null && hasSecret(v))) return 'secret'
  const quote = normalise(c.evidence)
  const found = findEvidence(quote, ctx.entries)
  const source = found === null ? null : { entryId: found.entryId, quote }
  if (s.kind === 'episode') {
    const inNote = ctx.notes.some((note) => valueAt(normalise(note), quote) !== -1)
    if (source === null && !inNote) return 'evidence_not_found'
    return { kind: 'episode', title: s.title, body: s.body, source }
  }
  if (found === null || source === null) return 'evidence_not_found'
  if (s.kind === 'task') {
    return {
      kind: 'task',
      ...reconcileTask(c, s.title, ctx.tasks),
      title: s.title,
      check: s.check,
      leftWith: s.leftWith,
      basis: found.basis
    }
  }
  if (s.text.kind === 'specific' && valueAt(quote, normalise(s.text.value)) === -1)
    return 'evidence_not_found'
  const reconciled = reconcileItem(c, s.text, ctx)
  if (reconciled === 'operator_item') return reconciled
  return { kind: 'item', ...reconciled, text: s.text, check: s.check, basis: found.basis, source }
}

/** R20: what a kept candidate writes to. An `add` writes a new item or task in the session's
 *  workspace (D18: every add of one answer has the same scope), so its kind and folded key or
 *  title name it; an `update` or `none` writes to a saved item or task, named by its id. null
 *  for the episode (step 1 keeps at most one). */
function twinKey(checked: Checked): string | null {
  if (checked.kind === 'episode') return null
  if (checked.kind === 'task')
    return checked.action === 'add' ? `task add ${headKey(checked.title)}` : `task ${checked.id}`
  return checked.action === 'add'
    ? `${checked.text.kind} add ${headKey(headOf(checked.text))}`
    : `item ${checked.id}`
}

/** The addendum's "Checking and writing candidates", steps 1 to 5, in that order; then R20: a
 *  later candidate that writes to the same thing as an earlier kept one is dropped (`invalid`),
 *  the first wins. */
export function checkCandidates(
  output: ExtractOutput,
  ctx: Ctx
): { kept: Checked[]; dropped: DropReason[] } {
  const kept: Checked[] = []
  const dropped: DropReason[] = []
  const written = new Set<string>()
  let episodes = 0
  for (const c of output.candidates) {
    const s = shape(c, ctx.final, c.type !== 'episode' || episodes === 0)
    if (c.type === 'episode') episodes += 1
    const result = s === null ? 'invalid' : checkOne(c, s, ctx)
    const key = typeof result === 'string' ? null : twinKey(result)
    if (typeof result === 'string') dropped.push(result)
    else if (key !== null && written.has(key)) dropped.push('invalid')
    else {
      if (key !== null) written.add(key)
      kept.push(result)
    }
  }
  return { kept, dropped }
}
