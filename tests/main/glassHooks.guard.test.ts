// Every data-glass value in the renderer is a surface the schema (and so the WebGL layer) knows.
// A new value without a schema entry would be a hook nothing draws.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { GLASS_SURFACES } from '../../src/shared/schemas/theme'
import { sourceFiles, srcRel } from './sourceScan'

const KNOWN: ReadonlySet<string> = new Set(GLASS_SURFACES)

describe('data-glass hooks', () => {
  it('only use schema surfaces', () => {
    const found = new Set<string>()
    // sourceFiles() already skips tests, __fixtures__ and test/ helpers.
    for (const file of sourceFiles()) {
      if (!file.endsWith('.tsx') || !srcRel(file).startsWith('renderer/src/')) continue
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/data-glass['"]?\s*[:=]\s*\{?\s*['"]([a-z-]+)['"]/g))
        found.add(m[1] ?? '')
      for (const m of text.matchAll(/\bglass="([a-z-]+)"/g)) found.add(m[1] ?? '')
    }
    expect(found.size).toBeGreaterThan(0)
    for (const v of found) expect(KNOWN.has(v), `data-glass="${v}"`).toBe(true)
  })
})
