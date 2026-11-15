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
  HOST,
  MEMORY_MCP_PATH,
  MEMORY_MCP_URL,
  MOD_MEMORY_PATHS
} from '../../src/main/hooks/hookContract'
import { formatDay } from '../../src/main/memory/formatDay'
import { openMemoryDb } from '../../src/main/memory/memoryDb'
import { createMemoryGate } from '../../src/main/memory/memoryGate'
import {
  MEMORY_CONFIG_ENV,
  createMemoryMcp,
  memorySpawnExtras
} from '../../src/main/memory/memoryLaunch'
import { createMemoryRecall, type MemoryRecall } from '../../src/main/memory/memoryRecall'
import { createMemoryStore, type MemoryStore } from '../../src/main/memory/memoryStore'
import { MEMORY_MCP_SERVER_NAME, type MemorySessionMeta } from '../../src/main/memory/memoryTools'
import { MEMORY_BLOCK_MARKER } from '../../src/main/memory/promptText'
import { DEFAULT_PROFILE, DEV_PROFILE, DRIVE_PROFILE, E2E_PROFILE } from '../../src/main/profile'
import { MEMORY_LIMITS } from '../../src/shared/schemas/memory'
import {
  ModMemoryAtUseSchema,
  ModMemoryIndexSchema,
  ModMemoryRecallSchema,
  ModMemoryRememberSchema,
  REMEMBER_REFUSALS
} from '../../src/shared/schemas/modMemory'
import {
  CONFIG_ENV,
  FOLDER_CHARS,
  FOLDERS_PER_CALL,
  MCP_PATH,
  MOD_PATHS,
  PROMPT_CHARS,
  REMEMBER_CHARS,
  SERVER_NAME,
  WINDOW_MAX,
  atUseBody,
  foldersFor,
  indexBody,
  isNotOk,
  nextWindow,
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

  it('the mod reads the env var main sets', () => {
    expect(CONFIG_ENV).toBe(MEMORY_CONFIG_ENV)
  })

  describe('the config file', () => {
    let dir: string
    let modStore: MemoryStore
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'mod-memory-contract-'))
      const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
      if (!open.ok) throw new Error('open failed')
      modStore = createMemoryStore({
        db: open.db,
        now: () => NOW,
        newId: () => 'm1',
        report: () => undefined,
        log: () => undefined
      })
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

    it('the mod reads the config file main writes on every profile’s hook port', () => {
      const ports = [DEFAULT_PROFILE, DEV_PROFILE, DRIVE_PROFILE, E2E_PROFILE].map(
        (profile) => profile.hookPort
      )
      expect(
        ports.map((port) =>
          parseConfig(
            readFileSync(
              writeMcpConfig(
                dir,
                MEMORY_MCP_SERVER_NAME,
                'tok',
                `http://${HOST}:${port}${MEMORY_MCP_PATH}`
              ),
              'utf8'
            )
          )
        )
      ).toEqual(
        ports.map((port) => ({ base: `http://${HOST}:${port}`, authorization: 'Bearer tok' }))
      )
    })

    it('a mod session’s env names a file the mod reads, with the session’s memory token, on every profile’s hook port', () => {
      const mcp = createMemoryMcp({
        dir: () => dir,
        report: () => undefined,
        enabled: () => true,
        store: () => null,
        session: () => null,
        names: {
          tagIdsByName: () => [],
          tagName: () => null,
          goalIdsByName: () => [],
          goalName: () => null
        },
        tasks: () => null,
        commands: () => null,
        activity: { injected: () => undefined, record: () => undefined },
        now: () => NOW,
        log: () => undefined
      })
      const ports = [DEFAULT_PROFILE, DEV_PROFILE, DRIVE_PROFILE, E2E_PROFILE].map(
        (profile) => profile.hookPort
      )
      const read = ports.map((port, i) => {
        const sessionId = `s${i}`
        const out = memorySpawnExtras(
          {
            enabled: () => true,
            hookListening: () => true,
            store: () => modStore,
            tasks: () => null,
            now: () => NOW,
            names: { goalName: () => null, tagName: () => null },
            tokens: mcp.tokens,
            configs: mcp.configs,
            url: `http://${HOST}:${port}${MEMORY_MCP_PATH}`,
            activity: { injected: () => undefined, recallMode: () => undefined },
            recallMod: () => ({ dir: '/data/mods/watcher-memory' }),
            recall: { launched: () => undefined },
            log: () => undefined
          },
          sessionId,
          { cwd: '/work/app', workspaceId: 'w1', excludeTaskIds: [], resume: false },
          null
        )
        const link = parseConfig(readFileSync(out.env[CONFIG_ENV] ?? '', 'utf8'))
        return {
          base: link?.base,
          grant: mcp.tokens.resolve(link?.authorization.slice('Bearer '.length) ?? '')
        }
      })
      expect(read).toEqual(
        ports.map((port, i) => ({ base: `http://${HOST}:${port}`, grant: { sessionId: `s${i}` } }))
      )
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

  it('the mod’s largest window is main’s largest', () => {
    expect([
      ModMemoryIndexSchema.safeParse(JSON.parse(indexBody(WINDOW_MAX))).success,
      ModMemoryIndexSchema.safeParse(JSON.parse(indexBody(WINDOW_MAX + 1))).success,
      ModMemoryIndexSchema.safeParse(JSON.parse(indexBody(nextWindow(WINDOW_MAX)))).success
    ]).toEqual([true, false, true])
  })

  it('a body with an origin longer than main takes still passes main’s schema', () => {
    const origin = 'o'.repeat(200)
    expect([
      ModMemoryRecallSchema.safeParse(JSON.parse(recallBody(0, origin, 'staging port') ?? ''))
        .success,
      ModMemoryRememberSchema.safeParse(JSON.parse(rememberBody(origin, 'a = b'))).success
    ]).toEqual([true, true])
  })

  it('the mod’s longest folder is main’s longest', () => {
    const longest = `/w/${'a'.repeat(FOLDER_CHARS - 3)}`
    const tooLong = `${longest}a`
    const body = (folder: string): unknown => JSON.parse(atUseBody(0, [folder]))
    expect([
      longest.length,
      ModMemoryAtUseSchema.safeParse(body(longest)).success,
      ModMemoryAtUseSchema.safeParse(body(tooLong)).success,
      foldersFor(`${longest}/x.ts`, [longest], new Set()),
      foldersFor(`${tooLong}/x.ts`, [tooLong, '/w'], new Set())
    ]).toEqual([4096, true, false, [longest], ['/w']])
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

    function addSpecific(key: string, value: string, folder: string): void {
      store.add({
        text: { kind: 'specific', key, value },
        workspaceId: 'w1',
        check: null,
        basis: 'inferred',
        origin: { by: 'agent', sessionId: 's0' },
        meta: {
          folder,
          sessionName: null,
          tagIds: [],
          templateId: null,
          goalId: null,
          taskIds: []
        },
        source: null
      })
    }

    function liveRecall(): MemoryRecall {
      return createMemoryRecall({
        gate: createMemoryGate({
          enabled: () => true,
          store: () => store,
          session: (id) => (id === 's1' ? SESSION : null)
        }),
        tasks: () => null,
        names: { goalName: () => null, tagName: () => null },
        activity: { injected: () => undefined, record: () => undefined },
        operatorOrigins: OPERATOR_ORIGINS,
        now: () => NOW,
        log: () => undefined
      })
    }

    it('every answer main builds passes the mod’s readers', () => {
      addSpecific('staging port', '9281', '/work/app')
      const recall = liveRecall()
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
        { text: expect.stringContaining('- staging port = 9281 ('), folders: [] },
        expect.stringMatching(new RegExp(`^${MEMORY_BLOCK_MARKER.replace(/[()]/g, '\\$&')}`)),
        { ok: true, kind: 'specific', id: stored.rows[0]?.id }
      ])
      expect(stored.rows.map((row) => row.id)).toEqual(['m2'])
    })

    it('the at-use answer for a folder the index named passes the mod’s text reader', () => {
      addSpecific('db port', '5433', '/work/other')
      const recall = liveRecall()
      const grant = { sessionId: 's1' }
      const index = readIndexAnswer(
        JSON.stringify(recall.index(grant, ModMemoryIndexSchema.parse(JSON.parse(indexBody(0)))))
      )
      const folders = foldersFor('/work/other/x.ts', index?.folders ?? [], new Set())
      const answer = recall.atUse(
        grant,
        ModMemoryAtUseSchema.parse(JSON.parse(atUseBody(0, folders)))
      )
      expect([folders, readTextAnswer(JSON.stringify(answer))]).toEqual([
        ['/work/other'],
        `${MEMORY_BLOCK_MARKER} saved for /work/other\n- db port (${formatDay(NOW)}) id=m1`
      ])
    })

    it('the index answer of a session the gate refuses (Memory off) reads as a no', () => {
      const recall = createMemoryRecall({
        gate: () => null,
        tasks: () => null,
        names: { goalName: () => null, tagName: () => null },
        activity: { injected: () => undefined, record: () => undefined },
        operatorOrigins: OPERATOR_ORIGINS,
        now: () => NOW,
        log: () => undefined
      })
      const answer = recall.index(
        { sessionId: 's1' },
        ModMemoryIndexSchema.parse(JSON.parse(indexBody(0)))
      )
      expect([isNotOk(JSON.stringify(answer)), readIndexAnswer(JSON.stringify(answer))]).toEqual([
        true,
        undefined
      ])
    })

    it('a refusal main sends passes the mod’s remember reader', () => {
      const recall = createMemoryRecall({
        gate: () => null,
        tasks: () => null,
        names: { goalName: () => null, tagName: () => null },
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
