#!/usr/bin/env node
/**
 * Story 0.1 packaged-build smoke runner (AC-3 exit gate).
 *
 * Runs the PACKAGED `--dir` binary (NOT `dev`) with C9_SMOKE=1 so the in-app
 * harness performs: spawn PTY -> type/echo round-trip -> resize -> run a
 * full-screen TUI (`top`; `htop` if installed) and resize while it paints ->
 * confirm WebGL renderer active. The app writes a JSON verdict which this
 * script asserts. Exit 0 = gate passed.
 *
 * Prereq: `npm run build:dir` has produced dist/linux-unpacked/.
 * A live display (Wayland/X11) must be available.
 *
 * Usage: node tests/smoke/run-packaged-smoke.mjs
 *
 * NOTE: This is intentionally a tiny zero-dependency Node script, not a
 * Playwright-Electron harness. The full Vitest + Playwright-Electron test
 * architecture is Story 0.3 scope; this story's acceptance is the packaged
 * smoke itself, and it must not pull in unrequested test deps.
 *
 * Runner robustness (pulled forward from Story 0.3): under Electron 39 + Wayland
 * the helper processes (GPU/zygote/utility) do not tear down promptly, so a
 * blocking `spawnSync(..., { stdio: 'inherit' })` never returns even after the
 * verdict is written — the inherited descriptors keep the parent waiting on the
 * lingering helper tree. We therefore (a) launch async with `spawn` + `detached`
 * so the app gets its own process group, (b) treat the VERDICT FILE as the
 * completion signal (poll, don't wait on the process), and (c) SIGKILL the whole
 * process group on every exit path so no c9watch helper can linger.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const bin = resolve(root, 'dist', 'linux-unpacked', 'c9watch-webapp')
const out = resolve(root, 'dist', 'smoke-result.json')

const DEADLINE_MS = 60_000 // verdict must appear within this window
const POLL_MS = 250

if (!existsSync(bin)) {
  console.error(
    `[smoke] packaged binary not found at ${bin}\n[smoke] run \`npm run build:dir\` first.`
  )
  process.exit(2)
}

rmSync(out, { force: true })
console.log(`[smoke] launching PACKAGED binary: ${bin}`)

// Launch async + detached so the app + its Electron helper tree get their OWN
// process group (negative-pid kill below reaps the lot). stdio is piped, NOT
// 'inherit': inheriting would make the runner wait on descriptors held open by
// the lingering GPU/zygote/utility helpers under Wayland. We echo the pipes for
// debuggability but never block the runner's exit on them.
const child = spawn(bin, ['--no-sandbox'], {
  env: { ...process.env, C9_SMOKE: '1', C9_SMOKE_OUT: out },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe']
})

child.stdout?.on('data', (b) => process.stdout.write(b))
child.stderr?.on('data', (b) => process.stderr.write(b))

let launchError = null
child.on('error', (err) => {
  launchError = err
})

// Reap the ENTIRE process group (the app + every Electron helper). The child was
// spawned detached, so it leads its own group and `-child.pid` targets the group.
// Guarded + idempotent: safe to call on success, fail, timeout, and error paths.
let reaped = false
function reapProcessGroup() {
  if (reaped) return
  reaped = true
  const pid = child.pid
  if (!pid) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // group already gone (or never started) — try the bare pid as a fallback.
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* nothing left to reap */
    }
  }
}
// Belt-and-suspenders: never leave the helper tree behind if the runner itself
// dies unexpectedly.
process.on('exit', reapProcessGroup)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Treat the VERDICT FILE as the completion signal: poll until it exists AND
// parses as complete JSON (the app writes it with a single synchronous
// writeFileSync, so its presence means it is whole). Stop as soon as we have it
// or the deadline passes — we do NOT wait on the child process, whose helper
// tree may linger past the verdict.
async function waitForVerdict() {
  const deadline = Date.now() + DEADLINE_MS
  while (Date.now() < deadline) {
    if (launchError) return null // spawn failed outright — surface as exit 2
    if (existsSync(out)) {
      try {
        return JSON.parse(readFileSync(out, 'utf8'))
      } catch {
        // mid-write or partial — poll again until it parses or we time out.
      }
    }
    await sleep(POLL_MS)
  }
  return null
}

const report = await waitForVerdict()

// Reap on EVERY path below (success, fail, timeout, error) — no orphan c9watch
// processes may linger after the runner returns.
if (launchError) {
  reapProcessGroup()
  console.error('[smoke] launch error:', launchError.message)
  process.exit(2)
}

if (!report) {
  reapProcessGroup()
  console.error(
    `[smoke] no verdict file written within ${DEADLINE_MS / 1000}s — app did not complete the smoke.`
  )
  process.exit(3)
}

reapProcessGroup()
console.log('[smoke] verdict:', JSON.stringify(report, null, 2))

const c = report.checks || {}
const ok =
  report.pass === true && c.typeEcho?.pass && c.resize?.pass && c.tui?.pass && c.webgl?.pass

if (!ok) {
  console.error('[smoke] FAIL — exit gate not satisfied.')
  process.exit(1)
}

console.log(
  `[smoke] PASS — node-pty survives packaging. ` +
    `electron=${report.main?.electron} abi=${report.main?.abi} ptyPid=${report.main?.ptyPid}`
)
process.exit(0)
