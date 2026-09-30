// Card shell pane (spec 2026-09-30) — the main-side companion registry (main-unit / node).
// A companion is the plain `$SHELL` that runs beside an app-launched terminal in ITS folder.
// Main owns the folder (the launch recipe); the renderer only names the parent terminal.
import { describe, it, expect, vi } from 'vitest'
import {
  companionTerminalId,
  createShellCompanionRegistry,
  SHELL_COMPANION_SUFFIX,
  spawnForOpen,
  isOrphanCompanionId,
  stopCompanionAfterParentStop,
  type CompanionRecipeSource,
  type ShellCompanionRegistry
} from './shellCompanion'
import type { StoppableTerminalManager } from './launchRemoval'

const CWD = '/home/op/proj'

function fakeManager(): StoppableTerminalManager & { live: Set<string>; stops: string[] } {
  const live = new Set<string>()
  const stops: string[] = []
  return {
    live,
    stops,
    has: (id) => live.has(id),
    stop: (id) => {
      stops.push(id)
      live.delete(id)
    }
  }
}

function recipes(map: Record<string, string>): CompanionRecipeSource {
  return { peekSpawnOverride: (id) => (id in map ? { cwd: map[id] as string } : null) }
}

function make(opts: { dirs?: string[]; overrides?: Record<string, string> } = {}): {
  registry: ShellCompanionRegistry
  manager: ReturnType<typeof fakeManager>
  log: ReturnType<typeof vi.fn>
} {
  const manager = fakeManager()
  const log = vi.fn()
  const registry = createShellCompanionRegistry({
    launch: recipes(opts.overrides ?? { 'launch-1': CWD }),
    isDirectory: (p) => (opts.dirs ?? [CWD]).includes(p),
    manager,
    log
  })
  return { registry, manager, log }
}

describe('companionTerminalId', () => {
  it('is the parent id plus the suffix', () => {
    expect(SHELL_COMPANION_SUFFIX).toBe(':shell')
    expect(companionTerminalId('launch-1')).toBe('launch-1:shell')
  })
})

describe('register', () => {
  it('returns <parent>:shell for a launched parent whose folder exists, idempotently', () => {
    const { registry } = make()
    const first = registry.register('launch-1')
    expect(first).toEqual({ ok: true, terminalId: 'launch-1:shell' })
    expect(registry.register('launch-1')).toEqual(first)
    expect(registry.size()).toBe(1)
  })
  it('refuses terminal_not_found for a parent with no launch recipe (a plain shell, an unknown id)', () => {
    const { registry } = make()
    expect(registry.register('host-shell')).toEqual({ ok: false, code: 'terminal_not_found' })
    expect(registry.size()).toBe(0)
  })
  it('refuses folder_missing when the recipe folder is gone, and registers nothing', () => {
    const { registry, log } = make({ dirs: [] })
    expect(registry.register('launch-1')).toEqual({ ok: false, code: 'folder_missing' })
    expect(registry.size()).toBe(0)
    // Logged by code only — never the folder.
    const logged = log.mock.calls.flat().join(' ')
    expect(logged).toContain('code=folder_missing')
    expect(logged).not.toContain(CWD)
  })
  it('does NOT re-check the folder for an existing entry (the shell is already running there)', () => {
    let exists = true
    const manager = fakeManager()
    const registry = createShellCompanionRegistry({
      launch: recipes({ 'launch-1': CWD }),
      isDirectory: () => exists,
      manager
    })
    expect(registry.register('launch-1').ok).toBe(true)
    exists = false
    // An EXISTING entry is returned as-is (the shell is already running there); only a NEW
    // registration is refused. This pins the choice.
    expect(registry.register('launch-1').ok).toBe(true)
  })
})

describe('cwdFor', () => {
  it('answers the recipe cwd for the companion id and null for anything else', () => {
    const { registry } = make()
    registry.register('launch-1')
    expect(registry.cwdFor('launch-1:shell')).toBe(CWD)
    expect(registry.cwdFor('launch-1')).toBeNull()
    expect(registry.cwdFor('launch-2:shell')).toBeNull()
  })
})

describe('stopFor', () => {
  it('stops the companion with NO token (unconditional) and drops the entry', () => {
    const { registry, manager } = make()
    registry.register('launch-1')
    manager.live.add('launch-1:shell')
    expect(registry.stopFor('launch-1')).toBe(true)
    expect(manager.stops).toEqual(['launch-1:shell'])
    expect(manager.has('launch-1:shell')).toBe(false)
    expect(registry.size()).toBe(0)
    expect(registry.cwdFor('launch-1:shell')).toBeNull()
  })
  it('is a quiet no-op for a parent with no companion', () => {
    const { registry, manager } = make()
    expect(registry.stopFor('launch-1')).toBe(false)
    expect(manager.stops).toEqual([])
  })
  it('never throws: a manager that throws on stop is contained and logged by code', () => {
    const log = vi.fn()
    const registry = createShellCompanionRegistry({
      launch: recipes({ 'launch-1': CWD }),
      isDirectory: () => true,
      manager: {
        has: () => true,
        stop: () => {
          throw new Error('/secret/path')
        }
      },
      log
    })
    registry.register('launch-1')
    expect(() => registry.stopFor('launch-1')).not.toThrow()
    const logged = log.mock.calls.flat().join(' ')
    expect(logged).toContain('code=companion_stop_failed')
    expect(logged).not.toContain('/secret')
  })
  it('the entry survives a stop of the companion id itself (a shell exit → Restart finds its cwd)', () => {
    const { registry, manager } = make()
    registry.register('launch-1')
    manager.live.add('launch-1:shell')
    manager.stop('launch-1:shell') // the shell's own exit / its frame's unmount-stop
    expect(registry.cwdFor('launch-1:shell')).toBe(CWD) // only stopFor(parent) drops it
  })
})

describe('spawnForOpen — what terminal:open spawns', () => {
  const minted = {
    sessionId: 'uuid-1',
    spawn: { file: 'bash', args: ['-l', '-c', 'claude'], cwd: CWD },
    displayName: 'proj',
    templateId: null,
    initialPrompt: null,
    workspaceId: null,
    launchedAt: 1,
    resume: null
  }
  it('a companion open NEVER calls mintSpawn: no session id, no card, only the cwd override', () => {
    const { registry } = make()
    registry.register('launch-1')
    const mintSpawn = vi.fn(() => minted)
    const out = spawnForOpen('launch-1:shell', { has: () => false }, { mintSpawn }, registry)
    expect(mintSpawn).not.toHaveBeenCalled()
    expect(out.minted).toBeNull()
    expect(out.spawnOverride).toEqual({ cwd: CWD }) // NO file/args: spawnDefaults' $SHELL
  })
  it('a launch open still mints exactly as before (mintForOpen is the decision)', () => {
    const { registry } = make()
    const mintSpawn = vi.fn(() => minted)
    const out = spawnForOpen('launch-1', { has: () => false }, { mintSpawn }, registry)
    expect(mintSpawn).toHaveBeenCalledWith('launch-1')
    expect(out.minted).toBe(minted)
    expect(out.spawnOverride).toBe(minted.spawn)
  })
  it('a re-attach of a LIVE launch terminal mints nothing (Story 5.6 unchanged)', () => {
    const mintSpawn = vi.fn(() => minted)
    const out = spawnForOpen('launch-1', { has: () => true }, { mintSpawn }, null)
    expect(mintSpawn).not.toHaveBeenCalled()
    expect(out).toEqual({ minted: null, spawnOverride: undefined })
  })
  it('a plain-shell id with no registry and no service is the Story-3.1 spawn', () => {
    expect(spawnForOpen('host-1', { has: () => false }, null, null)).toEqual({
      minted: null,
      spawnOverride: undefined
    })
  })
})

describe('stopCompanionAfterParentStop — the parent stop cascades to the shell', () => {
  it('a landed stop of a live parent stops the companion', () => {
    const { registry, manager } = make()
    registry.register('launch-1')
    manager.live.add('launch-1:shell')
    // The parent was live and its stop landed (it is no longer live).
    expect(stopCompanionAfterParentStop('launch-1', true, manager, registry)).toBe(true)
    expect(manager.stops).toEqual(['launch-1:shell'])
  })
  it('a stale-token parent stop keeps the companion (the parent survived the stop)', () => {
    const { registry, manager } = make()
    registry.register('launch-1')
    manager.live.add('launch-1')
    manager.live.add('launch-1:shell')
    // wasLive AND still live ⇒ the manager no-op'd a stale StrictMode cleanup-stop.
    expect(stopCompanionAfterParentStop('launch-1', true, manager, registry)).toBe(false)
    expect(manager.stops).toEqual([])
    expect(registry.size()).toBe(1)
  })
  it('a DEAD parent whose frame unmounts takes its companion with it (dead-pane Resume / switch away)', () => {
    const { registry, manager } = make()
    registry.register('launch-1')
    manager.live.add('launch-1:shell') // the parent claude exited earlier; the shell still runs
    expect(stopCompanionAfterParentStop('launch-1', false, manager, registry)).toBe(true)
    expect(manager.stops).toEqual(['launch-1:shell'])
  })
  it('a stop of a parent with no companion changes nothing', () => {
    const { registry, manager } = make()
    expect(stopCompanionAfterParentStop('launch-1', true, manager, registry)).toBe(false)
    expect(manager.stops).toEqual([])
  })
})

describe('isOrphanCompanionId — a :shell id with no registry entry never spawns', () => {
  it('true for an unregistered companion id (its parent was archived while shell:open was in flight)', () => {
    const { registry } = make()
    registry.register('launch-1')
    registry.stopFor('launch-1') // the archive dropped the entry before the shell's terminal:open
    expect(isOrphanCompanionId('launch-1:shell', registry)).toBe(true)
  })
  it('false for a registered companion, a launch id, a plain-shell id, and a stop by the shell id itself', () => {
    const { registry, manager } = make()
    registry.register('launch-1')
    expect(isOrphanCompanionId('launch-1:shell', registry)).toBe(false)
    expect(isOrphanCompanionId('launch-1', registry)).toBe(false)
    expect(isOrphanCompanionId('host-1', registry)).toBe(false)
    // Review Focus 4 through the REAL path: the terminal:stop handler cascades with the shell's
    // own id, which must not drop its entry (Restart re-opens it).
    manager.live.add('launch-1:shell')
    manager.stop('launch-1:shell')
    stopCompanionAfterParentStop('launch-1:shell', true, manager, registry)
    expect(isOrphanCompanionId('launch-1:shell', registry)).toBe(false)
    expect(registry.cwdFor('launch-1:shell')).toBe(CWD)
  })
  it('true with no registry at all (an open racing app-ready)', () => {
    expect(isOrphanCompanionId('launch-1:shell', null)).toBe(true)
  })
})

describe('terminalIds — the live companion ids (for the rebind disproof)', () => {
  it('lists every registered companion and drops a stopped one', () => {
    const { registry } = make({ overrides: { 'launch-1': CWD, 'launch-2': CWD } })
    registry.register('launch-1')
    registry.register('launch-2')
    expect([...registry.terminalIds()].sort()).toEqual(['launch-1:shell', 'launch-2:shell'])
    registry.stopFor('launch-1')
    expect([...registry.terminalIds()]).toEqual(['launch-2:shell'])
  })
})
