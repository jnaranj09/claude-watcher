#!/usr/bin/env node
/**
 * Story 0.2 — zero-dependency behavioral checks for the Zod c9watch identity
 * adapter (`src/shared/schemas/session.ts`).
 *
 * Mechanism: this imports the actual `.ts` schema directly via Node 24's native
 * type-stripping (no Vitest — the Vitest runner is Story 0.3; no new deps). Each
 * check is a pure assertion against `safeParse`/the helper functions. Exit 0 =
 * all policies hold; non-zero = a policy regressed.
 *
 * Run: node tests/schema/session.check.mjs
 *
 * Covers the human-resolved review decisions:
 *   1. TIMESTAMPS — strict ISO-8601 WITH tz offset, fails closed (rejects
 *      tz-less + garbage; still accepts nanosecond fractions).
 *   2. RE-PARSE — parse-once boundary (documented; no idempotency expected).
 *   3. ID KEYING — blank id rejected at the schema; duplicate id SIGNALS (throws
 *      DuplicateSessionIdError) instead of silent last-write-wins.
 *   4. PID — required int >= 0 (rejects floats / NaN / negatives).
 * Plus the original 0.2 policies (passthrough, status not enum-locked, list
 * wrapper not a bare array, watch NDJSON line, id-keyed map).
 */
import {
  SessionSchema,
  ListEnvelopeSchema,
  WatchLineSchema,
  keyById,
  parseListKeyedById,
  DuplicateSessionIdError
} from '../../src/shared/schemas/session.ts'

let passed = 0
let failed = 0

/** Assert a boolean condition. */
function check(name, cond) {
  if (cond) {
    passed += 1
    console.log(`  ok   ${name}`)
  } else {
    failed += 1
    console.error(`  FAIL ${name}`)
  }
}

/** A minimal valid compact session (the always-present fields). */
const base = Object.freeze({
  id: 'a1b2c3',
  status: 'Working',
  projectPath: '/home/u/proj',
  pid: 1234,
  sessionName: 'my-session'
})

const ok = (input) => SessionSchema.safeParse(input).success

// --- Decision 1: strict ISO-8601 timestamps, fail closed ---
console.log('Decision 1 — strict ISO-8601 timestamps (fail closed):')
check('ISO with Z offset accepted', ok({ ...base, modified: '2024-01-15T10:00:00Z' }))
check('ISO with ±HH:MM offset accepted', ok({ ...base, modified: '2024-01-15T10:00:00+02:00' }))
check(
  'ISO with millisecond fraction accepted',
  ok({ ...base, modified: '2024-01-15T10:00:00.123Z' })
)
check(
  'ISO with nanosecond fraction accepted (truncated to ms)',
  ok({ ...base, modified: '2024-01-15T10:00:00.123456789Z' })
)
{
  const r = SessionSchema.safeParse({ ...base, modified: '2024-01-15T10:00:00Z' })
  check('transformed timestamp is epoch-millis number', typeof r.data?.modified === 'number')
}
check('tz-less ISO REJECTED', !ok({ ...base, modified: '2024-01-15T10:00:00' }))
check('bare year "2020" REJECTED', !ok({ ...base, modified: '2020' }))
check('free-form "Jan 1 2020" REJECTED', !ok({ ...base, modified: 'Jan 1 2020' }))
check('numeric junk "12345" REJECTED', !ok({ ...base, modified: '12345' }))
check('garbage "not-a-date" REJECTED', !ok({ ...base, modified: 'not-a-date' }))

// --- Decision 3: id non-blank + duplicate signals ---
console.log('Decision 3 — id keying (reject empty, signal on duplicate):')
check('blank id "" REJECTED', !ok({ ...base, id: '' }))
check('non-blank id accepted', ok({ ...base, id: 'x' }))
{
  const dup = [SessionSchema.parse(base), SessionSchema.parse({ ...base, pid: 5678 })]
  let threw = false
  let typed = false
  try {
    keyById(dup)
  } catch (e) {
    threw = true
    typed = e instanceof DuplicateSessionIdError
  }
  check('duplicate id THROWS', threw)
  check('duplicate id throws DuplicateSessionIdError', typed)
}
{
  const unique = [SessionSchema.parse(base), SessionSchema.parse({ ...base, id: 'a2' })]
  const map = keyById(unique)
  check('unique ids keyed without throw (size 2)', map.size === 2)
}

// --- Decision 4: pid int >= 0 ---
console.log('Decision 4 — pid int >= 0 (required):')
check('pid 0 accepted', ok({ ...base, pid: 0 }))
check('pid positive int accepted', ok({ ...base, pid: 1234 }))
check('pid float 1.5 REJECTED', !ok({ ...base, pid: 1.5 }))
check('pid negative -1 REJECTED', !ok({ ...base, pid: -1 }))
check('pid NaN REJECTED', !ok({ ...base, pid: Number.NaN }))
check('missing pid REJECTED (still required)', !ok({ ...base, pid: undefined }))

// --- Original 0.2 policies (regression guard) ---
console.log('Original 0.2 policies (regression guard):')
check('passthrough admits unknown additions', ok({ ...base, brandNewC9Field: 'x' }))
check('status NOT enum-locked (new status passes)', ok({ ...base, status: 'SomeFutureStatus' }))
check('known-key malformation fails closed (status as number)', !ok({ ...base, status: 5 }))
{
  const list = {
    diagnostics: { claudeProcessesFound: 2, fdaLikelyNeeded: false, processesWithCwd: 2 },
    sessions: [base, { ...base, id: 'a2' }]
  }
  check('list wrapper validates', ListEnvelopeSchema.safeParse(list).success)
  check(
    'parseListKeyedById returns id-keyed map (size 2)',
    parseListKeyedById(list).sessionsById.size === 2
  )
}
check(
  'bare array REJECTED as list (must be wrapper)',
  !ListEnvelopeSchema.safeParse([base]).success
)
{
  const line = {
    event: 'changed',
    session: base,
    sessionId: 'a1b2c3',
    timestamp: '2024-01-15T10:00:00+02:00'
  }
  const r = WatchLineSchema.safeParse(line)
  check('watch NDJSON line validates', r.success)
  check('watch timestamp coerced to epoch-millis number', typeof r.data?.timestamp === 'number')
  check(
    'watch line with tz-less timestamp REJECTED',
    !WatchLineSchema.safeParse({ ...line, timestamp: '2024-01-15T10:00:00' }).success
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
