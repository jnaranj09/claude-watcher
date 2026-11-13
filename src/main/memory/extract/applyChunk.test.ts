// Writing one chunk's result (addendum "Checking and writing candidates", "Writing"; D23, D26):
// tasks through the goals store first, then ONE memory transaction. Real `:memory:` store,
// commands and state; a real goals store on an in-memory blob. Every test reads what the tables
// and the goals file hold right after the call.
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { NO_COUNTS, type MemoryItemKind, type MemoryText } from '../../../shared/schemas/memory'
import { STORE_WRITE_FAILED } from '../../../shared/schemas/storageHealth'
import type { ExtractCandidate } from '../../../shared/schemas/memoryExtract'
import { createGoalsStore, type GoalsStore } from '../../persistence/goals'
import { createMemoryCommands, type MemoryCommands } from '../memoryCommands'
import { openMemoryDb, type MemoryDb } from '../memoryDb'
import { createMemoryStore, type MemoryStore } from '../memoryStore'
import { applyChunk, type ApplyDeps, type ChunkWrite } from './applyChunk'
import { checkCandidates, type Checked } from './checkCandidates'
import { createExtractState, type ExtractRow, type ExtractState } from './extractState'
import type { CleanEntry } from './sliceCleaner'

const NOW = 1_762_800_000_000
const PATH = '/tmp/transcripts/t-1.jsonl'
const META: ExtractRow['meta'] = {
  folder: '/work/acme/shop',
  sessionName: 'fix api port',
  tagIds: [],
  templateId: null,
  goalId: null,
  taskIds: []
}
const NO_CTX = { sessionFolder: null, tagIdsByName: () => [], goalIdsByName: () => [] }

let db: MemoryDb
let ids: number
let lines: string[]
let store: MemoryStore
let commands: MemoryCommands
let state: ExtractState
let goals: GoalsStore
let row: ExtractRow
let deps: ApplyDeps

function makeStore(on: MemoryDb): MemoryStore {
  return createMemoryStore({
    db: on,
    now: () => NOW,
    newId: () => `m${++ids}`,
    report: () => undefined,
    log: (line) => {
      lines.push(line)
    }
  })
}

function track(meta: ExtractRow['meta'] = META): ExtractRow {
  return state.track({
    sessionId: 't-1',
    originSessionId: 'card-1',
    workspaceId: 'w1',
    meta,
    phase: 'live',
    at: NOW - 10
  })
}

beforeEach(() => {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  db = open.db
  ids = 0
  lines = []
  store = makeStore(db)
  commands = createMemoryCommands({ db, newId: () => `c${++ids}` })
  state = createExtractState({ db })
  goals = createGoalsStore({ newId: () => `g${++ids}`, now: () => NOW, log: () => undefined })
  row = track()
  deps = {
    store,
    commands,
    state,
    goals,
    now: () => NOW,
    log: (line) => {
      lines.push(line)
    }
  }
})

function write(over: Partial<ChunkWrite> = {}): ChunkWrite {
  return {
    row,
    transcriptPath: PATH,
    kept: [],
    note: 'moved the port',
    commands: [],
    entries: [],
    next: { byteOffset: 400, entryCount: 9, prompts: 2 },
    ...over
  }
}

function specific(key: string, value: string): MemoryText {
  return { kind: 'specific', key, value }
}

function item(
  action: 'add' | 'update' | 'none',
  text: MemoryText,
  basis: 'observed' | 'stated' | 'inferred',
  entryId: string,
  id: string | null = null
): Checked {
  return {
    kind: 'item',
    action,
    id,
    text,
    check: null,
    basis,
    source: { entryId, quote: 'on 9281' }
  }
}

function task(
  action: 'add' | 'update',
  title: string,
  id: string | null = null,
  check: string | null = 'curl localhost:9281'
): Checked {
  return { kind: 'task', action, id, title, check, leftWith: 'operator' }
}

function episode(title: string, body: string): Checked {
  return { kind: 'episode', title, body, source: { entryId: 'u3', quote: 'the port moved' } }
}

function entry(n: number, kind: CleanEntry['kind'], text: string): CleanEntry {
  return {
    n,
    kind,
    tool: kind === 'result' ? 'Bash' : null,
    status: kind === 'result' ? 'ok' : null,
    text,
    entryId: `u${n}`,
    lineEnd: n * 10,
    evidence: true
  }
}

function search(input: { kind?: MemoryItemKind }): { rows: { id: string }[]; total: number } {
  return store.search(
    { workspaceId: 'w1', includeGlobal: true },
    {
      kind: input.kind ?? null,
      query: null,
      filters: { includeStale: true },
      offset: 0,
      limit: 100
    },
    NO_CTX
  )
}

const Count = z.object({ n: z.number() })
function count(table: 'item' | 'version' | 'command'): number {
  return db.get(`SELECT COUNT(*) AS n FROM ${table}`, Count)?.n ?? -1
}

function only(): ReturnType<MemoryStore['get']> {
  const rows = search({}).rows
  expect(rows).toHaveLength(1)
  return store.get(rows[0]?.id ?? '')
}

function addSaved(text: MemoryText, by: 'agent' | 'operator' | 'extract' = 'extract'): string {
  return store.add({
    text,
    workspaceId: 'w1',
    check: null,
    basis: 'inferred',
    origin: { by, sessionId: by === 'operator' ? null : 'card-1' },
    meta: META,
    source: null
  }).id
}

function sourceRow(id: string): unknown {
  return db.get(
    'SELECT source_path, source_entry, source_quote FROM item WHERE id = ?',
    z.object({
      source_path: z.string().nullable(),
      source_entry: z.string().nullable(),
      source_quote: z.string().nullable()
    }),
    [id]
  )
}

describe('items', () => {
  it('adds a specific with the session stamp, its basis and its source', () => {
    const out = applyChunk(
      deps,
      write({ kept: [item('add', specific('API port', '9281'), 'observed', 'u7')] })
    )
    expect(out.added).toEqual({ specifics: 1, facts: 0, tasks: 0, episodes: 0 })
    const saved = only()
    expect(saved).toMatchObject({
      kind: 'specific',
      key: 'API port',
      value: '9281',
      origin: { by: 'extract', sessionId: 'card-1' },
      workspaceId: 'w1',
      basis: 'observed',
      source: { entryId: 'u7', quote: 'on 9281' },
      meta: { folder: '/work/acme/shop', sessionName: 'fix api port' }
    })
    expect(sourceRow(saved?.id ?? '')).toEqual({
      source_path: PATH,
      source_entry: 'u7',
      source_quote: 'on 9281'
    })
    expect(out.saved).toEqual([{ itemId: saved?.id, action: 'saved' }])
  })

  it('adds a fact and counts it as a fact', () => {
    const fact: MemoryText = { kind: 'fact', title: 'Port rule', body: 'The API owns 9281.' }
    const out = applyChunk(deps, write({ kept: [item('add', fact, 'stated', 'u2')] }))
    expect(out.added).toEqual({ specifics: 0, facts: 1, tasks: 0, episodes: 0 })
    expect(only()).toMatchObject({ kind: 'fact', title: 'Port rule', basis: 'stated' })
  })

  it('an update appends a version with the reason "seen in session"', () => {
    const id = addSaved(specific('API port', '9280'))
    const out = applyChunk(
      deps,
      write({ kept: [item('update', specific('API port', '9281'), 'observed', 'u7', id)] })
    )
    expect(out.added).toEqual({ specifics: 1, facts: 0, tasks: 0, episodes: 0 })
    expect(out.saved).toEqual([{ itemId: id, action: 'updated' }])
    expect(store.versions(id).map((v) => [v.body, v.by, v.reason, v.basis])).toEqual([
      ['9281', 'extract', 'seen in session', 'observed'],
      ['9280', 'extract', null, 'inferred']
    ])
    expect(sourceRow(id)).toEqual({
      source_path: PATH,
      source_entry: 'u7',
      source_quote: 'on 9281'
    })
  })

  it('an update of an item deleted since the scope was read writes nothing and is not counted', () => {
    const id = addSaved(specific('API port', '9280'))
    store.remove(id)
    const out = applyChunk(
      deps,
      write({ kept: [item('update', specific('API port', '9281'), 'observed', 'u7', id)] })
    )
    expect([out.added, out.saved, count('item'), count('version')]).toEqual([NO_COUNTS, [], 0, 0])
    expect(state.get('t-1')?.byteOffset).toBe(400)
  })

  it('an update the check passed is not written once the operator edited the item (D16)', () => {
    const id = addSaved(specific('API port', '9280'))
    const entries = [entry(5, 'result', 'listening on 9281')]
    const checked = checkCandidates(
      {
        candidates: [
          {
            type: 'specific',
            action: 'update',
            id,
            head: 'API port',
            body: '9281',
            check: null,
            leftWith: null,
            evidence: 'listening on 9281'
          }
        ],
        note: 'n'
      },
      {
        entries,
        notes: [],
        final: false,
        tasksOn: true,
        items: store.scopeForExtract('w1', META.folder, 'card-1', 150),
        tasks: [],
        operatorWrote: (itemId) => store.currentWriter(itemId) === 'operator'
      }
    )
    expect(checked.kept).toEqual([expect.objectContaining({ action: 'update', id })])
    // The operator saves an edit after the check and before the write.
    store.edit(id, { text: specific('API port', '9282'), check: null }, 'operator', null)
    const out = applyChunk(deps, write({ kept: checked.kept, entries }))
    expect([out.added, out.saved]).toEqual([NO_COUNTS, []])
    expect(store.get(id)).toMatchObject({ value: '9282', basis: 'stated', source: null })
    expect(store.versions(id).map((v) => [v.body, v.by])).toEqual([
      ['9282', 'operator'],
      ['9280', 'extract']
    ])
    expect(state.get('t-1')?.byteOffset).toBe(400)
  })

  it('a none only moves the last-seen date and is not counted', () => {
    const id = addSaved(specific('API port', '9281'))
    const later = { ...deps, now: () => NOW + 500 }
    const out = applyChunk(
      later,
      write({ kept: [item('none', specific('API port', '9281'), 'observed', 'u7', id)] })
    )
    expect([out.added, out.saved]).toEqual([NO_COUNTS, []])
    expect(store.get(id)).toMatchObject({ lastSeenAt: NOW + 500, updatedAt: NOW, source: null })
    expect(store.versions(id)).toHaveLength(1)
  })
})

describe('tasks', () => {
  it('writes a task into the session goal with its check and no session link', () => {
    const goalId = goals.saveGoal({ workspaceId: 'w1', name: 'Shop' }, '/work/acme/shop').saved.id
    row = track({ ...META, goalId })
    const out = applyChunk(deps, write({ kept: [task('add', 'Restart the API')] }))
    expect(out.added).toEqual({ specifics: 0, facts: 0, tasks: 1, episodes: 0 })
    expect(goals.view().tasks).toEqual([
      expect.objectContaining({
        workspaceId: 'w1',
        goalId,
        title: 'Restart the API',
        status: 'open',
        check: 'curl localhost:9281',
        leftWith: 'operator',
        lastSeenAt: NOW,
        originSessionId: 'card-1',
        folder: '/work/acme/shop',
        sessionIds: []
      })
    ])
    expect(out.saved).toEqual([])
  })

  it('a task of a session with no goal goes to Daily tasks', () => {
    applyChunk(deps, write({ kept: [task('add', 'Restart the API')] }))
    expect(goals.view().tasks.map((t) => t.goalId)).toEqual([null])
  })

  it('an update sets the check, who it is left with and the last-seen date of the open task', () => {
    const id = goals.addTaskFromExtraction({
      workspaceId: 'w1',
      goalId: null,
      title: 'Restart the API',
      check: null,
      leftWith: 'session',
      originSessionId: 'card-0',
      folder: null,
      at: NOW - 100
    }).id
    const out = applyChunk(deps, write({ kept: [task('update', 'Restart the API', id)] }))
    expect(out.added.tasks).toBe(1)
    expect(goals.view().tasks).toEqual([
      expect.objectContaining({
        id,
        check: 'curl localhost:9281',
        leftWith: 'operator',
        lastSeenAt: NOW,
        originSessionId: 'card-0'
      })
    ])
  })

  it('an update of a task that was closed meanwhile writes nothing and is not counted', () => {
    const id = goals.addTaskFromExtraction({
      workspaceId: 'w1',
      goalId: null,
      title: 'Restart the API',
      check: null,
      leftWith: 'session',
      originSessionId: 'card-0',
      folder: null,
      at: NOW - 100
    }).id
    goals.setTaskStatus(id, 'done', 'operator')
    const before = goals.view().tasks
    const out = applyChunk(deps, write({ kept: [task('update', 'Restart the API', id)] }))
    expect(out.added).toEqual(NO_COUNTS)
    expect(goals.view().tasks).toEqual(before)
  })

  it('with no goals store a task is not written, logs a code and the rest is saved', () => {
    const out = applyChunk(
      { ...deps, goals: null },
      write({
        kept: [
          task('add', 'Restart the API'),
          item('add', specific('API port', '9281'), 'observed', 'u7')
        ]
      })
    )
    expect(out.added).toEqual({ specifics: 1, facts: 0, tasks: 0, episodes: 0 })
    expect(goals.view().tasks).toEqual([])
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_task_write_failed'])
    expect(state.get('t-1')?.byteOffset).toBe(400)
  })

  it('a task the goals store refuses is skipped with a code, never its text, and the rest is saved', () => {
    const refused = task('add', 'Restart the API', null, 'x'.repeat(301))
    const out = applyChunk(deps, write({ kept: [refused, task('add', 'Rebuild the index')] }))
    expect(out.added.tasks).toBe(1)
    expect(goals.view().tasks.map((t) => t.title)).toEqual(['Rebuild the index'])
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_task_write_failed'])
    expect(state.get('t-1')?.byteOffset).toBe(400)
  })
})

describe('the episode', () => {
  it('writes the episode once and rewrites it as a new version when the session ends again', () => {
    const first = applyChunk(deps, write({ kept: [episode('A', 'one')] }))
    expect(first.added).toEqual({ specifics: 0, facts: 0, tasks: 0, episodes: 1 })
    const again = applyChunk(
      { ...deps, now: () => NOW + 9 },
      write({ row: { ...row, episodeId: first.episodeId }, kept: [episode('A', 'two')] })
    )
    expect(search({ kind: 'episode' }).total).toBe(1)
    expect(again.episodeId).toBe(first.episodeId)
    expect(again.saved).toEqual([{ itemId: first.episodeId, action: 'updated' }])
    const versions = store.versions(first.episodeId ?? '')
    expect(versions.map((v) => [v.body, v.reason])).toEqual([
      ['two', 'session ended again'],
      ['one', null]
    ])
    expect(store.get(first.episodeId ?? '')).toMatchObject({
      kind: 'episode',
      endedAt: NOW + 9,
      basis: 'inferred',
      origin: { by: 'extract', sessionId: 'card-1' },
      source: { entryId: 'u3', quote: 'the port moved' }
    })
    expect(state.get('t-1')?.episodeId).toBe(first.episodeId)
  })

  it('the next end re-versions an episode the operator restored, keeping the restored version (R27)', () => {
    let clock = NOW
    const timed = createMemoryStore({
      db,
      now: () => clock,
      newId: () => `m${++ids}`,
      report: () => undefined,
      log: () => undefined
    })
    const at = { ...deps, store: timed, now: () => clock }
    const first = applyChunk(at, write({ kept: [episode('A', 'one')] }))
    const id = first.episodeId ?? ''
    clock = NOW + 10
    applyChunk(at, write({ row: { ...row, episodeId: id }, kept: [episode('A', 'two')] }))
    clock = NOW + 20
    timed.restore(id, NOW)
    expect(timed.currentWriter(id)).toBe('operator')
    clock = NOW + 30
    const again = applyChunk(
      at,
      write({ row: { ...row, episodeId: id }, kept: [episode('A', 'three')] })
    )
    expect(again.episodeId).toBe(id)
    expect(timed.versions(id).map((v) => [v.body, v.by])).toEqual([
      ['three', 'extract'],
      ['one', 'operator'],
      ['two', 'extract'],
      ['one', 'extract']
    ])
  })

  it('a new episode is added when the one the row names was deleted', () => {
    const first = applyChunk(deps, write({ kept: [episode('A', 'one')] }))
    store.remove(first.episodeId ?? '')
    const again = applyChunk(
      deps,
      write({ row: { ...row, episodeId: first.episodeId }, kept: [episode('A', 'two')] })
    )
    expect(again.episodeId).not.toBe(first.episodeId)
    expect(store.get(again.episodeId ?? '')).toMatchObject({ kind: 'episode', body: 'two' })
    expect(state.get('t-1')?.episodeId).toBe(again.episodeId)
  })

  it('an episode found only in a progress note has no source', () => {
    const fromNote: Checked = { kind: 'episode', title: 'A', body: 'one', source: null }
    const out = applyChunk(deps, write({ kept: [fromNote] }))
    expect(store.get(out.episodeId ?? '')).toMatchObject({ source: null, basis: 'inferred' })
  })

  it('a chunk with no episode keeps the episode the row already has', () => {
    const first = applyChunk(deps, write({ kept: [episode('A', 'one')] }))
    const out = applyChunk(deps, write({ row: { ...row, episodeId: first.episodeId } }))
    expect(out.episodeId).toBeNull()
    expect(state.get('t-1')?.episodeId).toBe(first.episodeId)
  })
})

describe("the session's own tool saves (D26)", () => {
  it('gives the session own tool save its basis and source when its value is in the slice', () => {
    const id = addSaved(specific('API port', '9281'), 'agent')
    const out = applyChunk(
      deps,
      write({
        entries: [entry(4, 'claude', 'I will try 9281'), entry(5, 'result', 'listening on 9281')]
      })
    )
    expect(out.added).toEqual(NO_COUNTS)
    expect(out.saved).toEqual([])
    expect(store.get(id)).toMatchObject({
      basis: 'observed',
      source: { entryId: 'u5', quote: 'listening on 9281' }
    })
    expect(sourceRow(id)).toMatchObject({ source_path: PATH })
    expect(store.versions(id).map((v) => v.basis)).toEqual(['observed'])
  })

  it('leaves a tool save alone when its value is not in the slice', () => {
    const id = addSaved(specific('API port', '9281'), 'agent')
    applyChunk(deps, write({ entries: [entry(5, 'result', 'listening on 92810')] }))
    expect(store.get(id)).toMatchObject({ basis: 'inferred', source: null })
  })

  it('leaves a tool save the operator edited alone, its version row included (D16)', () => {
    const id = addSaved(specific('API port', '9281'), 'agent')
    store.edit(id, { text: specific('API port', '9283'), check: null }, 'operator', null)
    const VersionRow = z.object({
      item_id: z.string(),
      at: z.number(),
      by: z.string(),
      basis: z.string(),
      reason: z.string().nullable(),
      head: z.string(),
      body: z.string()
    })
    const ItemCols = z.object({ basis: z.string(), updated_at: z.number() })
    const snapshot = (): unknown => ({
      versions: db.all(
        'SELECT item_id, at, by, basis, reason, head, body FROM version WHERE item_id = ? ORDER BY seq',
        VersionRow,
        [id]
      ),
      item: db.get('SELECT basis, updated_at FROM item WHERE id = ?', ItemCols, [id]),
      source: sourceRow(id)
    })
    const before = snapshot()
    applyChunk(deps, write({ entries: [entry(5, 'result', 'listening on 9283')] }))
    expect(snapshot()).toEqual(before)
    expect(store.get(id)).toMatchObject({ value: '9283', basis: 'stated', source: null })
  })

  it("leaves another session's tool save alone", () => {
    const other = store.add({
      text: specific('API port', '9281'),
      workspaceId: 'w1',
      check: null,
      basis: 'inferred',
      origin: { by: 'agent', sessionId: 'card-2' },
      meta: META,
      source: null
    }).id
    applyChunk(deps, write({ entries: [entry(5, 'result', 'listening on 9281')] }))
    expect(store.get(other)).toMatchObject({ basis: 'inferred', source: null })
  })
})

const CommandRow = z.object({ text: z.string(), count: z.number(), folder: z.string() })
function commandRows(): z.infer<typeof CommandRow>[] {
  return db.all('SELECT text, count, folder FROM command ORDER BY text', CommandRow)
}

describe('commands and the offset', () => {
  it('records each worked command once per run and moves the offset in the same transaction', () => {
    applyChunk(deps, write({ commands: ['npm test', 'git status', 'npm test'] }))
    expect(commandRows()).toEqual([
      { text: 'git status', count: 1, folder: '/work/acme/shop' },
      { text: 'npm test', count: 2, folder: '/work/acme/shop' }
    ])
    expect(state.get('t-1')).toMatchObject({
      byteOffset: 400,
      entryCount: 9,
      prompts: 2,
      notes: ['moved the port'],
      attempts: 0
    })
  })

  it('records no command for a session with no folder', () => {
    row = track({ ...META, folder: null })
    applyChunk(deps, write({ commands: ['npm test'] }))
    expect(count('command')).toBe(0)
    expect(state.get('t-1')?.byteOffset).toBe(400)
  })

  it('adds what was saved to the row counts', () => {
    applyChunk(
      deps,
      write({
        kept: [
          item('add', specific('API port', '9281'), 'observed', 'u7'),
          task('add', 'Restart the API'),
          episode('A', 'one')
        ]
      })
    )
    expect(state.get('t-1')?.counts).toEqual({ specifics: 1, facts: 0, tasks: 1, episodes: 1 })
  })
})

/** A db whose `nth` `INSERT INTO item` throws, as a full disk would. */
function failingOn(nth: number): MemoryDb {
  let inserts = 0
  return {
    ...db,
    run: (sql, params) => {
      if (sql.trimStart().startsWith('INSERT INTO item ') && ++inserts === nth)
        throw new Error('disk I/O error')
      db.run(sql, params)
    }
  }
}

describe('a failed memory write', () => {
  const kept = (): Checked[] => [
    task('add', 'Restart the API'),
    item('add', specific('API port', '9281'), 'observed', 'u7'),
    item('add', specific('Hook port', '9279'), 'observed', 'u8')
  ]

  it('a failed memory write moves no offset, records no command and keeps the tasks', () => {
    const failing = { ...deps, store: makeStore(failingOn(2)) }
    expect(() => applyChunk(failing, write({ kept: kept(), commands: ['npm test'] }))).toThrow(
      STORE_WRITE_FAILED
    )
    expect([count('item'), count('version'), count('command')]).toEqual([0, 0, 0])
    expect(state.get('t-1')).toMatchObject({
      byteOffset: 0,
      entryCount: 0,
      notes: [],
      counts: NO_COUNTS
    })
    expect(goals.view().tasks.map((t) => t.title)).toEqual(['Restart the API'])
  })

  it('a refused advance (no state row) rolls back the items and commands written before it', () => {
    state.remove('t-1')
    expect(() => applyChunk(deps, write({ kept: kept(), commands: ['npm test'] }))).toThrow(
      STORE_WRITE_FAILED
    )
    expect([count('item'), count('version'), count('command')]).toEqual([0, 0, 0])
    expect(goals.view().tasks).toHaveLength(1)
  })

  it('a failed D26 evidence write rolls back the whole chunk', () => {
    const id = addSaved(specific('API port', '9281'), 'agent')
    const throwing = {
      ...deps,
      store: {
        ...store,
        setEvidence: () => {
          throw new Error('disk I/O error')
        }
      }
    }
    expect(() =>
      applyChunk(
        throwing,
        write({ kept: kept().slice(1, 2), entries: [entry(5, 'result', 'listening on 9281')] })
      )
    ).toThrow(STORE_WRITE_FAILED)
    expect(search({}).rows.map((r) => r.id)).toEqual([id])
    expect(state.get('t-1')?.byteOffset).toBe(0)
  })

  it('a re-run of the same chunk after the failure writes no second task and no second item', () => {
    // The tasks were written, then the memory transaction failed (or the app died in between):
    // the chunk is read again, and the task is now in the open tasks the check is given (D23).
    const failing = { ...deps, store: makeStore(failingOn(2)) }
    expect(() => applyChunk(failing, write({ kept: kept(), commands: ['npm test'] }))).toThrow(
      STORE_WRITE_FAILED
    )
    const candidates: ExtractCandidate[] = [
      {
        type: 'task',
        action: 'add',
        id: null,
        head: 'Restart the API',
        body: null,
        check: 'curl localhost:9281',
        leftWith: 'operator',
        evidence: 'listening on 9281'
      },
      {
        type: 'specific',
        action: 'add',
        id: null,
        head: 'API port',
        body: '9281',
        check: null,
        leftWith: null,
        evidence: 'listening on 9281'
      }
    ]
    const entries = [entry(5, 'result', 'listening on 9281')]
    const open = goals.view().tasks.filter((t) => t.status === 'open')
    const checked = checkCandidates(
      { candidates, note: 'n' },
      {
        entries,
        notes: [],
        final: false,
        tasksOn: true,
        items: store.scopeForExtract('w1', META.folder, 'card-1', 150),
        tasks: open.map((t) => ({ id: t.id, title: t.title })),
        operatorWrote: () => false
      }
    )
    const out = applyChunk(deps, write({ kept: checked.kept, entries, commands: ['npm test'] }))
    expect(out.added).toEqual({ specifics: 1, facts: 0, tasks: 1, episodes: 0 })
    expect(goals.view().tasks.map((t) => t.title)).toEqual(['Restart the API'])
    expect([count('item'), count('command')]).toEqual([1, 1])
    expect(commandRows()).toEqual([{ text: 'npm test', count: 1, folder: '/work/acme/shop' }])
    expect(state.get('t-1')?.byteOffset).toBe(400)
  })

  it('logs no memory or task text', () => {
    const failing = { ...deps, store: makeStore(failingOn(1)), goals: null }
    expect(() => applyChunk(failing, write({ kept: kept(), commands: ['npm test'] }))).toThrow(
      STORE_WRITE_FAILED
    )
    expect(lines).toEqual([
      '[claude-watcher][memory] code=memory_task_write_failed',
      '[claude-watcher][memory] code=memory_write_failed'
    ])
  })
})
