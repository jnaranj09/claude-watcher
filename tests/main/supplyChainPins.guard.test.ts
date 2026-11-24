// Guard `supply-chain-pins` (.claude/rules/security.md "Everything is pinned"). A tag can be moved
// to other code after we read it; a commit SHA or an image digest cannot. So every action is
// `owner/repo@<40-hex SHA> # vX.Y.Z` and every image `<tag>@sha256:<64 hex>`, in every workflow,
// Dockerfile and compose file. `check-pins`: a version that appears in several workflows (the Node
// version) is the same everywhere.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')

const ACTION_PIN = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/
const VERSION_COMMENT = /^\s+# v\d+\.\d+\.\d+$/
const IMAGE_PIN = /^[\w.\-/:]+@sha256:[0-9a-f]{64}$/

export interface PinReport {
  uses: number
  images: number
  problems: string[]
  nodeVersions: string[]
}

/** Every unpinned `uses:` and image in one file. `name` decides workflow vs Dockerfile rules. */
export function scanPins(name: string, text: string): PinReport {
  const report: PinReport = { uses: 0, images: 0, problems: [], nodeVersions: [] }
  const stages = new Set<string>()
  text.split('\n').forEach((line, i) => {
    const at = `${name}:${i + 1}`
    const uses = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/.exec(line)
    if (uses?.[1] !== undefined) {
      report.uses++
      const [ref, rest = ''] = [uses[1], uses[2]]
      if (ref.startsWith('./')) return
      if (!ACTION_PIN.test(ref) || !VERSION_COMMENT.test(rest))
        report.problems.push(`${at} action not pinned by SHA + "# vX.Y.Z": ${ref}${rest}`)
      return
    }
    const image =
      /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line) ??
      /(?:^|[\s{,])(?:image|container):\s*['"]?([^'"\s,}]+)/.exec(line)
    if (image?.[1] !== undefined) {
      const ref = image[1]
      if (image[2] !== undefined) stages.add(image[2])
      if (ref.startsWith('${{') || ref === 'scratch' || stages.has(ref)) return
      report.images++
      if (!IMAGE_PIN.test(ref)) report.problems.push(`${at} image not pinned by digest: ${ref}`)
      return
    }
    const node = /^\s*node-version:\s*['"]?([^'"\s]+)/.exec(line)
    if (node?.[1] !== undefined) report.nodeVersions.push(node[1])
  })
  return report
}

/** Tracked and new (not ignored) files the guard reads. */
function pinnedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
    .split('\n')
    .filter(
      (f) =>
        /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) ||
        /(^|\/)[^/]*dockerfile[^/]*$/i.test(f) ||
        /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(f)
    )
    .filter((f) => !f.startsWith('node_modules/'))
}

describe('scanPins (probes)', () => {
  it('accepts a SHA-pinned action with its version, a local workflow and a digest image', () => {
    const r = scanPins(
      'w.yml',
      [
        `      - uses: actions/checkout@${'a'.repeat(40)} # v4.4.0`,
        '    uses: ./.github/workflows/ci.yml',
        `    container: debian:12@sha256:${'b'.repeat(64)}`,
        `          - { image: 'fedora:45@sha256:${'c'.repeat(64)}', glob: '*.rpm' }`,
        '    container: ${{ matrix.image }}',
        '          node-version: 24'
      ].join('\n')
    )
    expect(r).toEqual({ uses: 2, images: 2, problems: [], nodeVersions: ['24'] })
  })

  it('refuses a tag-only action, a SHA with no version comment and a tag-only image', () => {
    const r = scanPins(
      'w.yml',
      [
        '      - uses: actions/checkout@v4',
        `      - uses: actions/checkout@${'a'.repeat(40)}`,
        "          - { image: 'archlinux:latest', glob: '*.pacman' }"
      ].join('\n')
    )
    expect(r.problems).toHaveLength(3)
  })

  it('refuses a Dockerfile FROM without a digest, but not a reference to an earlier stage', () => {
    const r = scanPins(
      'Dockerfile',
      [`FROM node:24@sha256:${'d'.repeat(64)} AS build`, 'FROM build', 'FROM alpine:3'].join('\n')
    )
    expect(r.problems).toEqual(['Dockerfile:3 image not pinned by digest: alpine:3'])
  })
})

describe('supply-chain pins in this repo', () => {
  const files = pinnedFiles()
  const reports = files.map((f) => scanPins(f, readFileSync(resolve(ROOT, f), 'utf8')))

  it('finds the workflows and the scanner images (a scan that read nothing proves nothing)', () => {
    expect(files).toContain('.github/workflows/ci.yml')
    expect(files).toContain('security/tools.Dockerfile')
    expect(reports.reduce((n, r) => n + r.uses, 0)).toBeGreaterThan(0)
    expect(reports.reduce((n, r) => n + r.images, 0)).toBeGreaterThan(0)
  })

  it('every action is pinned by SHA with "# vX.Y.Z", every image by digest', () => {
    expect(reports.flatMap((r) => r.problems)).toEqual([])
  })

  it('check-pins: every workflow sets the same Node version', () => {
    const versions = new Set(reports.flatMap((r) => r.nodeVersions))
    expect([...versions]).toHaveLength(1)
  })
})
