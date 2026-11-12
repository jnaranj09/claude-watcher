// The memory block a launched session gets in its system prompt (spec 2026-11-11 memory).
import { describe, expect, it } from 'vitest'
import { MEMORY_LIMITS, type MemoryItem, type MemoryRow } from '../../shared/schemas/memory'
import { buildMemoryIndex, MEMORY_RULES_OF_USE } from './memoryIndex'

const NOV_11 = new Date(2026, 10, 11, 12).getTime()
const NOV_10 = new Date(2026, 10, 10, 12).getTime()

const META = {
  folder: null,
  sessionName: null,
  tagIds: [],
  templateId: null,
  goalId: null,
  taskIds: []
}

function specific(over: Partial<Extract<MemoryItem, { kind: 'specific' }>> = {}): MemoryItem {
  return {
    kind: 'specific',
    id: 'p1',
    key: 'region',
    value: 'eu-west-1',
    workspaceId: null,
    state: 'active',
    pinned: true,
    basis: 'observed',
    check: null,
    lastSeenAt: NOV_11,
    createdAt: NOV_11,
    updatedAt: NOV_11,
    origin: { by: 'agent', sessionId: null },
    originDeletedAt: null,
    meta: META,
    ...over
  }
}

function fact(over: Partial<Extract<MemoryItem, { kind: 'fact' }>> = {}): MemoryItem {
  return {
    kind: 'fact',
    id: 'f1',
    title: 'Release steps',
    body: 'Tag, then push.',
    workspaceId: null,
    state: 'active',
    pinned: true,
    basis: 'stated',
    check: null,
    lastSeenAt: NOV_10,
    createdAt: NOV_10,
    updatedAt: NOV_10,
    origin: { by: 'operator', sessionId: null },
    originDeletedAt: null,
    meta: META,
    ...over
  }
}

function row(over: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: 'r1',
    kind: 'specific',
    head: 'deploy target',
    updatedAt: NOV_10,
    basis: 'observed',
    state: 'active',
    pinned: false,
    workspaceId: null,
    folder: null,
    sessionName: null,
    tagIds: [],
    originDeletedAt: null,
    ...over
  }
}

const rules = MEMORY_RULES_OF_USE
const lastLine = (text: string): string => text.split('\n').at(-1) ?? ''

describe('MEMORY_RULES_OF_USE', () => {
  it('is the exact text claude reads', () => {
    expect(rules).toBe(
      [
        '# Memory (Claude Watcher)',
        'Memory is a record of what was seen and when. It is not the current state.',
        '- Give the date with anything you take from memory.',
        '- When an item has a check and may have changed, run the check before you rely on it.',
        '- An item marked "session deleted" comes from a session the operator deleted. Say so when you use one, and suggest deleting it in Memory if it no longer applies. You can mark it stale; you cannot delete it.',
        '- Save exact values word for word (numbers, ids, versions, commands) with memory_save. Do not save preferences, or what the repository itself says.',
        '- Find items with memory_search (filters: kind, folder, session, tags, since, until, goal) and read one with memory_get.'
      ].join('\n')
    )
  })
})

describe('buildMemoryIndex', () => {
  it('an empty store gives the rules of use alone', () => {
    expect(buildMemoryIndex({ pinned: [], specificsHere: [], more: 0 })).toEqual({
      text: rules,
      itemIds: []
    })
  })

  it('one pinned specific with a check and one folder line have this exact text', () => {
    const out = buildMemoryIndex({
      pinned: [specific({ check: 'aws configure list' })],
      specificsHere: [row()],
      more: 0
    })
    expect(out.text).toBe(
      `${rules}\n\n## Pinned\n- region: eu-west-1 (seen 2026-11-11, observed) · check: aws configure list` +
        '\n\n## Specifics for this folder\n- deploy target (2026-11-10) id=r1'
    )
  })

  it('itemIds lists the pinned items, then the folder rows that got a line', () => {
    const out = buildMemoryIndex({
      pinned: [specific(), fact()],
      specificsHere: [row({ id: 'r1' }), row({ id: 'r2' })],
      more: 0
    })
    expect(out.itemIds).toEqual(['p1', 'f1', 'r1', 'r2'])
  })

  it('a pinned fact is a title, its body, the day it was seen and its basis', () => {
    const out = buildMemoryIndex({ pinned: [fact()], specificsHere: [], more: 0 })
    expect(lastLine(out.text)).toBe('- Release steps: Tag, then push. (seen 2026-11-10, stated)')
  })

  it('a pinned item from a deleted session says so after its check', () => {
    const out = buildMemoryIndex({
      pinned: [specific({ check: 'ls', originDeletedAt: NOV_11 })],
      specificsHere: [],
      more: 0
    })
    expect(lastLine(out.text)).toBe(
      '- region: eu-west-1 (seen 2026-11-11, observed) · check: ls · session deleted'
    )
  })

  it('a fact body with line breaks stays on one line, each break a space', () => {
    const out = buildMemoryIndex({
      pinned: [fact({ body: 'one\ntwo\r\nthree' })],
      specificsHere: [],
      more: 0
    })
    expect(lastLine(out.text)).toBe('- Release steps: one two three (seen 2026-11-10, stated)')
  })

  it('folder lines come newest first', () => {
    const out = buildMemoryIndex({
      pinned: [],
      specificsHere: [row({ id: 'old', updatedAt: NOV_10 }), row({ id: 'new', updatedAt: NOV_11 })],
      more: 0
    })
    expect(out.itemIds).toEqual(['new', 'old'])
  })

  it('a count of items beyond the list adds the more line, even when every row fits', () => {
    const out = buildMemoryIndex({ pinned: [], specificsHere: [row()], more: 7 })
    expect(lastLine(out.text)).toBe('7 more; use memory_search')
  })

  it('60 folder rows with 119-character keys stay within the cap and count the rest', () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      row({ id: `row-${i}`, head: 'k'.repeat(119), updatedAt: NOV_10 - i })
    )
    const out = buildMemoryIndex({ pinned: [], specificsHere: rows, more: 0 })
    const left = 60 - out.itemIds.length
    expect([out.text.length <= MEMORY_LIMITS.indexChars, left > 0, lastLine(out.text)]).toEqual([
      true,
      true,
      `${left} more; use memory_search`
    ])
  })

  it('a smaller cap argument is the one that applies', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ id: `row-${i}`, updatedAt: NOV_10 - i })
    )
    const cap = rules.length + 150
    const out = buildMemoryIndex({ pinned: [], specificsHere: rows, more: 0 }, cap)
    expect(out.text.length).toBeLessThanOrEqual(cap)
  })

  it('pinned items alone over the cap are all sent, with no folder section', () => {
    const pinned = Array.from({ length: 12 }, (_, i) =>
      specific({ id: `p-${i}`, key: `key-${i}`, value: 'v'.repeat(500) })
    )
    const out = buildMemoryIndex({
      pinned,
      specificsHere: [row()],
      more: 0
    })
    expect([
      out.text.length > MEMORY_LIMITS.indexChars,
      out.itemIds.length,
      out.text.includes('## Specifics for this folder'),
      lastLine(out.text)
    ]).toEqual([true, 12, false, '1 more; use memory_search'])
  })
})
