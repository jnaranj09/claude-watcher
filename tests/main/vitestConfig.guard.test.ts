// The Vitest gate's safety settings live in EACH project of vitest.config.ts, because a root-level
// setting does not reach inline projects: `allowOnly: false` (a `.only` fails the run, technical-
// taste §5b-3), `restoreMocks: true` (a spy cannot leak into the next test) and `pool: 'threads'`.
// A new project that forgets one would silently drop it for its files. The one `forks` project is
// `zone-berlin`: a zone only takes effect per process, so it must keep both `forks` and its TZ.
// It runs `*.zone.test.ts` from any folder and every other project skips them: a narrower glob or a
// missing exclude would run a clock-change test in the runner's zone, where it passes vacuously.
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import config, { ZONE_TESTS } from '../../vitest.config'

const ZONE_PROJECT = 'zone-berlin'

describe('vitest.config.ts', () => {
  const projects = config.test?.projects ?? []

  it('has at least one project', () => {
    expect(projects.length).toBeGreaterThan(0)
  })

  it('sets allowOnly: false, restoreMocks: true and pool: threads (forks for zone-berlin) in every project', () => {
    for (const project of projects) {
      // Every project is written inline; a path or a function would hide its settings.
      expect(typeof project).toBe('object')
      if (typeof project !== 'object' || project instanceof Promise) continue
      const test = project.test
      const name = test?.name
      expect({ name, allowOnly: test?.allowOnly }).toEqual({ name, allowOnly: false })
      expect({ name, restoreMocks: test?.restoreMocks }).toEqual({ name, restoreMocks: true })
      const pool = name === ZONE_PROJECT ? 'forks' : 'threads'
      expect({ name, pool: test?.pool }).toEqual({ name, pool })
    }
  })

  it('runs zone-berlin in Europe/Berlin', () => {
    const zone = projects.find(
      (p) => typeof p === 'object' && !(p instanceof Promise) && p.test?.name === ZONE_PROJECT
    )
    expect(zone).toMatchObject({ test: { pool: 'forks', env: { TZ: 'Europe/Berlin' } } })
  })

  it('zone-berlin runs every *.zone.test.ts and no other project does', () => {
    expect(ZONE_TESTS).toBe('**/*.zone.test.ts')
    const globs = projects
      .filter((p) => typeof p === 'object' && !(p instanceof Promise))
      .map((p) => {
        const test = typeof p === 'object' && !(p instanceof Promise) ? p.test : undefined
        return test?.name === ZONE_PROJECT
          ? { name: test.name, include: test.include }
          : { name: test?.name, skips: test?.exclude?.includes(ZONE_TESTS) }
      })
    expect(globs).toEqual(
      globs.map((g) =>
        g.name === ZONE_PROJECT
          ? { name: g.name, include: [ZONE_TESTS] }
          : { name: g.name, skips: true }
      )
    )
  })

  // Non-vacuity: the zone project has files to run.
  it('finds at least one *.zone.test.ts', () => {
    const root = join(__dirname, '..', '..')
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.zone.test.ts')) found.push(p)
      }
    }
    for (const top of ['src', 'tests']) walk(join(root, top))
    expect(found.length).toBeGreaterThan(0)
  })
})
