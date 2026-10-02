// Electron fuses (technical-taste §5b-22, Electron security checklist): the packaged binary ignores
// ELECTRON_RUN_AS_NODE, NODE_OPTIONS and --inspect, and loads the app only from app.asar. Each is a
// way to run arbitrary code as this app. Flipped at package time by electron-builder.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const yml = readFileSync(resolve(__dirname, '../../electron-builder.yml'), 'utf8')

/** The `electronFuses:` block's `key: value` lines (comments dropped). */
function fuses(): Record<string, string> {
  const start = yml.indexOf('\nelectronFuses:')
  if (start === -1) return {}
  const out: Record<string, string> = {}
  for (const line of yml
    .slice(start + 1)
    .split('\n')
    .slice(1)) {
    if (/^\S/.test(line)) break
    const m = /^ {2}(\w+):\s*(\S+)/.exec(line)
    if (m?.[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2]
  }
  return out
}

describe('electron-builder.yml electronFuses', () => {
  it('turns off the node escapes and loads only from app.asar', () => {
    expect(fuses()).toEqual({
      runAsNode: 'false',
      enableNodeOptionsEnvironmentVariable: 'false',
      enableNodeCliInspectArguments: 'false',
      onlyLoadAppFromAsar: 'true'
    })
  })
})
