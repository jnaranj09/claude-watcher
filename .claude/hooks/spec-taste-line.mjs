#!/usr/bin/env node
// technical-taste §0 — the read-it-first check (PreToolUse on Write/Edit/MultiEdit). A spec in
// docs/superpowers/specs/ dated 2026-10-13 or later must carry, before its first `## ` heading, a
// line `Taste: §<id>, …` naming the technical-taste.md sections it applied (`§4`, `§5b-17`; the
// part before `-` must match a `## <id>. ` heading exactly). A made-up `§` is blocked, and so is a
// missing technical-taste.md (fail closed: the file is always in the repo). Exit 2 blocks the
// write; stderr says why. Older specs are left alone. Tested by tests/main/specTasteHook.test.ts.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runSpecHook } from './specFile.mjs'

const RULE_START = '2026-10-13'
const EXAMPLE = 'Taste: §0, §2, §4, §11'

/** The section ids technical-taste.md defines: `## 5b. Engineering canon` → `5b`. */
function headingIds(tasteText) {
  return new Set([...tasteText.matchAll(/^## ([0-9]+[a-z]?)\. /gm)].map((m) => m[1]))
}

/** The problem with the spec's `Taste:` line, or null when it is fine. */
function tasteProblem(text, ids) {
  const first = text.search(/^## /m)
  const head = first === -1 ? text : text.slice(0, first)
  const line = /^Taste:(.*)$/m.exec(head)
  if (line === null) return 'it has no `Taste:` line before its first `## ` heading'
  const refs = [...line[1].matchAll(/§([0-9]+[a-z]?)(?:-\d+)?/g)].map((m) => m[1])
  if (refs.length === 0) return 'its `Taste:` line names no `§` section'
  const unknown = [...new Set(refs.filter((id) => !ids.has(id)))]
  if (unknown.length === 0) return null
  const names = unknown.map((id) => `§${id}`).join(', ')
  return `its \`Taste:\` line names ${names}, but technical-taste.md has no \`## <id>.\` heading for it`
}

/** technical-taste.md at the repo root: the folder above `docs/`, or the cwd for a relative path. */
function tasteFile(file) {
  const at = file.indexOf('docs/superpowers/specs/')
  return path.resolve(file.slice(0, at) || '.', 'technical-taste.md')
}

runSpecHook((text, file, date) => {
  if (date < RULE_START) return null
  const where = tasteFile(file)
  let tasteText
  try {
    tasteText = readFileSync(where, 'utf8')
  } catch (err) {
    return (
      `Spec blocked: cannot read ${where} (${err?.code ?? 'unknown'}), ` +
      'so the `Taste:` line cannot be checked.\n'
    )
  }
  const problem = tasteProblem(text, headingIds(tasteText))
  if (problem === null) return null
  return (
    `Spec blocked: ${problem}.\n` +
    'technical-taste §0: read technical-taste.md before designing, and name the sections you ' +
    'applied on one line before the first `## ` heading, e.g.\n\n' +
    `${EXAMPLE}\n`
  )
})
