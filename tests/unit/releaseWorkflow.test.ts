// The release workflow's upload gate (spec 2026-09-30 release pipeline, section 1): ONLY a pushed
// `v*` tag creates the draft release. A manual "Run workflow" started from a tag also has a
// `refs/tags/v…` ref, so the ref alone is not enough — the event must be `push` too.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const yml = readFileSync(resolve(__dirname, '../../.github/workflows/release.yml'), 'utf8')

describe('release.yml release job', () => {
  it('runs only for a pushed v* tag, never for a manual run', () => {
    const job = yml.slice(yml.indexOf('\n  release:'))
    const cond = /\n {4}if: (.+)/.exec(job)?.[1] ?? ''
    expect(cond).toContain("github.event_name == 'push'")
    expect(cond).toContain("startsWith(github.ref, 'refs/tags/v')")
  })
})
