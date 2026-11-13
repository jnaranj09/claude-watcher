// One extraction job (addendum "Save points and the job"): find the transcript (D1), read it ONCE
// from the row's offset, clean it, check the substance guard (D22), split it into chunks, and for
// each chunk: the version gate (asked once per job, R7; a not-OK answer is kept 10 minutes, R31),
// the input, the call, the check and the write. After the last chunk of an end or a catch-up: the
// row is `done`, the Past sessions record says what the whole session saved (or `failed` when a
// chunk was given up, R30), and an end pushes its result.
//
// The check and the write run in ONE synchronous step, with no await between them (R19): no
// operator edit can land between them. Nothing throws out of `runJob`: one bad session never stops
// the extractor for the others. Transcript, candidate, note and memory text are SENSITIVE: logs
// carry codes, counts and reasons only.
import {
  NO_COUNTS,
  type DropReason,
  type MemoryCounts,
  type MemoryExtractResult
} from '../../../shared/schemas/memory'
import { EXTRACT_LIMITS, type ExtractOutput } from '../../../shared/schemas/memoryExtract'
import type { PastSessionMemory } from '../../../shared/schemas/pastSession'
import { scopeTasksForExtract } from '../memoryTasks'
import { applyChunk } from './applyChunk'
import { checkCandidates } from './checkCandidates'
import { captureCommands } from './commandCapture'
import { buildExtractInput, type ScopeItem, type ScopeTask } from './extractPrompt'
import type { ExtractRow } from './extractState'
import type { ExtractorDeps, ExtractTrigger } from './extractor'
import type { ExtractCall, ExtractCallFailure } from './headlessClaude'
import { chunkEntries, cleanSlice, type CleanEntry } from './sliceCleaner'

const LOG_PREFIX = '[claude-watcher][memory]'

/** One queued or running job, keyed by the TRANSCRIPT id (`row.sessionId`, which never changes;
 *  the card's id is the row's `originSessionId`, which follows `/clear`). */
export interface Job {
  id: string
  trigger: ExtractTrigger
  /** Set by `forget` / `forgetWorkspace` / `quit`: the job writes and pushes nothing more. */
  cancelled: boolean
  /** The call in flight, for `cancel()` / `killNow()`. */
  call: ExtractCall | null
}

export interface JobRun {
  deps: ExtractorDeps
  job: Job
  /** Per extractor: a `claude_version` failure is pushed once; a not-OK version answer is kept
   *  for EXTRACT_LIMITS.versionRecheckMs from `versionBadAt` (R31). */
  shared: { versionPushed: boolean; versionBadAt: number | null }
}

type Mem = NonNullable<ReturnType<ExtractorDeps['memory']>>
/** Every `memory_extract_failed reason=`: the call's own failures, a too-old claude, a write that
 *  failed (R21) and any other step that threw or a transcript that could not be read (R32). */
type FailReason = ExtractCallFailure | 'claude_version' | 'write' | 'internal'
type Plan = { entries: CleanEntry[]; final: boolean; commands: string[]; end: number }
type Scope = { items: ScopeItem[]; tasks: ScopeTask[]; tasksOn: boolean }
/** `stop`: the job ends here (a failure under the limit, a cancel, a forgotten session).
 *  `gaveUp`: the chunk was given up on its last failed call (D20). */
type Step = { saved: number; dropped: number; gaveUp: boolean } | 'stop'

const total = (c: MemoryCounts): number => c.specifics + c.facts + c.tasks + c.episodes

function log(r: JobRun, code: string): void {
  r.deps.log(`${LOG_PREFIX} code=${code}`)
}

/** The record is keyed by the TRANSCRIPT id: after a `/clear` the old id has none. */
function setRecord(r: JobRun, row: ExtractRow, state: PastSessionMemory['state']): void {
  r.deps
    .pastSessions()
    ?.setMemory(row.sessionId, { state, ...row.counts, episodeId: row.episodeId })
}

/** R24: a session with no name gets no push. A `claude_version` failure is pushed once: done when
 *  the push delivered it or holds it for the first ready window (R38), so a push nothing took is
 *  tried again by the next such failure. */
function push(
  r: JobRun,
  row: ExtractRow,
  outcome: MemoryExtractResult['outcome'],
  reason: 'claude_version' | null
): void {
  const name = row.meta.sessionName
  if (name === null || name === '') return
  const result = { sessionName: name, trigger: r.job.trigger, outcome, counts: row.counts, reason }
  if (reason !== 'claude_version') {
    r.deps.push(result)
    return
  }
  if (r.shared.versionPushed) return
  r.shared.versionPushed = r.deps.push(result)
}

/** The last chunk of an end or a catch-up was written: the row is done, the record says what the
 *  whole session saved (D33, D38), an end pushes it. */
function finishDone(r: JobRun, mem: Mem): void {
  mem.state.setPhase(r.job.id, 'done', r.deps.now())
  const row = mem.state.get(r.job.id)
  if (row === null) return
  const outcome = total(row.counts) === 0 ? 'nothing' : 'saved'
  setRecord(r, row, outcome)
  if (r.job.trigger === 'end') push(r, row, outcome, null)
}

/** The job failed: an end or a catch-up sets the record `failed`, every trigger pushes it. The
 *  row stays as it is (an end's `ending`), so the next start catches it up; `close` (a chunk or a
 *  session given up) sets it `done` first. */
function finishFailed(r: JobRun, mem: Mem, reason: 'claude_version' | null, close = false): void {
  if (close) mem.state.setPhase(r.job.id, 'done', r.deps.now())
  const row = mem.state.get(r.job.id)
  if (row === null) return
  if (r.job.trigger !== 'checkpoint') setRecord(r, row, 'failed')
  push(r, row, 'failed', reason)
}

/** R32: a step other than the write threw, or the transcript could not be read: a failed call
 *  with reason `internal`. It counts an attempt; at `attempts` an end or a catch-up gives the
 *  session up (row `done`), so it never repeats at every start. A checkpoint is counted and
 *  pushed but never closes the row: the session is still running, and its end must still read
 *  the text (its attempts may pass `attempts`; the next failed call then gives its chunk up). */
function failInternal(r: JobRun): void {
  const mem = r.deps.memory()
  if (mem === null || mem.state.get(r.job.id) === null) return
  const giveUp =
    mem.state.failed(r.job.id, r.deps.now()) >= EXTRACT_LIMITS.attempts &&
    r.job.trigger !== 'checkpoint'
  if (giveUp) log(r, 'memory_extract_gave_up')
  finishFailed(r, mem, null, giveUp)
}

/** R31: a too-old claude. Not an attempt, and the row stays owed (R30): once claude is updated,
 *  the next catch-up saves it. */
function failVersion(r: JobRun, mem: Mem): void {
  log(r, 'memory_extract_failed reason=claude_version')
  finishFailed(r, mem, 'claude_version')
}

/** R31: the version answer for this job. A not-OK answer is kept by the extractor for
 *  EXTRACT_LIMITS.versionRecheckMs; meanwhile no job asks again. */
function versionKnownBad(r: JobRun): boolean {
  const at = r.shared.versionBadAt
  return at !== null && r.deps.now() - at < EXTRACT_LIMITS.versionRecheckMs
}

function versionOk(r: JobRun): boolean {
  if (versionKnownBad(r)) return false
  const ok = r.deps.versionOk()
  r.shared.versionBadAt = ok ? null : r.deps.now()
  return ok
}

/** No transcript. A checkpoint waits for the end. An end or a catch-up closes the row; it fails
 *  only when a save read the file before (it went missing since). claude writes the transcript at
 *  the first prompt, so a row that never read anything is a session that never said anything: it
 *  ends quietly like the substance guard, with no `failed` record and no push (R49). */
function noTranscript(r: JobRun, mem: Mem, start: ExtractRow): void {
  log(r, 'memory_extract_no_transcript')
  if (r.job.trigger === 'checkpoint') return
  mem.state.setPhase(r.job.id, 'done', r.deps.now())
  const row = mem.state.get(r.job.id)
  if (row === null) return
  if (start.byteOffset === 0) {
    setRecord(r, row, 'nothing')
    return
  }
  setRecord(r, row, 'failed')
  push(r, row, 'failed', null)
}

/** Where a chunk leaves the row: after its last line, its last entry's number, its prompts. */
function nextOf(
  row: ExtractRow,
  plan: Plan
): { byteOffset: number; entryCount: number; prompts: number } {
  return {
    byteOffset: plan.end,
    entryCount: plan.entries.at(-1)?.n ?? row.entryCount,
    prompts: row.prompts + plan.entries.filter((e) => e.kind === 'operator').length
  }
}

/** A failed call, or a failed write (R21): under `attempts` failures in a row the job stops and
 *  the slice stays unread; at `attempts` the chunk is given up (D20) and the job goes on. */
function failedCall(r: JobRun, mem: Mem, row: ExtractRow, plan: Plan, reason: FailReason): Step {
  log(r, `memory_extract_failed reason=${reason}`)
  const at = r.deps.now()
  if (mem.state.failed(row.sessionId, at) < EXTRACT_LIMITS.attempts) {
    finishFailed(r, mem, null)
    return 'stop'
  }
  log(r, 'memory_extract_gave_up')
  mem.state.advance(row.sessionId, {
    ...nextOf(row, plan),
    note: null,
    added: NO_COUNTS,
    episodeId: null,
    at
  })
  return { saved: 0, dropped: 0, gaveUp: true }
}

/** Activity under the card's id, only while the card is on the board: an end's card is gone, and
 *  its record would never be forgotten. */
function recordActivity(
  r: JobRun,
  row: ExtractRow,
  saved: readonly { itemId: string; action: 'saved' | 'updated' }[],
  dropped: readonly DropReason[]
): void {
  const cardId = row.originSessionId
  if (r.deps.sessionMeta(cardId) === null) return
  const at = r.deps.now()
  for (const s of saved) {
    r.deps.activity.record(cardId, {
      at,
      action: s.action,
      tool: 'extract',
      itemId: s.itemId,
      reason: null
    })
  }
  for (const reason of dropped) {
    r.deps.activity.record(cardId, { at, action: 'dropped', tool: 'extract', itemId: null, reason })
  }
}

function logDrops(r: JobRun, dropped: readonly DropReason[]): void {
  const byReason = new Map<DropReason, number>()
  for (const reason of dropped) byReason.set(reason, (byReason.get(reason) ?? 0) + 1)
  for (const [reason, count] of byReason)
    log(r, `memory_candidates_dropped reason=${reason} count=${count}`)
}

/** The check (R23: the notes saved before this call, never its own note) and the write, in ONE
 *  synchronous step (R19). Drops come from the check only (R28); counts from the write (R11). */
function write(
  r: JobRun,
  mem: Mem,
  row: ExtractRow,
  ctx: { plan: Plan; scope: Scope; path: string; output: ExtractOutput }
): Step {
  const { plan, scope, output } = ctx
  let checked: ReturnType<typeof checkCandidates>
  let out: ReturnType<typeof applyChunk>
  try {
    checked = checkCandidates(output, {
      entries: plan.entries,
      notes: row.notes,
      final: plan.final,
      tasksOn: scope.tasksOn,
      items: scope.items,
      tasks: scope.tasks,
      operatorWrote: (id) => mem.store.currentWriter(id) === 'operator'
    })
    out = applyChunk(
      {
        store: mem.store,
        commands: mem.commands,
        state: mem.state,
        goals: r.deps.goals(),
        now: r.deps.now,
        log: r.deps.log
      },
      {
        row,
        transcriptPath: ctx.path,
        kept: checked.kept,
        note: output.note === '' ? null : output.note,
        commands: plan.commands,
        entries: plan.entries,
        next: nextOf(row, plan)
      }
    )
  } catch {
    // The batch rolled back, so the offsets did not move (R21); logged as `reason=write`.
    return failedCall(r, mem, row, plan, 'write')
  }
  logDrops(r, checked.dropped)
  recordActivity(r, row, out.saved, checked.dropped)
  return { saved: total(out.added), dropped: checked.dropped.length, gaveUp: false }
}

function scopeOf(r: JobRun, mem: Mem, row: ExtractRow): Scope {
  const goals = r.deps.goals()
  return {
    items: mem.store.scopeForExtract(
      row.workspaceId,
      row.meta.folder,
      row.originSessionId,
      EXTRACT_LIMITS.scopeItems
    ),
    tasks:
      goals === null
        ? []
        : scopeTasksForExtract(
            goals.view(),
            row.workspaceId,
            row.meta.folder,
            row.originSessionId,
            EXTRACT_LIMITS.scopeTasks
          ),
    tasksOn: r.deps.tasksOn()
  }
}

function cancelled(r: JobRun): 'stop' {
  log(r, 'memory_extract_cancelled')
  return 'stop'
}

/** Memory was switched off while the job ran (R51): nothing more is written. Like an end with
 *  Memory off (R2), an end or a catch-up closes its row (`done`) with the record `off`; a live
 *  session's row (a checkpoint) stays as it was. */
function stoppedByOff(r: JobRun): 'stop' {
  log(r, 'memory_extract_skipped reason=off')
  const mem = r.deps.memory()
  const row = mem?.state.get(r.job.id) ?? null
  if (mem === null || row === null || r.job.trigger === 'checkpoint') return 'stop'
  mem.state.setPhase(row.sessionId, 'done', r.deps.now())
  setRecord(r, row, 'off')
  return 'stop'
}

/** One chunk: the input, the call, then the check and the write. The row is read again after the
 *  call, so a `/clear` meanwhile (`rebind`) makes what is written carry the card's new id. */
async function runChunk(r: JobRun, plan: Plan, path: string): Promise<Step> {
  const { deps, job } = r
  const before = deps.memory()
  const row = before?.state.get(job.id) ?? null
  if (before === null || row === null) return 'stop'
  const scope = scopeOf(r, before, row)
  const input = buildExtractInput({
    final: plan.final,
    sessionName: row.meta.sessionName ?? '',
    folder: row.meta.folder,
    tasksOn: scope.tasksOn,
    notes: row.notes,
    items: scope.items,
    tasks: scope.tasks,
    entries: plan.entries
  })
  const call = deps.call(deps.model(), input)
  job.call = call
  const result = await call.result
  job.call = null
  if (job.cancelled) return cancelled(r)
  // R51: an answer that arrives after Memory went off (or the call it cancelled) writes nothing.
  if (!deps.enabled()) return stoppedByOff(r)
  if (!result.ok && result.reason === 'cancelled') return cancelled(r)
  const mem = deps.memory()
  const now = mem?.state.get(job.id) ?? null
  if (mem === null || now === null) return 'stop'
  if (!result.ok) {
    if (result.issue !== null) {
      const at = result.issue.path === '' ? 'root' : result.issue.path
      log(r, `memory_extract_invalid path=${at} issue=${result.issue.code}`)
    }
    return failedCall(r, mem, now, plan, result.reason)
  }
  return write(r, mem, now, { plan, scope, path, output: result.output })
}

/** The chunks of one read, each with the commands whose result line falls inside it. An end (or
 *  catch-up) with nothing new: one call with no entries for the episode, only while the session has
 *  notes and no episode yet. */
function plansOf(
  row: ExtractRow,
  lines: Parameters<typeof captureCommands>[0],
  entries: CleanEntry[],
  read: { nextOffset: number; final: boolean }
): Plan[] {
  const captured = captureCommands(lines)
  const chunks =
    entries.length > 0
      ? chunkEntries(entries, EXTRACT_LIMITS.chunkChars)
      : read.final && row.notes.length > 0 && row.episodeId === null
        ? [[]]
        : []
  let from = row.byteOffset
  return chunks.map((chunk, i) => {
    const last = i === chunks.length - 1
    const end = last ? read.nextOffset : (chunk.at(-1)?.lineEnd ?? read.nextOffset)
    const commands = captured.filter((c) => c.lineEnd > from && c.lineEnd <= end).map((c) => c.text)
    from = end
    return { entries: chunk, final: read.final && last, commands, end }
  })
}

async function run(r: JobRun): Promise<void> {
  const { deps, job } = r
  const mem = deps.memory()
  const start = mem?.state.get(job.id) ?? null
  if (mem === null || start === null) return
  log(r, `memory_extract_started trigger=${job.trigger}`)
  if (versionKnownBad(r)) {
    failVersion(r, mem)
    return
  }
  const path = deps.locate(start.sessionId)
  if (path === null) {
    noTranscript(r, mem, start)
    return
  }
  const slice = await deps.read(path, start.byteOffset, EXTRACT_LIMITS.readBytesPerJob)
  if (job.cancelled) {
    cancelled(r)
    return
  }
  const live = deps.memory()
  const row = live?.state.get(job.id) ?? null
  if (live === null || row === null) return
  if (slice === null) {
    // The file is there but could not be read (or is shorter than the offset): an attempt, so a
    // passing fs error costs one try and a file that stays unreadable is given up at 3 (R32).
    log(r, 'memory_extract_failed reason=internal')
    failInternal(r)
    return
  }
  const { entries, prompts } = cleanSlice(slice.lines, row.entryCount)
  const ending = job.trigger !== 'checkpoint'
  if (entries.length === 0 && slice.nextOffset !== row.byteOffset) {
    // Lines with no conversation entry: only the offset moves.
    live.state.advance(row.sessionId, {
      byteOffset: slice.nextOffset,
      entryCount: row.entryCount,
      prompts: row.prompts,
      note: null,
      added: NO_COUNTS,
      episodeId: null,
      at: deps.now()
    })
  }
  if (!slice.more && row.prompts + prompts < EXTRACT_LIMITS.minPrompts) {
    log(r, 'memory_extract_skipped reason=guard')
    if (ending) {
      live.state.setPhase(row.sessionId, 'done', deps.now())
      setRecord(r, row, 'nothing')
    }
    return
  }
  const final = ending && !slice.more
  const plans = plansOf(row, slice.lines, entries, { nextOffset: slice.nextOffset, final })
  let calls = 0
  let asked: boolean | null = null
  const sum = { saved: 0, dropped: 0, gaveUp: false }
  for (const plan of plans) {
    if (!deps.enabled()) {
      stoppedByOff(r)
      return
    }
    if (calls >= EXTRACT_LIMITS.chunksPerJob) break
    asked ??= versionOk(r)
    if (!asked) {
      failVersion(r, live)
      return
    }
    calls += 1
    const step = await runChunk(r, plan, path)
    if (step === 'stop') return
    sum.saved += step.saved
    sum.dropped += step.dropped
    sum.gaveUp ||= step.gaveUp
  }
  // R22 and the 12-call stop: what was written stays and the row stays owed.
  const stopped = slice.more || calls < plans.length
  const done = deps.memory()
  if (done !== null && sum.gaveUp) {
    // R30: text was given up, so the save failed; never `nothing` / `saved`.
    finishFailed(r, done, null, ending && !stopped)
  } else if (done !== null && ending && !stopped) {
    finishDone(r, done)
  }
  log(r, `memory_extract_done trigger=${job.trigger} saved=${sum.saved} dropped=${sum.dropped}`)
}

/** Runs one job to its end. Never throws, never rejects: a throw from any step other than the
 *  write (the database, a seam) is a failed call with reason `internal` (R32), and the extractor
 *  goes on with the next job. */
export async function runJob(r: JobRun): Promise<void> {
  try {
    await run(r)
  } catch {
    // The error's text is never read: it may quote the store's or a seam's input.
    log(r, 'memory_extract_failed reason=internal')
    try {
      failInternal(r)
    } catch {
      // Counting the failure threw too (the database is gone): the row is left as it was.
      log(r, 'memory_extract_failed reason=internal')
    }
  }
}
