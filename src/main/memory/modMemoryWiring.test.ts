// The memory mod's routes as the app wires them (P3-C20): the REAL memory server
// (`createMemoryMcp`), whose `modRoutes` the REAL hook listener serves on an ephemeral port, over
// the real recall service, the real gate and a real `:memory:` store. Proves the routes open with
// the memory server's own tokens only, and that the gate reads Memory and the store per request.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGoalTokens } from '../goals/mcp/goalTokens'
import { createHookServer, type HookServer } from '../hooks/hookServer'
import { MOD_MEMORY_PATHS } from '../hooks/hookContract'
import { createMemoryActivity } from './memoryActivity'
import { openMemoryDb } from './memoryDb'
import { createMemoryMcp, type MemoryMcp } from './memoryLaunch'
import { createMemoryStore, type MemoryStore } from './memoryStore'
import type { MemorySessionMeta } from './memoryTools'

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
const PROMPT = { version: 1, window: 0, origin: 'composer', text: 'which staging port?' }

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})

function openStore(): MemoryStore {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  const store = createMemoryStore({
    db: open.db,
    now: () => NOW,
    newId: () => 'm1',
    report: () => undefined,
    log: () => undefined
  })
  store.add({
    text: { kind: 'specific', key: 'staging port', value: '9281' },
    workspaceId: 'w1',
    check: null,
    basis: 'inferred',
    origin: { by: 'agent', sessionId: 's0' },
    meta: {
      folder: null,
      sessionName: null,
      tagIds: [],
      templateId: null,
      goalId: null,
      taskIds: []
    },
    source: null
  })
  return store
}

interface Rig {
  memoryMcp: MemoryMcp
  setEnabled: (on: boolean) => void
  base: string
}

function start(store: MemoryStore | null): Promise<Rig> {
  const userData = mkdtempSync(join(tmpdir(), 'cw-modmem-'))
  cleanups.push(() => rmSync(userData, { recursive: true, force: true }))
  let enabled = true
  const memoryMcp = createMemoryMcp({
    dir: () => userData,
    report: () => undefined,
    enabled: () => enabled,
    store: () => store,
    session: (id) => (id === 's1' ? SESSION : null),
    names: {
      tagIdsByName: () => [],
      tagName: () => null,
      goalIdsByName: () => [],
      goalName: () => null
    },
    tasks: () => null,
    commands: () => null,
    activity: createMemoryActivity(),
    now: () => NOW,
    log: () => undefined
  })
  return new Promise((resolve) => {
    const server: HookServer = createHookServer({
      onHookEvent: () => undefined,
      log: () => undefined,
      tokenRoutes: memoryMcp.modRoutes,
      port: 0,
      host: '127.0.0.1',
      onListening: (port) => {
        cleanups.push(() => server.close())
        resolve({
          memoryMcp,
          setEnabled: (on) => {
            enabled = on
          },
          base: `http://127.0.0.1:${port}`
        })
      }
    })
  })
}

async function recall(rig: Rig, token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${rig.base}${MOD_MEMORY_PATHS.recall}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(PROMPT)
  })
  return { status: res.status, body: res.status === 200 ? await res.json() : null }
}

describe('the memory mod routes as the app wires them', () => {
  it('a memory token of a live session gets 200 with the saved item that matches its prompt', async () => {
    const rig = await start(openStore())
    const token = rig.memoryMcp.tokens.mint({ sessionId: 's1' })
    expect(await recall(rig, token)).toEqual({
      status: 200,
      body: { ok: true, text: expect.stringContaining('- staging port: 9281 (') }
    })
  })

  it('a goals token for the same session gets 401', async () => {
    const rig = await start(openStore())
    const goalsToken = createGoalTokens().mint({
      sessionId: 's1',
      workspaceId: 'w1',
      mode: 'worker'
    })
    expect(await recall(rig, goalsToken)).toEqual({ status: 401, body: null })
  })

  it('Memory switched off answers the next request not ok, and switched on again answers it', async () => {
    const rig = await start(openStore())
    const token = rig.memoryMcp.tokens.mint({ sessionId: 's1' })
    rig.setEnabled(false)
    const off = await recall(rig, token)
    rig.setEnabled(true)
    const on = await recall(rig, token)
    expect([off, on]).toEqual([
      { status: 200, body: { ok: false } },
      { status: 200, body: { ok: true, text: expect.stringContaining('- staging port: 9281 (') } }
    ])
  })

  it('with no store open the request is answered not ok', async () => {
    const rig = await start(null)
    const token = rig.memoryMcp.tokens.mint({ sessionId: 's1' })
    expect(await recall(rig, token)).toEqual({ status: 200, body: { ok: false } })
  })
})
