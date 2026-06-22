// Story 0.5 — the LIVE c9watch contract test (the two-part DRIFT ALARM).
//
// Project: `main-unit` (environment: 'node') — matches the `src/main/**/*.test.ts`
// glob in vitest.config.ts. node env is REQUIRED: this test spawns the REAL
// `c9watch` CLI via `child_process` (Linux-only `/usr/bin/env`-style PATH resolve).
//
// THIS IS THE ONLY FILE STORY 0.5 CREATES UNDER `src/main/c9watch/`. It builds NO
// feed/reducer/reconnect/snapshot module — those are Epic-1 Story 1.1. The directory
// exists only to hold this drift alarm at its eventual home (the 0.4 pattern: author
// a probe test at its destination without wiring it into the app).
//
// TWO complementary alarms, exactly as AC-4 / AC-5 demand:
//   ALARM 1 (schema)  — parse REAL `c9watch list` + a REAL `c9watch watch` line
//                       through the production Zod schemas. If reality drifts from
//                       the schema, the parse THROWS → the test FAILS LOUDLY.
//   ALARM 2 (version) — assert the live `c9watch --version` still matches the pinned
//                       `C9WATCH_FIXTURE_VERSION` ('0.8.1'). A bump FAILS LOUDLY →
//                       a human re-runs the characterization for the new version.
//
// Critical guardrails (load-bearing):
//   - READ-ONLY c9watch ONLY: `--version`, `list`, a SHORT bounded `watch`. NEVER
//     `stop`/`spawn`/`send`/`adopt` (those mutate/kill sessions).
//   - NEVER log a parsed value, even on failure. Live sessions carry prompt text /
//     PTY content / secrets in `firstPrompt`/`latestMessage`/`pendingToolInput.prompt`.
//     On a drift failure we assert on `error.issues[].path`/`.code` ONLY — we never
//     dump the raw session. (.claude/rules/zod-boundaries.md#Never-log)
//   - REAP every spawned process on every exit path: bounded + `detached` spawn +
//     SIGKILL the whole process group in `finally`/`afterEach`. A `watch` child left
//     running is the classic orphan hazard (the 0.1 + 0.4 lesson).
//   - SKIP CLEAN when the live system is absent: non-Linux OR no `c9watch` on PATH
//     OR version != pin → `describe.skip`/early-return so CI/other machines stay green.
//   - DETERMINISTIC across session count: parses `{diagnostics, sessions:[]}` on an
//     empty machine; asserts per-session shape only when sessions.length > 0; treats
//     a quiet `watch` window (no line) as acceptable.
//
// [Source: epics.md#Story 0.5 AC-4/AC-5; vitest.config.ts (main-unit/node, glob
//  src/main/**/*.test.ts); src/main/pty/pidCorrelation.test.ts (the Linux-gate +
//  detached-spawn + SIGKILL-process-group + skip-clean template); c9watch-0.8.1-
//  contract.md; .claude/rules/zod-boundaries.md]
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import type { z } from 'zod'
import {
  ListEnvelopeSchema,
  WatchLineSchema,
  parseListKeyedById
} from '../../shared/schemas/session'
import { C9WATCH_FIXTURE_VERSION } from '../../__fixtures__/fakeC9watchFeed'

// ─────────────────────────────────────────────────────────────────────────────
// GATING — the suite must stay green on CI / non-Linux / no-c9watch / wrong version.
// ─────────────────────────────────────────────────────────────────────────────
const onLinux = process.platform === 'linux'

/** Resolve `c9watch --version` stdout (read-only). Returns the trimmed version
 *  string (e.g. `c9watch 0.8.1`) or undefined if the binary is absent/unrunnable. */
function readC9watchVersion(): string | undefined {
  try {
    return execFileSync('c9watch', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return undefined // not on PATH / not runnable → caller skips
  }
}

const liveVersion = onLinux ? readC9watchVersion() : undefined
const pinnedVersionLine = `c9watch ${C9WATCH_FIXTURE_VERSION}`

// ─────────────────────────────────────────────────────────────────────────────
// STATUS-ENUM-SURFACE TRIPWIRE (added during Story 1.2 rework) — the spike's
// original blind spot. The binary status enum (c9watch 0.8.1, unstripped Rust ELF)
// is `Working` / `NeedsAttention` / `WaitingForInput` / `Connecting`; `NeedsPermission`
// is help-listed/uncertain (may be a distinct status OR only the `status` command's
// `needsPermission[]` array). This KNOWN set is the TEST-ONLY tripwire: a live status
// outside it FAILS LOUDLY so a human re-characterizes (and re-checks the column
// mapping in c9watch-0.8.1-contract.md §4). It is DELIBERATELY NOT a runtime enum:
// `src/shared/schemas/session.ts` keeps `status: z.string()` so a brand-new status
// PASSES (mapping to needs-you, fail-toward-attention) instead of fail-closing the
// session. Status NAMES are c9watch enum tokens — safe to log; they are NOT session
// content (firstPrompt/latestMessage/pendingToolInput stay never-logged).
// [Source: c9watch-0.8.1-contract.md §4 (binary enum + authoritative mapping);
//  .claude/rules/zod-boundaries.md (don't enum-lock status in the runtime schema)]
const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  'Working',
  'NeedsAttention',
  'WaitingForInput',
  'NeedsPermission',
  'Connecting'
])
// Gate on PRESENCE only (not on version match) so a VERSION DRIFT still RUNS and
// FAILS LOUDLY in Alarm 2 (skipping on mismatch would silence the very drift we
// want to catch). We only skip when c9watch is entirely absent / non-Linux.
const c9watchPresent = onLinux && liveVersion !== undefined
const describeLive = c9watchPresent ? describe : describe.skip

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — read-only spawns, structural assertions, NEVER-log-the-value.
// ─────────────────────────────────────────────────────────────────────────────

/** Run a read-only c9watch command and return raw stdout. Throws on non-zero exit;
 *  callers convert a throw into a loud test failure (path+code only). */
function runC9watch(args: readonly string[], timeoutMs = 8000): string {
  return execFileSync('c9watch', [...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore']
  })
}

/** Format a ZodError as a DRIFT REPORT carrying ONLY path + code per issue — NEVER
 *  the parsed value (which can leak prompts/PTY content). This is the loud-failure
 *  message; it is intentionally value-free. */
function driftReport(error: z.ZodError): string {
  return JSON.stringify(error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })))
}

/** Assert a Zod parse SUCCEEDS; on drift, fail LOUDLY with path+code only (never
 *  the parsed value). Returns the validated data on success. */
function parseOrDrift<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const r = schema.safeParse(raw)
  if (!r.success) {
    throw new Error(`c9watch ${C9WATCH_FIXTURE_VERSION} DRIFT [${label}]: ${driftReport(r.error)}`)
  }
  return r.data
}

/** Parse JSON from a live c9watch stream WITHOUT ever leaking its content. A bare
 *  `JSON.parse` of a malformed live line throws a V8 `SyntaxError` whose message can
 *  EMBED a window of the raw input (e.g. `Unexpected token 'S', "...SECRET..." is not
 *  valid JSON`) — and a live line carries `firstPrompt`/`pendingToolInput.prompt`
 *  (PTY content / secrets). So we catch it and rethrow a VALUE-FREE drift error
 *  (`code: invalid_json`), mirroring the JSON boundary in fakeC9watchFeed.test.ts.
 *  This keeps the never-log-the-parsed-value guarantee on the JSON-syntax drift
 *  path too — not just the schema-drift path. [.claude/rules/zod-boundaries.md#Never-log] */
function parseJsonOrDrift(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // NEVER include `raw` or the SyntaxError message — path+code only.
    const report = '[{"path":"(line)","code":"invalid_json"}]'
    throw new Error(`c9watch ${C9WATCH_FIXTURE_VERSION} DRIFT [${label}]: ${report}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC DRIFT ALARM — Story 5.2 (no live gate; runs everywhere).
//
// The original Story-0.5 alarm had a blind spot: `c9watch watch --changes-only`
// on a quiet box emits NOTHING in the bounded window, so the live watch-line
// alarm never exercised a real `status_changed` line. This deterministic
// assertion closes that gap: it parses an INLINE fixture modeled on the real
// c9watch 0.8.1 `status_changed` line shape through the PRODUCTION
// `WatchLineSchema` — so a future event-value drift (e.g. the enum reverts to
// `"changed"`) fails LOUDLY here even on a quiet/non-Linux box.
// Honor never-log-the-parsed-value: value-free helpers only (path+code on drift).
// [Source: Story 5.2 AC#4; .claude/rules/zod-boundaries.md (never-log-the-value)]
// ─────────────────────────────────────────────────────────────────────────────
describe('DETERMINISTIC drift alarm — status_changed watch-line shape (Story 5.2)', () => {
  it('an inline status_changed-shaped fixture parses cleanly through WatchLineSchema (AC#4)', () => {
    // Inline fixture modeled on the real c9watch 0.8.1 watch NDJSON line shape.
    // The sessionId and session.id MUST match (R3 guard is upstream in the reducer;
    // the schema itself does not enforce it — but we use a valid inline fixture
    // to prove the SCHEMA accepts the event value, not just the reducer routing).
    const fixtureId = 'a1b2c3d4-0000-4000-8000-000000000001'
    const rawFixture: unknown = {
      event: 'status_changed',
      sessionId: fixtureId,
      timestamp: '2026-06-22T10:00:00.000+00:00',
      session: {
        id: fixtureId,
        status: 'Working',
        projectPath: '/home/user/projects/test',
        pid: 12345,
        sessionName: 'test-session'
      }
    }
    // parseOrDrift reports path+code only on drift — NEVER the fixture value.
    const line = parseOrDrift(WatchLineSchema, rawFixture, 'status_changed-fixture')
    expect(line.event).toBe('status_changed')
    expect(typeof line.sessionId).toBe('string')
    expect(typeof line.timestamp).toBe('number') // ISO+tz coerced to epoch-millis
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describeLive('LIVE c9watch contract — the two-part drift alarm (Story 0.5)', () => {
  // Every spawned `watch` process group, killed whole on every path (no orphans).
  const groups: number[] = []

  function killGroup(pgid: number): void {
    try {
      // Negative pid = the whole process group (the detached c9watch watch child).
      process.kill(-pgid, 'SIGKILL')
    } catch {
      // group already gone — fine
    }
  }

  afterEach(() => {
    for (const pgid of groups) killGroup(pgid)
    groups.length = 0
  })

  // ── ALARM 2 (version) ──────────────────────────────────────────────────────
  it('ALARM 2 (version tripwire): live `c9watch --version` matches the pinned version', () => {
    // Single source of truth: C9WATCH_FIXTURE_VERSION — no second hardcoded '0.8.1'.
    // A version bump FAILS LOUDLY → the human re-runs the characterization. We
    // compare the version SEMVER token only (the version string is non-sensitive).
    expect(liveVersion).toBeDefined()
    expect(liveVersion).toBe(pinnedVersionLine)
  })

  // ── ALARM 1 (schema) — list ────────────────────────────────────────────────
  it('ALARM 1 (schema tripwire): real `c9watch list` parses through ListEnvelopeSchema', () => {
    const raw: unknown = parseJsonOrDrift(runC9watch(['list']), 'list-json')
    // The envelope MUST parse (wrapper present, sessions an array) even on an empty
    // machine — zero sessions returns { diagnostics, sessions: [] }. parseOrDrift
    // reports path+code only on drift; it NEVER dumps the parsed session value.
    const envelope = parseOrDrift(ListEnvelopeSchema, raw, 'list')

    // Structural assertions ONLY — never assert on a parsed session VALUE.
    expect(Array.isArray(envelope.sessions)).toBe(true)
    expect(typeof envelope.diagnostics.fdaLikelyNeeded).toBe('boolean')

    // Keying by id must not throw (no duplicate ids; blank id would have failed the
    // schema). Deterministic on session count: holds for sessions.length === 0 too.
    const { sessionsById } = parseListKeyedById(raw)
    expect(sessionsById.size).toBe(envelope.sessions.length)

    // Per-session shape is asserted ONLY when sessions exist (empty machine = pass).
    if (envelope.sessions.length > 0) {
      for (const session of envelope.sessions) {
        // Identity + pid invariants (structural — no value dumped):
        expect(typeof session.id).toBe('string')
        expect(session.id.length).toBeGreaterThan(0)
        expect(Number.isInteger(session.pid)).toBe(true)
        expect(session.pid).toBeGreaterThanOrEqual(0)
        // STATUS-ENUM-SURFACE TRIPWIRE: status must be within the KNOWN set. An
        // unexpected value FAILS LOUDLY with the status NAME (a c9watch enum token —
        // safe to log, NOT session content) so a human re-characterizes the surface +
        // re-checks the column mapping (contract §4). This is TEST-ONLY: the runtime
        // schema keeps `status: z.string()` (no enum lock; a new status → needs-you).
        if (!KNOWN_STATUSES.has(session.status)) {
          throw new Error(
            `c9watch ${C9WATCH_FIXTURE_VERSION} STATUS DRIFT: unexpected session status ` +
              `"${session.status}" not in known set ` +
              `{${[...KNOWN_STATUSES].join(', ')}} — re-characterize the status surface ` +
              `and the column mapping in c9watch-0.8.1-contract.md §4. ` +
              `(status NAME logged intentionally; it is a c9watch enum token, not session content)`
          )
        }
        // `modified` is parse-once-coerced to an epoch-millis NUMBER when present
        // (proves the dual ns/ms ISO+tz precision validated and transformed).
        if (session.modified !== undefined) {
          expect(typeof session.modified).toBe('number')
        }
        // `pendingToolInput` is polymorphic (string | object) when present — never
        // narrowed. We assert the TYPE shape, never the content.
        if (session.pendingToolInput !== undefined) {
          const t = typeof session.pendingToolInput
          expect(t === 'string' || t === 'object').toBe(true)
        }
      }
    }
  })

  // ── ALARM 1 (schema) — watch line ──────────────────────────────────────────
  it('ALARM 1 (schema tripwire): a real `c9watch watch` NDJSON line parses through WatchLineSchema (or quiet-window skip)', async () => {
    // Spawn a SHORT, BOUNDED, READ-ONLY `watch` (with the initial `started` burst so
    // we get a line when sessions exist). detached → its own process group for a
    // whole-group reap. We capture the FIRST complete NDJSON line, then kill the group.
    const child = spawn('c9watch', ['watch'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true
    })
    const pid = child.pid
    expect(pid).toBeTypeOf('number')
    if (pid === undefined) return
    groups.push(pid) // detached → pid is its own pgid; afterEach SIGKILLs the group

    const firstLine = await new Promise<string | undefined>((resolve) => {
      let buffer = ''
      let settled = false
      const finish = (line: string | undefined): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        killGroup(pid) // reap immediately; afterEach is the belt-and-suspenders
        resolve(line)
      }
      // Bounded window: a quiet machine may emit nothing — that is ACCEPTABLE
      // (deterministic, not flaky). 6s is ample for the `started` burst when
      // sessions exist (interval default is 2s).
      const timer = setTimeout(() => finish(undefined), 6000)
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const newlineAt = buffer.indexOf('\n')
        if (newlineAt !== -1) {
          finish(buffer.slice(0, newlineAt))
        }
      })
      child.on('error', () => finish(undefined)) // spawn failure → treat as quiet
      child.on('exit', () => {
        // Process ended (e.g. killed) — flush any complete line, else quiet.
        const newlineAt = buffer.indexOf('\n')
        finish(newlineAt !== -1 ? buffer.slice(0, newlineAt) : undefined)
      })
    })

    if (firstLine === undefined || firstLine.trim() === '') {
      // Quiet machine in the bounded window — no watch line to validate. The list
      // alarm above still guards the schema; this is a clean, deterministic pass.
      expect(true).toBe(true)
      return
    }

    // A line arrived → it MUST parse through WatchLineSchema. Drift → loud failure
    // with path+code only (parseJsonOrDrift/driftReport never include the line value).
    const parsedJson: unknown = parseJsonOrDrift(firstLine, 'watch-json')
    const line = parseOrDrift(WatchLineSchema, parsedJson, 'watch')

    // Structural assertions ONLY (no value dumped):
    // Story 5.2: widened to include 'status_changed' (the real c9watch 0.8.1 event value).
    expect(['started', 'changed', 'status_changed', 'stopped']).toContain(line.event)
    expect(typeof line.sessionId).toBe('string')
    expect(typeof line.timestamp).toBe('number') // ISO+tz coerced to epoch-millis
    expect(line.session.id).toBe(line.sessionId)
    // STATUS-ENUM-SURFACE TRIPWIRE (same as the list path): the watch line's session
    // status must be within the KNOWN set. A drift FAILS LOUDLY with the status NAME
    // only (enum token, not session content). TEST-ONLY — schema stays z.string().
    if (!KNOWN_STATUSES.has(line.session.status)) {
      throw new Error(
        `c9watch ${C9WATCH_FIXTURE_VERSION} STATUS DRIFT: unexpected watch-line status ` +
          `"${line.session.status}" not in known set ` +
          `{${[...KNOWN_STATUSES].join(', ')}} — re-characterize the status surface ` +
          `and the column mapping in c9watch-0.8.1-contract.md §4.`
      )
    }
    // Per-test timeout MUST exceed the 6000ms quiet-window timer above (Vitest's
    // default is 5000ms) so a quiet machine resolves to a clean pass instead of a
    // spurious Vitest test-timeout. 15s leaves ample headroom for spawn + the burst.
  }, 15000)
})
