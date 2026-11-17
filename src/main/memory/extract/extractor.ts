// Saving memory from sessions (memory phase 2, addendum "Save points and the job", D9, D20–D25,
// D33): the save points (the Nth `Stop`, an end, the next start's catch-up) and ONE queue for the
// whole app, so at most one model call runs at a time. A session has at most one job in the queue
// (an end merges into its queued checkpoint and wins); the queue refuses a checkpoint at
// EXTRACT_LIMITS.queue jobs, never an end. The job itself is `runJob.ts`.
//
// Ids: a job is keyed by the TRANSCRIPT id (the row's `sessionId`); the card's id is the row's
// `originSessionId`, which `rebind` moves with a `/clear`. The job reads its row again after every
// await, so what it writes next carries the card's id of that moment.
//
// Nothing here throws to its caller (a hook handler, a removal, the start): a throw is logged as a
// code. Session text is SENSITIVE: logs carry codes and reasons only.
import {
  NO_COUNTS,
  type MEMORY_EXTRACT_TRIGGERS,
  type MemoryExtractResult,
  type MemoryItem
} from '../../../shared/schemas/memory'
import { EXTRACT_LIMITS } from '../../../shared/schemas/memoryExtract'
import type { PastSessionMemory } from '../../../shared/schemas/pastSession'
import type { MemoryCheckpoint, MemoryModel } from '../../../shared/schemas/settings'
import type { GoalsStore } from '../../persistence/goals'
import type { MemoryActivityLog } from '../memoryActivity'
import type { MemoryCommands } from '../memoryCommands'
import type { MemoryStore } from '../memoryStore'
import type { MemorySessionMeta } from '../memoryTools'
import type { ExtractRow, ExtractState } from './extractState'
import type { ExtractCall } from './headlessClaude'
import { runJob, type Job, type JobRun } from './runJob'
import type { TranscriptSlice } from './transcriptReader'

export type ExtractTrigger = (typeof MEMORY_EXTRACT_TRIGGERS)[number]

export interface ExtractorDeps {
  /** settings.memoryEnabled, read live. */
  enabled: () => boolean
  /** 0 = never. */
  checkpoint: () => MemoryCheckpoint
  tasksOn: () => boolean
  model: () => MemoryModel
  /** null while the database is not open. */
  memory: () => { store: MemoryStore; commands: MemoryCommands; state: ExtractState } | null
  goals: () => Pick<
    GoalsStore,
    'view' | 'addTaskFromExtraction' | 'updateTaskFromExtraction'
  > | null
  /** The live card's stamp; null when no board holds the session. */
  sessionMeta: (sessionId: string) => MemorySessionMeta | null
  /** The transcript's path, found by id (D1); null when there is none. */
  locate: (sessionId: string) => string | null
  /** The transcript file's size in bytes; null when it cannot be read. */
  size: (path: string) => number | null
  read: (path: string, fromOffset: number, maxBytes: number) => Promise<TranscriptSlice | null>
  /** false only for a claude known to be older than MIN_EXTRACT_CLAUDE_VERSION. Blocking (a login
   *  shell `--version`): called at most once per job (R7). */
  versionOk: () => boolean
  call: (model: MemoryModel, input: string) => ExtractCall
  pastSessions: () => { setMemory(sessionId: string, memory: PastSessionMemory): void } | null
  activity: Pick<MemoryActivityLog, 'record'>
  /** true when the result reached a ready window or is held for one (ipc/extractResultPush.ts). */
  push: (result: MemoryExtractResult) => boolean
  now: () => number
  log: (line: string) => void
}

export interface Extractor {
  /** A `Stop` of a launched session: with Memory on, a finished turn (the next `ended` may save)
   *  and a count; at the Nth since its last save point, a checkpoint. */
  stop(sessionId: string): void
  /** A `StopFailure` of a launched session (an API error ended the turn with no `Stop`, ST-3):
   *  with Memory on, a finished turn, like `stop`, but it counts nothing toward a checkpoint. */
  stopFailed(sessionId: string): void
  /** A resume spawn (`resumeSessionId`) of `sessionId` into `workspaceId`: a session with no save
   *  row gets one at its transcript's current size (`ExtractState.seedAt`), so its history from
   *  before the resume is never read; a session with a row, no transcript or an empty one, or the
   *  database not open: nothing. Memory off seeds too: it records a position only. */
  resumed(sessionId: string, workspaceId: string): void
  /** The card left with reason `archive`, or `/clear` ended this id: an end. Called while the
   *  card still holds this id (before `rebind`), since it reads the card's stamp. An end needs a
   *  finished turn (`stop` or `stopFailed` with Memory on) since this spawn or this id's last end:
   *  with none it makes no job, no row and no record (`reason=no_activity`). An end with one
   *  already queued or running makes no second job (R34, `reason=nothing_new`). */
  ended(sessionId: string): void
  /** Card Delete, `Forget`, a dropped record: cancel its job, delete its rows. */
  forget(sessionId: string): void
  forgetWorkspace(workspaceId: string): void
  /** `/clear`: the card's id changed. Rows, queued jobs and a running job follow. Call it after
   *  `ended(oldId)`; called first, the old transcript's row is kept owed for the next start
   *  (`code=memory_extract_end_missing`), unless a job of the old id is queued or running. */
  rebind(oldId: string, newId: string): void
  /** Memory was switched off (R51): `cancel()` on the running call; the job then writes nothing
   *  of it, and every queued job stops at its own check. */
  memoryOff(): void
  /** App start: a catch-up for every pending row; with Memory off, each is closed as `off` (D24). */
  catchUp(): void
  /** The app is quitting: `killNow()` on the running call (R17: SIGKILL to its group at once,
   *  synchronously; never `cancel()`, whose SIGKILL timer dies with the app), start nothing more.
   *  `ended` after this (only after a turn) only marks the row `ending`. */
  quit(): void
  /** Resolves when nothing is queued or running. A test keeps this on purpose. */
  idle(): Promise<void>
}

const LOG_PREFIX = '[claude-watcher][memory]'

/** Which trigger wins when two save points of one session meet in the queue. */
const RANK: Record<ExtractTrigger, number> = { checkpoint: 0, catchup: 1, end: 2 }

/** `MemorySessionMeta`'s strings are '' when unset; an item's meta says null (as `memory_save`
 *  stamps it). */
function itemMeta(meta: MemorySessionMeta): MemoryItem['meta'] {
  return {
    folder: meta.folder === '' ? null : meta.folder,
    sessionName: meta.sessionName === '' ? null : meta.sessionName,
    tagIds: [...meta.tagIds],
    templateId: meta.templateId,
    goalId: meta.goalId,
    taskIds: [...meta.taskIds]
  }
}

function recordOf(state: PastSessionMemory['state'], row: ExtractRow | null): PastSessionMemory {
  return row === null
    ? { state, ...NO_COUNTS, episodeId: null }
    : { state, ...row.counts, episodeId: row.episodeId }
}

export function createExtractor(deps: ExtractorDeps): Extractor {
  const queue: Job[] = []
  let running: Job | null = null
  let quitting = false
  /** `Stop`s since the last save point, by card id. */
  const stops = new Map<string, number>()
  /** Card ids with a finished turn (`Stop` or `StopFailure`) while Memory was on, since this
   *  spawn or the id's last end. `rebind` does not move it: after `ended(old)` the new
   *  conversation has had no turn. */
  const turned = new Set<string>()
  const shared: JobRun['shared'] = { versionPushed: false, versionBadAt: null }
  let waiters: (() => void)[] = []

  const log = (code: string): void => deps.log(`${LOG_PREFIX} code=${code}`)

  /** A public method never throws to its caller. */
  function guarded(work: () => void): void {
    try {
      work()
    } catch {
      // Most likely the memory database refused a read or a write (R32); the error's text is
      // never read.
      log('memory_extract_failed reason=internal')
    }
  }

  /** A job of this transcript is queued or running. */
  function jobOf(id: string): Job | undefined {
    return running?.id === id ? running : queue.find((j) => j.id === id)
  }

  /** An end of this transcript is queued or running. */
  function endOwed(id: string): boolean {
    return jobOf(id)?.trigger === 'end'
  }

  function settleIdle(): void {
    if (running !== null || queue.length > 0) return
    const done = waiters
    waiters = []
    for (const resolve of done) resolve()
  }

  function pump(): void {
    if (running !== null) return
    const next = quitting ? undefined : queue.shift()
    if (next === undefined) {
      settleIdle()
      return
    }
    running = next
    void runJob({ deps, job: next, shared }).finally(() => {
      running = null
      pump()
    })
  }

  /** Queues a job, or merges into the session's queued one (the stronger trigger wins). A full
   *  queue refuses a checkpoint (`code=memory_extract_queue_full`), never an end or a catch-up: its
   *  row is already pending, so the next start catches it up anyway. */
  function enqueue(id: string, trigger: ExtractTrigger): void {
    const queued = queue.find((j) => j.id === id)
    if (queued !== undefined) {
      if (RANK[trigger] > RANK[queued.trigger]) queued.trigger = trigger
      return
    }
    if (trigger === 'checkpoint' && queue.length >= EXTRACT_LIMITS.queue) {
      log('memory_extract_queue_full')
      return
    }
    queue.push({ id, trigger, cancelled: false, call: null })
    pump()
  }

  /** Drops the queued jobs of these transcripts and cancels the running one (`cancel()`, the
   *  call's own SIGTERM then SIGKILL). */
  function cancelJobs(ids: ReadonlySet<string>): void {
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      const job = queue[i]
      if (job !== undefined && ids.has(job.id)) {
        job.cancelled = true
        queue.splice(i, 1)
      }
    }
    if (running !== null && ids.has(running.id)) {
      running.cancelled = true
      running.call?.cancel()
    }
    settleIdle()
  }

  /** Every save point first checks: Memory on, the database open, the session app-launched. */
  function tracked(id: string, phase: 'live' | 'ending'): ExtractRow | null {
    const mem = deps.memory()
    if (mem === null) return null
    const meta = deps.sessionMeta(id)
    if (meta === null) {
      if (phase === 'ending') log('memory_extract_skipped reason=not_launched')
      return null
    }
    return mem.state.track({
      sessionId: id,
      originSessionId: id,
      workspaceId: meta.workspaceId,
      meta: itemMeta(meta),
      phase,
      at: deps.now()
    })
  }

  return {
    stop: (sessionId) =>
      guarded(() => {
        if (!deps.enabled()) return
        turned.add(sessionId)
        if (tracked(sessionId, 'live') === null || quitting) return
        const every = deps.checkpoint()
        if (every === 0) return
        const count = (stops.get(sessionId) ?? 0) + 1
        if (count < every) {
          stops.set(sessionId, count)
          return
        }
        stops.delete(sessionId)
        enqueue(sessionId, 'checkpoint')
      }),

    stopFailed: (sessionId) =>
      guarded(() => {
        if (deps.enabled()) turned.add(sessionId)
      }),

    resumed: (sessionId, workspaceId) =>
      guarded(() => {
        const mem = deps.memory()
        if (mem === null || mem.state.get(sessionId) !== null) return
        const path = deps.locate(sessionId)
        if (path === null) return
        const size = deps.size(path)
        if (size === null || size === 0) return
        mem.state.seedAt({ sessionId, workspaceId, byteOffset: size, at: deps.now() })
      }),

    ended: (sessionId) =>
      guarded(() => {
        stops.delete(sessionId)
        if (!turned.delete(sessionId)) {
          // No finished turn since this spawn or the last end: opened, looked at, archived.
          // Nothing is written, so a row's offset and a record's state stay as they were.
          log('memory_extract_skipped reason=no_activity')
          return
        }
        if (!deps.enabled()) {
          // R2 / D37: off means no extraction, now or at a later start.
          log('memory_extract_skipped reason=off')
          const mem = deps.memory()
          deps
            .pastSessions()
            ?.setMemory(sessionId, recordOf('off', mem?.state.get(sessionId) ?? null))
          mem?.state.setPhase(sessionId, 'done', deps.now())
          return
        }
        // R34: an end already owed needs no second one (a queued one would merge anyway).
        if (endOwed(sessionId)) {
          log('memory_extract_skipped reason=nothing_new')
          return
        }
        const row = tracked(sessionId, 'ending')
        if (row === null) return
        // Before the job is queued: a job that ends at once (no transcript) sets its own record.
        deps.pastSessions()?.setMemory(sessionId, recordOf('saving', row))
        if (!quitting) enqueue(sessionId, 'end')
      }),

    forget: (sessionId) =>
      guarded(() => {
        stops.delete(sessionId)
        turned.delete(sessionId)
        const ids = new Set([sessionId])
        try {
          for (const id of deps.memory()?.state.remove(sessionId) ?? []) ids.add(id)
        } finally {
          cancelJobs(ids)
        }
      }),

    forgetWorkspace: (workspaceId) =>
      guarded(() => {
        const ids = new Set(deps.memory()?.state.removeByWorkspace(workspaceId) ?? [])
        for (const id of ids) {
          stops.delete(id)
          turned.delete(id)
        }
        cancelJobs(ids)
      }),

    rebind: (oldId, newId) =>
      guarded(() => {
        const count = stops.get(oldId)
        stops.delete(oldId)
        if (count !== undefined) stops.set(newId, count)
        const mem = deps.memory()
        if (mem === null) return
        mem.state.rebindOrigin(oldId, newId)
        // `ended(old)` must come first. When it did not, the old transcript's row is still `live`:
        // it is kept owed (`ending`, under the card's new id) for the next start's catch-up, and
        // the wrong order is logged, only when no job of the old id is queued or running (a
        // no-turn end of a resumed session leaves its queued catch-up to save the row).
        if (mem.state.get(oldId)?.phase === 'live' && jobOf(oldId) === undefined) {
          log('memory_extract_end_missing')
          mem.state.setPhase(oldId, 'ending', deps.now())
        }
      }),

    catchUp: () =>
      guarded(() => {
        const mem = deps.memory()
        if (mem === null || quitting) return
        for (const row of mem.state.pending()) {
          if (deps.enabled()) {
            enqueue(row.sessionId, 'catchup')
            continue
          }
          // D24: a save owed from the last run is dropped while Memory is off.
          log('memory_extract_skipped reason=off')
          deps.pastSessions()?.setMemory(row.sessionId, recordOf('off', row))
          mem.state.setPhase(row.sessionId, 'done', deps.now())
        }
      }),

    memoryOff: () => {
      running?.call?.cancel()
    },

    quit: () => {
      quitting = true
      for (const job of queue) job.cancelled = true
      queue.length = 0
      if (running !== null) {
        running.cancelled = true
        running.call?.killNow()
      }
      settleIdle()
    },

    idle: () =>
      running === null && queue.length === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.push(resolve)
          })
  }
}
