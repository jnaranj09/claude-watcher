// Both mods ship the same way (electron-builder.yml `extraResources`): one filter for both, and that
// filter keeps the engine tests (`*.test.ts`, run by `npm run test:mod`) out of the package. The
// installer drops them too (`ships` in src/main/mods/modInstall.ts), but a package must not carry
// files the app never reads.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BRIDGE_MOD_NAME, MEMORY_MOD_NAME } from '../../src/main/mods/modInstall'

const yml = readFileSync(resolve(__dirname, '../../electron-builder.yml'), 'utf8')

/** The `filter:` items of the `extraResources` entry `from: src/mod/<name>` (comments dropped). */
function modFilter(name: string): string[] {
  const lines = yml.split('\n')
  const start = lines.findIndex((l) => l === `  - from: src/mod/${name}`)
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) || line.startsWith('  - ')) break
    const m = /^ {6}- (.+)$/.exec(line)
    if (m?.[1] !== undefined) out.push(m[1])
  }
  return out
}

describe('the mods in electron-builder.yml', () => {
  it('the bridge mod ships every file but its engine tests', () => {
    expect(modFilter(BRIDGE_MOD_NAME)).toEqual(["'**/*'", "'!**/*.test.ts'"])
  })

  it('the memory mod ships with the same filter as the bridge mod', () => {
    expect(modFilter(MEMORY_MOD_NAME)).toEqual(modFilter(BRIDGE_MOD_NAME))
  })
})
