// Needs-you detail — unit tests for the pure one-line summary of a tool call's input.
//
// Runs under the `main-unit` Vitest project (node).
//
// PROBE-GROUNDED (claude 2.1.303 through an `http` hook, 2026-10-19): the field names below are
// the ones `PreToolUse` carries in `tool_input`. [spec 2026-10-18-needs-you-detail 1.2]

import { describe, it, expect, vi } from 'vitest'
import { toolDetail, TOOL_DETAIL_MAX } from './toolDetail'

const P = '/w/app'

describe('toolDetail — one line per known tool', () => {
  it('Bash: the first line of the command', () => {
    expect(toolDetail('Bash', { command: 'kubectl apply -f prod.yaml\necho done' }, P)).toBe(
      'kubectl apply -f prod.yaml'
    )
  })

  it('Read/Write/Edit: file_path relative to the project', () => {
    for (const t of ['Read', 'Write', 'Edit']) {
      expect(toolDetail(t, { file_path: '/w/app/src/a.ts' }, P)).toBe('src/a.ts')
    }
  })

  it('NotebookEdit: notebook_path, relative', () => {
    expect(toolDetail('NotebookEdit', { notebook_path: '/w/app/n.ipynb' }, P)).toBe('n.ipynb')
  })

  it('a path outside the project stays absolute', () => {
    expect(toolDetail('Read', { file_path: '/etc/hosts' }, P)).toBe('/etc/hosts')
  })

  it('a sibling folder with the same prefix stays absolute', () => {
    expect(toolDetail('Read', { file_path: '/w/app-old/x' }, P)).toBe('/w/app-old/x')
  })

  it('the project folder itself is "."', () => {
    expect(toolDetail('Read', { file_path: '/w/app' }, P)).toBe('.')
  })

  it('no project path: the path stays absolute', () => {
    expect(toolDetail('Read', { file_path: '/w/app/a' }, undefined)).toBe('/w/app/a')
  })

  it('WebFetch: url; WebSearch: query', () => {
    expect(toolDetail('WebFetch', { url: 'https://x.dev/a', prompt: 'p' }, P)).toBe(
      'https://x.dev/a'
    )
    expect(toolDetail('WebSearch', { query: 'zod 4 passthrough' }, P)).toBe('zod 4 passthrough')
  })

  it('AskUserQuestion: the first question only', () => {
    expect(
      toolDetail(
        'AskUserQuestion',
        { questions: [{ question: 'Deploy now?' }, { question: 'Why?' }] },
        P
      )
    ).toBe('Deploy now?')
  })

  it('Agent and Task: description', () => {
    expect(toolDetail('Agent', { description: 'Find the bug' }, P)).toBe('Find the bug')
    expect(toolDetail('Task', { description: 'Find the bug' }, P)).toBe('Find the bug')
  })
})

describe('toolDetail — no detail', () => {
  it('unknown and MCP tools: null, no log', () => {
    const log = vi.fn()
    expect(toolDetail('mcp__x__y', { a: 1 }, P, log)).toBeNull()
    expect(log).not.toHaveBeenCalled()
  })

  it('a tool named like an Object member is unknown: null, no log', () => {
    const log = vi.fn()
    for (const t of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(toolDetail(t, { a: 1 }, P, log)).toBeNull()
    }
    expect(log).not.toHaveBeenCalled()
  })

  it('caps at 200 characters after the trim', () => {
    expect(toolDetail('Bash', { command: `  ${'x'.repeat(500)}  ` }, P)).toBe(
      'x'.repeat(TOOL_DETAIL_MAX)
    )
    expect(TOOL_DETAIL_MAX).toBe(200)
  })

  it('a 5 KB multi-line script: the first line only, capped, no log', () => {
    const log = vi.fn()
    const script = `${'y'.repeat(300)}\n${'z'.repeat(5000)}`
    expect(toolDetail('Bash', { command: script }, P, log)).toBe('y'.repeat(TOOL_DETAIL_MAX))
    expect(log).not.toHaveBeenCalled()
  })

  it('empty after the trim: null, no log', () => {
    const log = vi.fn()
    expect(toolDetail('Bash', { command: '   \n ls' }, P, log)).toBeNull()
    expect(log).not.toHaveBeenCalled()
  })

  it('absent input: null, no log', () => {
    const log = vi.fn()
    expect(toolDetail('Bash', undefined, P, log)).toBeNull()
    expect(log).not.toHaveBeenCalled()
  })

  it('wrong shape: null and one value-free code= line', () => {
    const log = vi.fn()
    expect(toolDetail('Bash', { command: 42, secret: 'hunter2' }, P, log)).toBeNull()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[claude-watcher][hooks] path=(hook) code=tool_detail_shape')
  })
})
