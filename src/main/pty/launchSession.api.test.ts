// launchSession tests, part 3: what the programmatic API and past sessions add to the launch
// recipe. `main-unit` project (node). Covered: the initial prompt and the workspace ride the
// durable recipe; awaitBinding; resume launches and launchedAt.
import { describe, it, expect, vi, type Mock } from 'vitest'
import { createLaunchService, NO_LAUNCH_FLAGS, type LaunchService } from './launchSession'
import { createLaunchedSet } from './launchedSet'

// Programmatic API — the HTTP command that creates a card from a template supplies TWO values
// the in-app flows never do: the expanded initial prompt claude must start with, and the
// workspace the card must land in (the template's own scope, which need not be the workspace
// the operator happens to be looking at). Both ride the DURABLE override beside `cwd` / `name` /
// `flags`, for the same reason those do: they are per-terminal launch-recipe values, set once at
// launch and read on EVERY spawn of that terminal — so a Reopen re-runs the same prompt in the
// same workspace instead of degrading to a bare `claude` in whatever workspace is active now.
/** A launch service whose spawn factory is a SPY, so a test can assert exactly what the recipe
 *  handed it. Deterministic ids. */
function makeService(): { svc: LaunchService; spawn: Mock } {
  const spawn = vi.fn(() => ({ file: '/bin/bash', args: ['-l', '-c', 'claude'] }))
  const svc = createLaunchService({
    launchedSet: createLaunchedSet(),
    isDirectory: () => true,
    spawn,
    newTerminalId: () => 't-1',
    newSessionId: () => 'sess-1'
  })
  return { svc, spawn }
}

describe('programmatic API — the initial prompt and the workspace ride the recipe', () => {
  it('launch() without them stores null for both (UI launches unchanged)', () => {
    const { svc } = makeService()
    svc.launch({ cwd: '/w', name: 'n' })
    expect(svc.peekSpawnOverride('t-1')).toMatchObject({ initialPrompt: null, workspaceId: null })
  })

  it('mintSpawn hands the prompt to the spawn factory as its 4th argument and echoes both back', () => {
    const { svc, spawn } = makeService()
    svc.launch({ cwd: '/w', name: 'n', initialPrompt: 'do HT-1', workspaceId: 'ws-9' })
    const minted = svc.mintSpawn('t-1')
    expect(spawn).toHaveBeenCalledWith('sess-1', 'n', NO_LAUNCH_FLAGS, 'do HT-1', false)
    expect(minted?.initialPrompt).toBe('do HT-1')
    expect(minted?.workspaceId).toBe('ws-9')
  })

  it('a Reopen re-runs the same prompt (the override is the durable recipe)', () => {
    const { svc, spawn } = makeService()
    svc.launch({ cwd: '/w', name: 'n', initialPrompt: 'do HT-1' })
    svc.mintSpawn('t-1')
    svc.mintSpawn('t-1')
    expect(spawn).toHaveBeenLastCalledWith('sess-1', 'n', NO_LAUNCH_FLAGS, 'do HT-1', false)
  })
})

// Programmatic API — the HTTP command is synchronous to its caller but the spawn is NOT: main
// registers the recipe and the RENDERER opens the terminal, which is what mints the session id.
// `awaitBinding` is how the command waits for that id (the value the caller is told) without
// polling, and how it gives up if the renderer never opens the terminal at all.
describe('programmatic API — awaitBinding', () => {
  it('resolves with the session id when mintSpawn binds the terminal', async () => {
    const { svc } = makeService()
    svc.launch({ cwd: '/w', name: 'n' })
    const p = svc.awaitBinding('t-1', 1000)
    svc.mintSpawn('t-1')
    await expect(p).resolves.toBe('sess-1')
  })

  it('resolves at once when the binding already exists', async () => {
    const { svc } = makeService()
    svc.launch({ cwd: '/w', name: 'n' })
    svc.mintSpawn('t-1')
    await expect(svc.awaitBinding('t-1', 1000)).resolves.toBe('sess-1')
  })

  it('rejects with code spawn_timeout when nothing binds in time', async () => {
    vi.useFakeTimers()
    try {
      const { svc } = makeService()
      svc.launch({ cwd: '/w', name: 'n' })
      const p = svc.awaitBinding('t-1', 50)
      const assertion = expect(p).rejects.toThrow('spawn_timeout')
      await vi.advanceTimersByTimeAsync(60)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('a timed-out waiter is dropped: a later mint does not call it', async () => {
    vi.useFakeTimers()
    const cleared = vi.spyOn(globalThis, 'clearTimeout')
    try {
      const { svc } = makeService()
      svc.launch({ cwd: '/w', name: 'n' })
      const p = svc.awaitBinding('t-1', 50).catch(() => 'timed out')
      await vi.advanceTimersByTimeAsync(60)

      // NOT a vacuous assertion — and the outcome below cannot carry this on its own: a promise
      // that has already rejected SWALLOWS a late resolve(), so "still rejected" holds whether
      // the waiter was dropped or merely inert. The dropped-ness is observable through the dead
      // waiter's FIRST act, clearTimeout(timer): if the mint can still reach it, this fires.
      // (Verified by fault injection — deleting the drop in awaitBinding turns THIS red.)
      cleared.mockClear()
      svc.mintSpawn('t-1')
      expect(cleared).not.toHaveBeenCalled()

      await expect(p).resolves.toBe('timed out')
    } finally {
      cleared.mockRestore()
      vi.useRealTimers()
    }
  })
})

// Past sessions (D-1) — a LaunchRequest carrying `resumeSessionId` mints THAT id instead of a
// fresh one, spawns with `resume: true` (claudeBin.ts composes the `--resume <id>` form, dropping
// `-n`/the template flags/the positional prompt), and is born with the archive record's surviving
// tags rather than running the launch rules. `launchedAt` (epoch millis at `launch()`) rides every
// mint — a normal launch too — so `launchSynthesis.ts` can stamp the card with it.
describe('past sessions — resume and launchedAt', () => {
  it('a resume launch mints THAT id, spawns with resume=true, and keeps it for a Reopen', () => {
    const launchedSet = createLaunchedSet()
    const spawn = vi.fn(() => ({ file: 'sh' }))
    const svc = createLaunchService({
      launchedSet,
      isDirectory: () => true,
      spawn,
      newTerminalId: () => 't1',
      newSessionId: () => 'fresh',
      now: () => 777
    })
    const { terminalId } = svc.launch({
      cwd: '/c',
      name: 'old name',
      resumeSessionId: 'sess-A',
      tagIds: ['t1']
    })
    const first = svc.mintSpawn(terminalId)
    expect(first?.sessionId).toBe('sess-A')
    expect(first?.resume).toEqual({ sessionId: 'sess-A', tagIds: ['t1'] })
    expect(first?.launchedAt).toBe(777)
    expect(spawn).toHaveBeenLastCalledWith('sess-A', 'old name', NO_LAUNCH_FLAGS, null, true)
    expect(launchedSet.has('sess-A')).toBe(true)
    // A dead-pane Reopen re-resumes the SAME conversation, never a fresh id.
    expect(svc.mintSpawn(terminalId)?.sessionId).toBe('sess-A')
  })

  // `/clear` inside a resumed session moves claude to a NEW id; the card follows (adoptCard →
  // rebind) and is archived under it. A Reopen that still resumed the pre-clear id would put a
  // second id on one conversation and bring back the conversation from before the clear.
  it('a /clear rebind moves the resume id too, so a dead-pane Reopen resumes the NEW id', () => {
    const spawn = vi.fn(() => ({ file: 'sh' }))
    const svc = createLaunchService({
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn,
      newTerminalId: () => 't1',
      newSessionId: () => 'fresh',
      now: () => 777
    })
    const { terminalId } = svc.launch({
      cwd: '/c',
      name: 'old name',
      resumeSessionId: 'sess-A',
      tagIds: ['t1']
    })
    svc.mintSpawn(terminalId)

    svc.rebind(terminalId, 'sess-B') // /clear
    svc.unbind(terminalId) // the pty exits (the card is archived under sess-B)
    const reopened = svc.mintSpawn(terminalId)

    expect(reopened?.sessionId).toBe('sess-B')
    expect(reopened?.resume).toEqual({ sessionId: 'sess-B', tagIds: ['t1'] })
    expect(spawn).toHaveBeenLastCalledWith('sess-B', 'old name', NO_LAUNCH_FLAGS, null, true)
  })

  // R3: a resume now passes `-n <name>`, so the name it passes must be the one the card LAST had.
  // The recipe's name is frozen at Open; a rename (in-app, or claude's own `/rename` read back)
  // made in the resumed run lives only in the card and its past-sessions record. A dead-pane
  // Reopen that passed the frozen name would rename claude BACK.
  it('a resume spawns with the name the card last had (resumeName), not the frozen recipe name', () => {
    const spawn = vi.fn(() => ({ file: 'sh' }))
    const names = new Map<string, string>([['sess-A', 'renamed later']])
    const svc = createLaunchService({
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn,
      newTerminalId: () => 't1',
      newSessionId: () => 'fresh',
      now: () => 777,
      resumeName: (id) => names.get(id) ?? null
    })
    const { terminalId } = svc.launch({ cwd: '/c', name: 'old name', resumeSessionId: 'sess-A' })

    const minted = svc.mintSpawn(terminalId)

    expect(spawn).toHaveBeenLastCalledWith('sess-A', 'renamed later', NO_LAUNCH_FLAGS, null, true)
    expect(minted?.displayName).toBe('renamed later') // the card is born with the same name

    names.clear() // no record (hidden, or never written) → the recipe's name
    svc.mintSpawn(terminalId)
    expect(spawn).toHaveBeenLastCalledWith('sess-A', 'old name', NO_LAUNCH_FLAGS, null, true)
  })

  it('a FRESH launch never consults resumeName', () => {
    const spawn = vi.fn(() => ({ file: 'sh' }))
    const resumeName = vi.fn(() => 'wrong')
    const svc = createLaunchService({
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn,
      newTerminalId: () => 't1',
      newSessionId: () => 'fresh',
      now: () => 777,
      resumeName
    })
    const { terminalId } = svc.launch({ cwd: '/c', name: 'typed' })
    svc.mintSpawn(terminalId)
    expect(resumeName).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenLastCalledWith('fresh', 'typed', NO_LAUNCH_FLAGS, null, false)
  })

  it('a /clear rebind never turns a FRESH launch into a resume', () => {
    let s = 0
    const svc = createLaunchService({
      launchedSet: createLaunchedSet(),
      isDirectory: () => true,
      spawn: vi.fn(() => ({ file: 'sh' })),
      newTerminalId: () => 't2',
      newSessionId: () => `fresh-${++s}`,
      now: () => 5
    })
    const { terminalId } = svc.launch({ cwd: '/c', name: 'n' })
    svc.mintSpawn(terminalId)
    svc.rebind(terminalId, 'sess-B')

    expect(svc.peekSpawnOverride(terminalId)?.resume).toBeNull()
    expect(svc.mintSpawn(terminalId)?.sessionId).toBe('fresh-2')
  })

  it('a normal launch is unchanged: fresh id, resume=false, resume null on the mint', () => {
    const launchedSet = createLaunchedSet()
    const spawn = vi.fn(() => ({ file: 'sh' }))
    const svc = createLaunchService({
      launchedSet,
      isDirectory: () => true,
      spawn,
      newTerminalId: () => 't2',
      newSessionId: () => 'fresh',
      now: () => 5
    })
    const { terminalId } = svc.launch({ cwd: '/c', name: 'n' })
    const minted = svc.mintSpawn(terminalId)
    expect(minted?.sessionId).toBe('fresh')
    expect(minted?.resume).toBeNull()
    expect(minted?.launchedAt).toBe(5)
    expect(spawn).toHaveBeenLastCalledWith('fresh', 'n', NO_LAUNCH_FLAGS, null, false)
    expect(svc.peekSpawnOverride(terminalId)?.launchedAt).toBe(5)
  })
})
