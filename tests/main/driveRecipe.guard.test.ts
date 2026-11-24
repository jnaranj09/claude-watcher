// Guard `drive-recipe` (.claude/rules/run-app.md, setup task T15). The drive script cannot import
// TypeScript, so its port and data folder are written twice: in tests/drive/driveApp.mjs and in
// DRIVE_PROFILE (src/main/profile.ts). Faults this catches: the driver's port drifts from the
// drive profile, or lands on the dev / default / e2e port (a drive run would then post hooks into
// the operator's own app); the driver stops refusing a taken port before it launches; the
// screenshot folder is no longer git-ignored; run-app.md's profile table no longer matches the code.
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_PROFILE, DEV_PROFILE, DRIVE_PROFILE, E2E_PROFILE } from '../../src/main/profile'

const ROOT = resolve(__dirname, '../..')
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8')
const driver = read('tests/drive/driveApp.mjs')
const runApp = read('.claude/rules/run-app.md')
const others = [DEFAULT_PROFILE, DEV_PROFILE, E2E_PROFILE]

/** The hook and API ports of one row of run-app.md's Profiles table, by its first cell. */
function tablePorts(name: string): number[] {
  const row = runApp.split('\n').find((l) => new RegExp(`^\\|\\s*${name}\\s*\\|`).test(l))
  const m = /hook (\d+), API (\d+)/.exec(row ?? '')
  return m === null ? [] : [Number(m[1]), Number(m[2])]
}

describe('drive recipe', () => {
  it("the driver's hook port is the drive profile's and no other profile's", () => {
    const port = Number(/const HOOK_PORT = (\d+)/.exec(driver)?.[1])
    expect(port).toBe(DRIVE_PROFILE.hookPort)
    expect(others.map((p) => p.hookPort)).not.toContain(port)
    expect(others.map((p) => p.apiPort)).not.toContain(DRIVE_PROFILE.apiPort)
  })

  it("the driver runs the drive profile in the drive profile's own data folder", () => {
    expect(driver).toContain(`'${DRIVE_PROFILE.userDataDirName}'`)
    expect(others.map((p) => p.userDataDirName)).not.toContain(DRIVE_PROFILE.userDataDirName)
    expect(driver).toContain(`CLAUDE_WATCHER_PROFILE: '${DRIVE_PROFILE.name}'`)
  })

  it('the driver refuses a taken port before it launches anything', () => {
    const launch = driver.slice(driver.indexOf('export async function launchApp'))
    const check = launch.indexOf('await portInUse()')
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(launch.indexOf('electron.launch('))
  })

  it('the screenshot folder is git-ignored', () => {
    const folder = /SHOT_DIR = path\.join\(ROOT, '([^']+)'\)/.exec(driver)?.[1] ?? ''
    expect(folder).not.toBe('')
    const ignored = execFileSync('git', ['check-ignore', '-q', `${folder}/x.png`], {
      cwd: ROOT,
      stdio: 'ignore'
    })
    expect(ignored).toBeNull()
  })

  it("run-app.md's profile table matches the code", () => {
    expect(tablePorts('drive')).toEqual([DRIVE_PROFILE.hookPort, DRIVE_PROFILE.apiPort])
    expect(tablePorts('dev')).toEqual([DEV_PROFILE.hookPort, DEV_PROFILE.apiPort])
    expect(tablePorts('e2e')).toEqual([E2E_PROFILE.hookPort, E2E_PROFILE.apiPort])
    expect(tablePorts('default')).toEqual([DEFAULT_PROFILE.hookPort, DEFAULT_PROFILE.apiPort])
    expect(runApp).toContain('`tests/drive/driveApp.mjs`')
  })
})
