// What memory gives a running session through the `watcher-memory` mod (phase 3 addendum §5,
// §6): the memory section once per conversation window, recall per operator prompt, recall at use
// (the keys saved for the folders a tool touches) and the `/remember` save. Per session, main
// keeps what this window was already told (the index's ids and the ids given since), so nothing is
// given twice in a window, and how many characters the window got, so recall stops at its budget.
// Every block starts with MEMORY_BLOCK_MARKER, so the slice cleaner never takes it as evidence;
// every saved text in it goes through `oneLine` (P3-C1). Memory text and prompt text are
// sensitive: this module logs `code=` only, and the activity log gets ids and counts.
import type { GoalsView } from '../../shared/schemas/goal'
import { MEMORY_ERROR, MEMORY_LIMITS, type MemoryRow } from '../../shared/schemas/memory'
import type {
  ModMemoryAtUse,
  ModMemoryIndex,
  ModMemoryIndexAnswer,
  ModMemoryRecall,
  ModMemoryRemember,
  ModMemoryRememberAnswer,
  ModMemoryTextAnswer
} from '../../shared/schemas/modMemory'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import type { MemoryActivityLog } from './memoryActivity'
import { sessionItemMeta, type MemoryCall } from './memoryGate'
import { MEMORY_LIVE_RULES, MEMORY_RULES_OF_USE, pinnedLine, specificLine } from './memoryIndex'
import type { MemoryGrant } from './memoryTools'
import { MEMORY_BLOCK_MARKER, oneLine } from './promptText'
import { recallTerms } from './recallTerms'
import { buildSessionIndex } from './sessionIndex'
import { capped, parseRemember } from './rememberText'

export interface MemoryRecall {
  /** A spawn that hands the session the mod: the tasks its goal block lists, left out of its
   *  index, and whether it resumes a conversation (`claude --resume`). */
  launched(sessionId: string, facts: { excludeTaskIds: readonly string[]; resume: boolean }): void
  index(grant: MemoryGrant, req: ModMemoryIndex): ModMemoryIndexAnswer
  recall(grant: MemoryGrant, req: ModMemoryRecall): ModMemoryTextAnswer
  atUse(grant: MemoryGrant, req: ModMemoryAtUse): ModMemoryTextAnswer
  remember(grant: MemoryGrant, req: ModMemoryRemember): ModMemoryRememberAnswer
  rebind(oldSessionId: string, newSessionId: string): void
  forget(sessionId: string): void
}

/** What one conversation window of a session was already told. */
interface WindowState {
  window: number
  /** The ids the window's memory section listed. */
  indexed: Set<string>
  /** The ids given since by recall and at use; at most `MEMORY_LIMITS.windowItems`, oldest
   *  dropped. */
  delivered: Set<string>
  /** Characters of recall and at-use blocks the window got. */
  chars: number
}

const LOG_PREFIX = '[claude-watcher][memory]'
const RECALL_HEADER = `${MEMORY_BLOCK_MARKER} items that may match this prompt`
const NOT_OK = { ok: false } as const
const NOT_AVAILABLE = { ok: false, code: 'memory_not_available' } as const
const NOTHING: ModMemoryTextAnswer = { ok: true, text: '' }
/** The window a resumed spawn's mod process starts in (it counts from 0). */
const RESUMED_WINDOW = 0

const moreLine = (n: number): string => `${n} more; use memory_search`

/** `line` cut to `max` characters with `… id=<id>` kept at the end; never half of a surrogate
 *  pair (one character shorter then). */
function capLine(line: string, id: string, max: number): string {
  if (line.length <= max) return line
  const suffix = ` id=${id}`
  return capped(line, max - suffix.length) + suffix
}

export function createMemoryRecall(deps: {
  gate: (grant: MemoryGrant) => MemoryCall | null
  tasks: () => Pick<GoalsView, 'goals' | 'tasks'> | null
  activity: Pick<MemoryActivityLog, 'injected' | 'record'>
  /** The reducer's OPERATOR_ORIGINS. */
  operatorOrigins: ReadonlySet<string>
  now: () => number
  log: (line: string) => void
  /** Default MEMORY_LIMITS.recallWindowChars; a test passes a small one. */
  windowChars?: number
  /** Default MEMORY_LIMITS.recallChars; a test passes a small one (with today's limits three
   *  lines never reach it: a second line of defence, P3-C17). */
  recallChars?: number
}): MemoryRecall {
  const windowChars = deps.windowChars ?? MEMORY_LIMITS.recallWindowChars
  const recallChars = deps.recallChars ?? MEMORY_LIMITS.recallChars
  const windows = new Map<string, WindowState>()
  const launches = new Map<string, readonly string[]>()
  /** Sessions still in the window a resume came back into (P3-C28). claude keeps the system
   *  prompt recorded at the conversation's first request until it is compacted (probed on
   *  2.1.325), so the index main answers there never reaches the model: it is not recorded as
   *  given, and at use withholds nothing for it. The mod process of a resumed spawn counts
   *  windows from 0; the first request of another window, or a `/clear` (a new conversation),
   *  ends it. */
  const resumed = new Set<string>()

  /** Whether `sessionId` is still in the window its resume came back into; a request of any
   *  other window ends that for good. */
  function stillResumed(sessionId: string, window: number): boolean {
    if (!resumed.has(sessionId)) return false
    if (window === RESUMED_WINDOW) return true
    resumed.delete(sessionId)
    return false
  }

  /** The session's state for `window`: a different window starts empty, an older one too: meant
   *  (P3-C16), since a mod process that restarts counts from 0 again for the same session. */
  function stateFor(sessionId: string, window: number): WindowState {
    const kept = windows.get(sessionId)
    if (kept !== undefined && kept.window === window) return kept
    const fresh: WindowState = { window, indexed: new Set(), delivered: new Set(), chars: 0 }
    windows.set(sessionId, fresh)
    return fresh
  }

  function deliver(state: WindowState, sessionId: string, itemId: string, tool: string): void {
    state.delivered.add(itemId)
    if (state.delivered.size > MEMORY_LIMITS.windowItems) {
      const oldest = state.delivered.values().next().value
      if (oldest !== undefined) state.delivered.delete(oldest)
    }
    deps.activity.record(sessionId, {
      at: deps.now(),
      action: 'injected',
      tool,
      itemId,
      reason: null
    })
  }

  /** `work`'s answer, or `fail` on a throw: a failed read is the store's own (already logged),
   *  any other throw logs its code only. */
  function guarded<T>(fail: T, work: () => T): T {
    try {
      return work()
    } catch (err) {
      if (!(err instanceof Error && err.message === MEMORY_ERROR.readFailed)) {
        deps.log(`${LOG_PREFIX} code=mod_memory_failed`)
      }
      return fail
    }
  }

  function atUseText(
    state: WindowState,
    sessionId: string,
    folders: readonly string[],
    found: { rows: MemoryRow[]; more: number }
  ): string {
    const lines: string[] = []
    let length = -1
    let given = 0
    const fits = (add: number, after: number): boolean => {
      const reserve = after > 0 ? moreLine(found.more + found.rows.length).length + 1 : 0
      return length + add + reserve <= MEMORY_LIMITS.atUseChars
    }
    outer: for (const folder of folders) {
      const rows = found.rows.filter((row) => row.folder === folder)
      // No `wrapperSafe` on the composed line (P3-C18): the folder (through `oneLine`) ends the
      // line, the text before it ends in ` saved for `, and the next line starts with `- ` or a
      // digit, so the header's own characters cannot complete a reminder tag or the marker.
      let header: string | null = `${MEMORY_BLOCK_MARKER} saved for ${oneLine(folder)}`
      for (const row of rows) {
        const line = specificLine(row)
        // A header goes in only with its folder's first key.
        const add = line.length + 1 + (header === null ? 0 : header.length + 1)
        if (!fits(add, found.more + found.rows.length - given - 1)) break outer
        if (header !== null) lines.push(header)
        lines.push(line)
        header = null
        length += add
        given += 1
        deliver(state, sessionId, row.id, 'file')
      }
    }
    if (given === 0) return ''
    const left = found.more + found.rows.length - given
    if (left > 0) lines.push(moreLine(left))
    return lines.join('\n')
  }

  return {
    launched(sessionId, facts) {
      launches.set(sessionId, [...facts.excludeTaskIds])
      if (facts.resume) resumed.add(sessionId)
    },

    index(grant, req) {
      return guarded<ModMemoryIndexAnswer>(NOT_OK, () => {
        const call = deps.gate(grant)
        if (call === null) return NOT_OK
        const state = stateFor(call.sessionId, req.window)
        const { text, itemIds } = buildIndex(call)
        // A resumed conversation does not hold this index: nothing of it counts as given.
        const old = stillResumed(call.sessionId, req.window)
        const given = old ? [] : itemIds
        state.indexed = new Set(given)
        const folders = call.store.foldersWithSpecifics(
          call.scope,
          given,
          MEMORY_LIMITS.indexFolders
        )
        if (!old) deps.activity.injected(call.sessionId, { chars: text.length, itemIds })
        return { ok: true, text, folders }
      })
    },

    recall(grant, req) {
      return guarded<ModMemoryTextAnswer>(NOT_OK, () => {
        const call = deps.gate(grant)
        if (call === null) return NOT_OK
        const state = stateFor(call.sessionId, req.window)
        const terms = recallTerms(req.text)
        if (!deps.operatorOrigins.has(req.origin) || terms.length === 0) return NOTHING
        if (state.chars >= windowChars) return NOTHING
        const items = call.store.recall(
          call.scope,
          terms,
          [...state.delivered],
          MEMORY_LIMITS.recallRows
        )
        let text = RECALL_HEADER
        let given = 0
        for (const item of items) {
          const line = capLine(
            `${pinnedLine(item)} id=${item.id}`,
            item.id,
            MEMORY_LIMITS.recallLineChars
          )
          if (text.length + 1 + line.length > recallChars) break
          text += `\n${line}`
          given += 1
          deliver(state, call.sessionId, item.id, 'prompt')
        }
        if (given === 0) return NOTHING
        state.chars += text.length
        return { ok: true, text }
      })
    },

    atUse(grant, req) {
      return guarded<ModMemoryTextAnswer>(NOT_OK, () => {
        const call = deps.gate(grant)
        if (call === null) return NOT_OK
        const state = stateFor(call.sessionId, req.window)
        if (state.chars >= windowChars) return NOTHING
        // A folder asked twice is listed once, so no key goes out twice in a block.
        const folders = [...new Set(req.folders)]
        const found = call.store.specificsInFolders(
          call.scope,
          folders,
          [...state.indexed, ...state.delivered],
          MEMORY_LIMITS.atUseRows
        )
        const text = atUseText(state, call.sessionId, folders, found)
        state.chars += text.length
        return { ok: true, text }
      })
    },

    remember(grant, req) {
      return guarded<ModMemoryRememberAnswer>(NOT_AVAILABLE, () => {
        const call = deps.gate(grant)
        if (call === null) return NOT_AVAILABLE
        if (!deps.operatorOrigins.has(req.origin)) {
          return { ok: false, code: 'remember_not_operator' }
        }
        const parsed = parseRemember(req.text)
        if (!parsed.ok) return parsed
        let id: string
        try {
          id = call.store.add({
            text: parsed.text,
            workspaceId: call.session.workspaceId,
            check: null,
            basis: 'stated',
            origin: { by: 'operator', sessionId: call.sessionId },
            meta: sessionItemMeta(call.session),
            source: null
          }).id
        } catch (err) {
          // The store already reported the refused write; any other throw goes to `guarded`.
          if (err instanceof Error && err.message === STORE_WRITE_FAILED) {
            return { ok: false, code: 'store_write_failed' }
          }
          throw err
        }
        deps.activity.record(call.sessionId, {
          at: deps.now(),
          action: 'saved',
          tool: '/remember',
          itemId: id,
          reason: null
        })
        return { ok: true, kind: parsed.text.kind, id }
      })
    },

    rebind(oldSessionId, newSessionId) {
      if (oldSessionId === newSessionId) return
      const state = windows.get(oldSessionId)
      const launch = launches.get(oldSessionId)
      windows.delete(oldSessionId)
      launches.delete(oldSessionId)
      // After `/clear` the conversation is new: it holds the index the mod sends next.
      resumed.delete(oldSessionId)
      if (state !== undefined) windows.set(newSessionId, state)
      if (launch !== undefined) launches.set(newSessionId, launch)
    },

    forget(sessionId) {
      windows.delete(sessionId)
      launches.delete(sessionId)
      resumed.delete(sessionId)
    }
  }

  function buildIndex(call: MemoryCall): { text: string; itemIds: string[] } {
    return buildSessionIndex(
      { tasks: deps.tasks, now: deps.now },
      call.store,
      {
        workspaceId: call.session.workspaceId,
        cwd: call.session.folder,
        excludeTaskIds: launches.get(call.sessionId) ?? []
      },
      `${MEMORY_RULES_OF_USE}\n${MEMORY_LIVE_RULES}`
    )
  }
}
