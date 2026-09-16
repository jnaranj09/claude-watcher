// Programmatic API — the test doubles every command + server test builds its world from.
//
// NOT a `.test.ts` on purpose: a test file is not importable from another test file, and these
// doubles are shared by the command tests (Task 11), the server tests (Task 12) and the SSE tests
// (Task 13). It sits in the main tree so it typechecks under the same strict program as the code
// it doubles, and nothing in `src/main` imports it — the bundler's graph starts at `index.ts`, so
// it never reaches a build. (`src/__fixtures__/` is a separate top-level tree for the hook feed;
// it is not the precedent for a main-side double.)
//
// The fakes are DUMB on purpose: they hold arrays and hand them back. A command test that has to
// teach its double how to behave is testing the double.
import type { ApiSession } from '../../shared/schemas/api'
import type { Template } from '../../shared/schemas/template'
import type { Workspace } from '../../shared/schemas/workspace'
import type { LaunchRequest } from '../pty/launchSession'
import type { ApiContext } from './registry'
import { createApiEventHub, type ApiSeam, type ApiSessionEvent } from './apiSeam'

export interface FakeSeam extends ApiSeam {
  sessions: ApiSession[]
  launches: LaunchRequest[]
  emit(event: ApiSessionEvent): void
  /** The session id awaitSessionId resolves with; null ⇒ reject spawn_timeout. */
  nextSessionId: string | null
  /** Live `onEvent` subscriptions. An SSE stream that drops its unsubscribe leaks HERE and
   *  nowhere else (a send on a dead sink is a silent no-op), so Task 13 asserts on it. */
  subscriberCount(): number
}

export function makeFakeSeam(sessions: ApiSession[] = []): FakeSeam {
  const hub = createApiEventHub(() => {})
  let subscribers = 0
  const seam: FakeSeam = {
    sessions,
    launches: [],
    nextSessionId: 'sess-1',
    emit: (e) => hub.emit(e),
    listSessions: () => [...seam.sessions],
    getSession: (id) => seam.sessions.find((s) => s.id === id) ?? null,
    subscriberCount: () => subscribers,
    onEvent: (cb) => {
      subscribers++
      const off = hub.onEvent(cb)
      // Idempotent: a double-unsubscribe must not drive the count negative, or a leak test
      // could be "passed" by unsubscribing twice.
      let done = false
      return () => {
        if (done) return
        done = true
        subscribers--
        off()
      }
    },
    requestLaunch: (req) => {
      seam.launches.push(req)
      return { terminalId: 'term-1', workspaceId: req.workspaceId ?? 'default' }
    },
    awaitSessionId: () =>
      seam.nextSessionId === null
        ? Promise.reject(new Error('spawn_timeout'))
        : Promise.resolve(seam.nextSessionId)
  }
  return seam
}

export interface FakeContextSeed {
  /** `null` ⇒ no window: `ctx.seam()` returns null and every command answers 503 `no_window`. */
  seam: FakeSeam | null
  templates: Template[]
  workspaces: Workspace[]
  activeWorkspaceId: string
  claudeOk: boolean
}

export function makeFakeContext(over: Partial<FakeContextSeed> = {}): {
  ctx: ApiContext
  seam: FakeSeam | null
  log: string[]
} {
  // `?? makeFakeSeam()` would be wrong here: an EXPLICIT `seam: null` is the no-window case a
  // test is asking for, not an omission to be defaulted away.
  const seam = over.seam === undefined ? makeFakeSeam() : over.seam
  const templates = over.templates ?? []
  const workspaces = over.workspaces ?? []
  const log: string[] = []
  const ctx: ApiContext = {
    seam: () => seam,
    templates: { get: (id) => templates.find((t) => t.id === id) ?? null },
    workspaces: {
      activeId: () => over.activeWorkspaceId ?? 'default',
      get: (id) => workspaces.find((w) => w.id === id) ?? null
    },
    claudeVersionAllowsLaunch: () => over.claudeOk ?? true,
    now: () => 1000,
    spawnTimeoutMs: 50,
    log: (m) => log.push(m)
  }
  return { ctx, seam, log }
}
