#!/usr/bin/env node
/**
 * Story 0.2 — zero-dependency behavioral checks for the Session schema
 * (`src/shared/schemas/session.ts`). Story 6.4 trimmed the c9watch wire checks
 * (list envelope / watch line / id-keyed map) — those schemas died with the CLI.
 *
 * Mechanism: this imports the actual `.ts` schema directly via Node 24's native
 * type-stripping (no Vitest — no new deps). Each check is a pure assertion
 * against `safeParse`. Exit 0 = all policies hold; non-zero = a policy regressed.
 *
 * Run: node tests/schema/session.check.mjs
 *
 * Covers the human-resolved review decisions that still apply:
 *   1. TIMESTAMPS — strict ISO-8601 WITH tz offset, fails closed (rejects
 *      tz-less + garbage; still accepts nanosecond fractions).
 *   2. RE-PARSE — parse-once boundary (documented; no idempotency expected).
 *   3. ID — blank id rejected at the schema.
 *   4. PID — required int >= 0 (rejects floats / NaN / negatives).
 * Plus the original 0.2 policies (passthrough, status not enum-locked).
 */
import { SessionSchema } from '../../src/shared/schemas/session.ts'

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

// --- Decision 3: id non-blank ---
console.log('Decision 3 — identity id (reject empty):')
check('blank id "" REJECTED', !ok({ ...base, id: '' }))
check('non-blank id accepted', ok({ ...base, id: 'x' }))

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
check('passthrough admits unknown additions', ok({ ...base, brandNewField: 'x' }))
check('status NOT enum-locked (new status passes)', ok({ ...base, status: 'SomeFutureStatus' }))
check('known-key malformation fails closed (status as number)', !ok({ ...base, status: 5 }))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
