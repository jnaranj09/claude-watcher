// The Vitest gate's safety settings live in EACH project of vitest.config.ts, because a root-level
// setting does not reach inline projects: `allowOnly: false` (a `.only` fails the run, technical-
// taste §5b-3), `restoreMocks: true` (a spy cannot leak into the next test) and `pool: 'threads'`.
// A new project that forgets one would silently drop it for its files.
import { describe, it, expect } from 'vitest'
import config from '../../vitest.config'

describe('vitest.config.ts', () => {
  const projects = config.test?.projects ?? []

  it('has at least one project', () => {
    expect(projects.length).toBeGreaterThan(0)
  })

  it('sets allowOnly: false, restoreMocks: true and pool: threads in every project', () => {
    for (const project of projects) {
      // Every project is written inline; a path or a function would hide its settings.
      expect(typeof project).toBe('object')
      if (typeof project !== 'object' || project instanceof Promise) continue
      const test = project.test
      const name = test?.name
      expect({ name, allowOnly: test?.allowOnly }).toEqual({ name, allowOnly: false })
      expect({ name, restoreMocks: test?.restoreMocks }).toEqual({ name, restoreMocks: true })
      expect({ name, pool: test?.pool }).toEqual({ name, pool: 'threads' })
    }
  })
})
