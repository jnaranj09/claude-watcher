// The bridge mod's hooks module and manifest stay byte for byte (P3-C2, memory phase 3): a second
// mod (`watcher-memory`) ships beside it, and nothing in that work may change what the bridge mod
// runs or declares. Each hash below is that file's sha256 at commit 309f6ae. A types-only file
// (`engine.d.ts`) does not run, so it may move out of the shipped folder; it is not pinned here.
// A deliberate change to one of these files updates its hash in the same commit, and says why.
// The folder holds nothing else: a new file there would ship (the packaging filter takes every
// file but `*.test.ts`) and could change what the engine finds in the mod (a command, a skill).
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MOD = join(__dirname, '../../src/mod/watcher-bridge')

const PINNED: [string, string][] = [
  [
    '.claude-plugin/plugin.json',
    '8c8ee80d09711cca34eb61946e6881b893d523c18c26052864cf19c8c8952b90'
  ],
  ['hooks/hooks.json', 'c835c92d8e1159d20a40ca78ad654da7433942c3694ffeda0b376b0c4dfd52cf'],
  ['hooks/register.ts', 'f4e68c2a1f911e691794db299d4b086242ccd1e0ed7e72357eebcf2130d812d1'],
  ['hooks/report.ts', '895dcf6fe1f81cd4f5c697096e2b48237c71eedf162c35a77dc2c8d17b7774e2'],
  ['hooks/prompt.ts', 'a7d744fe8f81a11fa8e001b627fd1dbc38f8e2a6440763b0a72172e57533ebf1']
]

/** Present in the folder, not shipped: the engine tests (`npm run test:mod`), which the
 *  `electron-builder.yml` filter and the installer both leave out. */
const PRESENT_NOT_SHIPPED = ['hooks/register.test.ts']

describe('the bridge mod is pinned (P3-C2)', () => {
  it('the folder holds only the pinned files and its engine tests', () => {
    const files = readdirSync(MOD, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) =>
        join(e.parentPath, e.name)
          .slice(MOD.length + 1)
          .split('\\')
          .join('/')
      )
      .sort()
    expect(files).toEqual([...PINNED.map(([rel]) => rel), ...PRESENT_NOT_SHIPPED].sort())
  })

  it.each(PINNED)('%s is byte for byte what 309f6ae shipped', (rel, sha256) => {
    expect(
      createHash('sha256')
        .update(readFileSync(join(MOD, rel)))
        .digest('hex')
    ).toBe(sha256)
  })
})
