// The memory mod cannot import main (layers.guard), so it holds its own copy of main's paths,
// server name and limits, builds its bodies by hand and reads main's answers with hand-written
// checks (it has no zod). This pins both sides (maintainability rule 2): the copies equal main's,
// the mod reads the config file main writes, every body it builds passes main's schemas, and every
// answer a real `createMemoryRecall` sends passes the mod's readers.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OPERATOR_ORIGINS } from '../../src/main/c9watch/reducer'
import { writeMcpConfig } from '../../src/main/goals/mcp/mcpConfigFile'
import {
  MEMORY_MCP_PATH,
  MEMORY_MCP_URL,
  MOD_MEMORY_PATHS
} from '../../src/main/hooks/hookContract'
import { openMemoryDb } from '../../src/main/memory/memoryDb'
import { createMemoryGate } from '../../src/main/memory/memoryGate'
import { createMemoryRecall } from '../../src/main/memory/memoryRecall'
import { createMemoryStore, type MemoryStore } from '../../src/main/memory/memoryStore'
import { MEMORY_MCP_SERVER_NAME, type MemorySessionMeta } from '../../src/main/memory/memoryTools'
import { MEMORY_BLOCK_MARKER } from '../../src/main/memory/promptText'
import { MEMORY_LIMITS } from '../../src/shared/schemas/memory'
import {
  ModMemoryAtUseSchema,
  ModMemoryIndexSchema,
  ModMemoryRecallSchema,
  ModMemoryRememberSchema,
  REMEMBER_REFUSALS
} from '../../src/shared/schemas/modMemory'
import {
  FOLDERS_PER_CALL,
  MCP_PATH,
  MOD_PATHS,
  PROMPT_CHARS,
  REMEMBER_CHARS,
  SERVER_NAME,
  atUseBody,
  indexBody,
  parseConfig,
  readIndexAnswer,
  readRememberAnswer,
  readTextAnswer,
  recallBody,
  rememberBody,
  rememberRow
} from '../../src/mod/watcher-memory/hooks/protocol'

const NOW = 1_762_800_000_000
const SESSION: MemorySessionMeta = {
  workspaceId: 'w1',
  folder: '/work/app',
  sessionName: 'fix login',
  tagIds: [],
  templateId: null,
  goalId: null,
  taskIds: []
}

describe('the memory mod’s contract with main', () => {
  it('the mod holds main’s paths, server name and limits', () => {
    expect([
      MOD_PATHS,
      MCP_PATH,
      SERVER_NAME,
      PROMPT_CHARS,
      FOLDERS_PER_CALL,
      REMEMBER_CHARS
    ]).toEqual([
      MOD_MEMORY_PATHS,
      MEMORY_MCP_PATH,
      MEMORY_MCP_SERVER_NAME,
      MEMORY_LIMITS.recallPromptChars,
      MEMORY_LIMITS.atUseFolders,
      MEMORY_LIMITS.rememberChars
    ])
  })

  describe('the config file', () => {
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'mod-memory-contract-'))
    })
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    it('the mod reads the config file main writes', () => {
      const path = writeMcpConfig(dir, MEMORY_MCP_SERVER_NAME, 'tok', MEMORY_MCP_URL)
      expect(parseConfig(readFileSync(path, 'utf8'))).toEqual({
        base: MEMORY_MCP_URL.slice(0, -MEMORY_MCP_PATH.length),
        authorization: 'Bearer tok'
      })
    })
  })

  it('every body the mod builds passes main’s schema', () => {
    expect([
      ModMemoryIndexSchema.safeParse(JSON.parse(indexBody(0))).success,
      ModMemoryRecallSchema.safeParse(JSON.parse(recallBody(1, 'composer', 'x'.repeat(5000)) ?? ''))
        .success,
      ModMemoryAtUseSchema.safeParse(JSON.parse(atUseBody(1, ['/work/app']))).success,
      ModMemoryRememberSchema.safeParse(JSON.parse(rememberBody('composer', 'a = b'))).success,
      ModMemoryRememberSchema.safeParse(JSON.parse(rememberBody('composer', 'x'.repeat(20_000))))
        .success
    ]).toEqual([true, true, true, true, true])
  })

  it('a body with an origin longer than main takes still passes main’s schema', () => {
    const origin = 'o'.repeat(200)
    expect([
      ModMemoryRecallSchema.safeParse(JSON.parse(recallBody(0, origin, 'staging port') ?? ''))
        .success,
      ModMemoryRememberSchema.safeParse(JSON.parse(rememberBody(origin, 'a = b'))).success
    ]).toEqual([true, true])
  })

  it('an at-use body never names more folders than main takes', () => {
    const folders = ['/a', '/a/b', '/a/b/c', '/a/b/c/d', '/a/b/c/d/e', '/a/b/c/d/e/f']
    expect(ModMemoryAtUseSchema.safeParse(JSON.parse(atUseBody(0, folders))).success).toBe(true)
  })

  describe('main’s answers', () => {
    let store: MemoryStore
    beforeEach(() => {
      const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
      if (!open.ok) throw new Error('open failed')
      let ids = 0
      store = createMemoryStore({
        db: open.db,
        now: () => NOW,
        newId: () => `m${++ids}`,
        report: () => undefined,
        log: () => undefined
      })
    })

    it('every answer main builds passes the mod’s readers', () => {
      store.add({
        text: { kind: 'specific', key: 'staging port', value: '9281' },
        workspaceId: 'w1',
        check: null,
        basis: 'inferred',
        origin: { by: 'agent', sessionId: 's0' },
        meta: {
          folder: '/work/app',
          sessionName: null,
          tagIds: [],
          templateId: null,
          goalId: null,
          taskIds: []
        },
        source: null
      })
      const recall = createMemoryRecall({
        gate: createMemoryGate({
          enabled: () => true,
          store: () => store,
          session: (id) => (id === 's1' ? SESSION : null)
        }),
        tasks: () => null,
        activity: { injected: () => undefined, record: () => undefined },
        operatorOrigins: OPERATOR_ORIGINS,
        now: () => NOW,
        log: () => undefined
      })
      const grant = { sessionId: 's1' }
      const index = recall.index(grant, ModMemoryIndexSchema.parse(JSON.parse(indexBody(0))))
      const prompt = recall.recall(
        grant,
        ModMemoryRecallSchema.parse(
          JSON.parse(recallBody(0, 'composer', 'which staging port?') ?? '')
        )
      )
      const saved = recall.remember(
        grant,
        ModMemoryRememberSchema.parse(JSON.parse(rememberBody('composer', 'staging host = web1')))
      )
      const stored = store.search(
        { workspaceId: 'w1', includeGlobal: true },
        { kind: null, query: 'staging host', filters: {}, offset: 0, limit: 10 },
        { sessionFolder: '/work/app', tagIdsByName: () => [], goalIdsByName: () => [] }
      )
      expect([
        readIndexAnswer(JSON.stringify(index)),
        readTextAnswer(JSON.stringify(prompt)),
        readRememberAnswer(JSON.stringify(saved))
      ]).toEqual([
        { text: expect.stringContaining('- staging port ('), folders: [] },
        expect.stringMatching(new RegExp(`^${MEMORY_BLOCK_MARKER.replace(/[()]/g, '\\$&')}`)),
        { ok: true, kind: 'specific', id: stored.rows[0]?.id }
      ])
      expect(stored.rows.map((row) => row.id)).toEqual(['m2'])
    })

    it('a refusal main sends passes the mod’s remember reader', () => {
      const recall = createMemoryRecall({
        gate: () => null,
        tasks: () => null,
        activity: { injected: () => undefined, record: () => undefined },
        operatorOrigins: OPERATOR_ORIGINS,
        now: () => NOW,
        log: () => undefined
      })
      const answer = recall.remember(
        { sessionId: 's1' },
        ModMemoryRememberSchema.parse(JSON.parse(rememberBody('composer', 'a = b')))
      )
      expect(readRememberAnswer(JSON.stringify(answer))).toEqual({
        ok: false,
        code: 'memory_not_available'
      })
    })
  })

  it('the mod has its own row for every refusal main can send', () => {
    const rows = REMEMBER_REFUSALS.map((code) => rememberRow({ ok: false, code }))
    expect(new Set(rows).size).toBe(REMEMBER_REFUSALS.length)
  })
})
