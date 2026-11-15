// What memory gives a running session through the `watcher-memory` mod (phase 3 addendum §5,
// §6): the memory section once per conversation window, recall per operator prompt, recall at use
// (the keys saved for the folders a tool touches, each on the section's key line, `keyLine`) and
// the `/remember` save. Per session, main keeps what this window was already told (the index's ids
// and the ids given since), so nothing is given twice in a window, and how many characters the
// window got, so recall stops at its budget. Recall also skips a key the section showed whole
// while its text is the one it showed (spec 2026-11-14 memory context index §7).
// A window also remembers when its section was built and the workspace and context it was built
// for (`built`; none in a resumed window), and the change of each key its "saved or changed" block
// gave (`told`). At each operator prompt that block comes first (§6): at most
// `MEMORY_LIMITS.freshRows` key lines that are new or changed since the build, or that a changed
// task, goal, template or tag set (or a workspace move, said in one line) newly relates; never a
// key this same session saved or updated last. The usual prompt costs one count
// (`changedSince`); the full selection runs only when something changed. No model call, no wait.
// Every block starts with MEMORY_BLOCK_MARKER, so the slice cleaner never takes it as evidence;
// every saved text in it goes through `oneLine` (P3-C1). A `<private>` span of the prompt is cut
// (to a space, `privateSpans.ts`) before the terms; the mod sends the text as typed. Memory text and
// prompt text are sensitive: this module logs `code=` only, and the activity log gets ids and counts.
import type { GoalsView } from '../../shared/schemas/goal'
import { MEMORY_ERROR, MEMORY_LIMITS, type KeyReason } from '../../shared/schemas/memory'
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
import type { MemoryNames } from './memoryNames'
import { sessionItemMeta, type MemoryCall } from './memoryGate'
import { MEMORY_LIVE_RULES, MEMORY_RULES_OF_USE, pinnedLine, type MemoryIndex } from './memoryIndex'
import { keyLine } from './memoryKeyLine'
import type { KeyRow } from './memoryRows'
import type { MemoryGrant } from './memoryTools'
import { cutPrivate } from './privateSpans'
import { MEMORY_BLOCK_MARKER, oneLine } from './promptText'
import { recallTerms } from './recallTerms'
import type { SessionContext } from './memorySearch'
import { buildSessionIndex, sessionContext } from './sessionIndex'
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
  /** The keys the window's section showed whole, each with the change date it showed (empty for a
   *  resumed window, whose section the model does not hold). */
  whole: Map<string, number>
  /** The id starts two items share (a key line then prints the whole id); null until needed. */
  clashes: ReadonlySet<string> | null
  /** When the window's section was built and for what; null in a resumed window, or before the
   *  index was asked. `at` never moves; the workspace and context follow what the "saved or
   *  changed" block told. */
  built: { at: number; workspaceId: string; context: SessionContext } | null
  /** Id → the change date the "saved or changed" block gave it with. */
  told: Map<string, number>
}

const LOG_PREFIX = '[claude-watcher][memory]'
const RECALL_HEADER = `${MEMORY_BLOCK_MARKER} items that may match this prompt`
const FRESH_HEADER = `${MEMORY_BLOCK_MARKER} saved or changed since this conversation started`
const MOVED_LINE =
  'This session moved to another workspace. The lists at the start of this conversation no longer apply.'
const NOT_OK = { ok: false } as const
const NOT_AVAILABLE = { ok: false, code: 'memory_not_available' } as const
const NOTHING: ModMemoryTextAnswer = { ok: true, text: '' }
/** The window a resumed spawn's mod process starts in (it counts from 0). */
const RESUMED_WINDOW = 0

const moreLine = (n: number): string => `${n} more; use memory_search`

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const set = new Set(a)
  return set.size === new Set(b).size && b.every((x) => set.has(x))
}

/** The reasons whose session field differs between `then` and `now` (the folder does not move). */
function changedReasons(then: SessionContext, now: SessionContext): Set<KeyReason> {
  const changed = new Set<KeyReason>()
  if (!sameSet(then.taskIds, now.taskIds)) changed.add('task')
  if (then.goalId !== now.goalId) changed.add('goal')
  if (then.templateId !== now.templateId) changed.add('template')
  if (!sameSet(then.tagIds, now.tagIds)) changed.add('tags')
  return changed
}

/** The "saved or changed" part of one recall answer, before it is given. */
type FreshPart = {
  /** The header, then the moved line when the session moved. */
  head: string[]
  /** One per key, in order: its line, and what the window keeps once it is given. */
  rows: { id: string; updatedAt: number; line: string; whole: boolean }[]
  moved: boolean
  /** The live workspace and context, when the answer moves `built` to them. */
  rebuilt: { workspaceId: string; context: SessionContext } | null
}

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
  /** The goal and tag names the section's headings print. */
  names: Pick<MemoryNames, 'goalName' | 'tagName'>
  /** `get` tells which keys the session itself saved or updated last. */
  activity: Pick<MemoryActivityLog, 'injected' | 'record' | 'get'>
  /** The reducer's OPERATOR_ORIGINS. */
  operatorOrigins: ReadonlySet<string>
  now: () => number
  log: (line: string) => void
  /** Default MEMORY_LIMITS.recallWindowChars; a test passes a small one. */
  windowChars?: number
  /** Default MEMORY_LIMITS.recallChars, for the "saved or changed" lines and recall's together
   *  (P3-C17: three recall lines alone never reach it; with five fresh lines before them they
   *  can, and the recall lines that do not fit are left out first). A test passes a small one. */
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
    const fresh: WindowState = {
      window,
      indexed: new Set(),
      delivered: new Set(),
      chars: 0,
      whole: new Map(),
      clashes: null,
      built: null,
      told: new Map()
    }
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

  /** The at-use block and the ids it gives (not yet delivered: the window's ceiling decides). */
  function atUseText(
    folders: readonly string[],
    found: { rows: KeyRow[]; more: number },
    clashes: ReadonlySet<string>
  ): { text: string; ids: string[] } {
    const lines: string[] = []
    const ids: string[] = []
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
        const line = keyLine(row, clashes).text
        // A header goes in only with its folder's first key.
        const add = line.length + 1 + (header === null ? 0 : header.length + 1)
        if (!fits(add, found.more + found.rows.length - given - 1)) break outer
        if (header !== null) lines.push(header)
        lines.push(line)
        header = null
        length += add
        given += 1
        ids.push(row.id)
      }
    }
    if (given === 0) return { text: '', ids }
    const left = found.more + found.rows.length - given
    if (left > 0) lines.push(moreLine(left))
    return { text: lines.join('\n'), ids }
  }

  /** The "saved or changed" part for this prompt (rules in the header), or null. */
  function freshPart(call: MemoryCall, state: WindowState): FreshPart | null {
    const { built } = state
    if (built === null) return null
    const live = { workspaceId: call.session.workspaceId, context: sessionContext(call.session) }
    const moved = live.workspaceId !== built.workspaceId
    const changed = changedReasons(built.context, live.context)
    if (!moved && changed.size === 0 && call.store.changedSince(call.scope, built.at) === 0) {
      return null
    }
    const picked = call.store
      .contextRows(live.workspaceId, live.context)
      .flatMap((group) =>
        group.rows.filter(
          (row) =>
            (row.updatedAt > built.at && state.told.get(row.id) !== row.updatedAt) ||
            ((moved || changed.has(group.reason)) &&
              !state.indexed.has(row.id) &&
              !state.delivered.has(row.id))
        )
      )
    const own = picked.length === 0 ? [] : deps.activity.get(call.sessionId).entries
    const rows = picked
      .filter(
        (row) =>
          !own.some(
            (e) =>
              e.itemId === row.id &&
              (e.action === 'saved' || e.action === 'updated') &&
              e.at >= row.updatedAt
          )
      )
      .slice(0, MEMORY_LIMITS.freshRows)
    if (rows.length === 0 && !moved) return null
    const clashes = new Set(call.store.shortIdClashes(live.workspaceId))
    return {
      head: [FRESH_HEADER, ...(moved ? [MOVED_LINE] : [])],
      rows: rows.map((row) => {
        const { text, whole } = keyLine(row, clashes)
        return { id: row.id, updatedAt: row.updatedAt, line: text, whole }
      }),
      moved,
      rebuilt: moved || changed.size > 0 ? live : null
    }
  }

  /** Adds a composed block to the window and delivers its ids, or nothing when it would take the
   *  window past its ceiling (M13: the ceiling is never passed; the addendum's "past it nothing
   *  more is added"). Answers the text given. */
  function give(
    state: WindowState,
    sessionId: string,
    block: { text: string; ids: readonly string[] },
    tool: string
  ): string {
    if (block.text === '' || state.chars + block.text.length > windowChars) return ''
    state.chars += block.text.length
    for (const id of block.ids) deliver(state, sessionId, id, tool)
    return block.text
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
        const { text, itemIds, groups, whole } = buildIndex(call)
        // A resumed conversation does not hold this index: nothing of it counts as given.
        const old = stillResumed(call.sessionId, req.window)
        const given = old ? [] : itemIds
        state.indexed = new Set(given)
        state.whole = new Map(old ? [] : whole.map((w) => [w.id, w.updatedAt]))
        state.clashes = new Set(call.store.shortIdClashes(call.session.workspaceId))
        state.built = old
          ? null
          : {
              at: deps.now(),
              workspaceId: call.session.workspaceId,
              context: sessionContext(call.session)
            }
        state.told = new Map()
        const folders = call.store.foldersWithSpecifics(
          call.scope,
          given,
          MEMORY_LIMITS.indexFolders
        )
        if (!old) deps.activity.injected(call.sessionId, { chars: text.length, itemIds, groups })
        return { ok: true, text, folders }
      })
    },

    recall(grant, req) {
      return guarded<ModMemoryTextAnswer>(NOT_OK, () => {
        const call = deps.gate(grant)
        if (call === null) return NOT_OK
        const state = stateFor(call.sessionId, req.window)
        if (!deps.operatorOrigins.has(req.origin)) return NOTHING
        if (state.chars >= windowChars) return NOTHING
        // The "saved or changed" part does not depend on the prompt's words: it comes before the
        // terms. Its lines go first; the ones that do not fit the block are left out.
        const fresh = freshPart(call, state)
        const lines: string[] = []
        let length = -1
        const push = (line: string): void => {
          lines.push(line)
          length += 1 + line.length
        }
        const freshIds: string[] = []
        if (fresh !== null) {
          // The head goes in with the first key, or alone when the session moved.
          const head = fresh.head.join('\n')
          for (const row of fresh.rows) {
            const add = (freshIds.length === 0 ? head.length + 1 : 0) + row.line.length + 1
            if (length + add > recallChars) continue
            if (freshIds.length === 0) push(head)
            push(row.line)
            freshIds.push(row.id)
          }
          if (freshIds.length === 0 && fresh.moved && head.length <= recallChars) push(head)
        }
        const terms = recallTerms(cutPrivate(req.text, ' '))
        // A key the section showed whole, still with the text it showed, is not given again; ask
        // for enough rows that such keys never use up the block's rows. A fresh key is not given
        // twice in one answer.
        const items =
          terms.length === 0
            ? []
            : call.store
                .recall(
                  call.scope,
                  terms,
                  [...state.delivered, ...freshIds],
                  MEMORY_LIMITS.recallRows + state.whole.size
                )
                .filter((item) => state.whole.get(item.id) !== item.updatedAt)
                .slice(0, MEMORY_LIMITS.recallRows)
        const recallIds: string[] = []
        for (const item of items) {
          const line = capLine(
            `${pinnedLine(item)} id=${item.id}`,
            item.id,
            MEMORY_LIMITS.recallLineChars
          )
          const header = recallIds.length === 0 ? RECALL_HEADER.length + 1 : 0
          if (length + 1 + line.length + header > recallChars) break
          if (recallIds.length === 0) push(RECALL_HEADER)
          push(line)
          recallIds.push(item.id)
        }
        const text = give(
          state,
          call.sessionId,
          { text: lines.join('\n'), ids: [...freshIds, ...recallIds] },
          'prompt'
        )
        if (text !== '' && fresh !== null) told(state, fresh, freshIds)
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
        state.clashes ??= new Set(call.store.shortIdClashes(call.session.workspaceId))
        return {
          ok: true,
          text: give(state, call.sessionId, atUseText(folders, found, state.clashes), 'file')
        }
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
      // Dropping it under the old id only frees memory: no ask comes under that id again.
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

  /** What a given "saved or changed" part leaves in the window (only once its text was given). */
  function told(state: WindowState, fresh: FreshPart, given: readonly string[]): void {
    for (const row of fresh.rows) {
      if (!given.includes(row.id)) continue
      state.told.set(row.id, row.updatedAt)
      if (row.whole) state.whole.set(row.id, row.updatedAt)
      else state.whole.delete(row.id)
    }
    if (fresh.rebuilt !== null && state.built !== null) {
      state.built = { ...state.built, ...fresh.rebuilt }
    }
  }

  function buildIndex(call: MemoryCall): MemoryIndex {
    return buildSessionIndex(
      { tasks: deps.tasks, now: deps.now, names: deps.names },
      call.store,
      {
        workspaceId: call.session.workspaceId,
        context: sessionContext(call.session),
        excludeTaskIds: launches.get(call.sessionId) ?? []
      },
      `${MEMORY_RULES_OF_USE}\n${MEMORY_LIVE_RULES}`
    )
  }
}
