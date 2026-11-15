// The "saved or changed" block (spec 2026-11-14 memory context index §6): at an operator prompt,
// up to 5 keys that are new, changed, or newly related since the window's section was built ride
// before recall's items. Own file: memoryRecall.test.ts is near its line cap. Real `:memory:`
// store, real gate, real activity log; the session is a mutable stand-in.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryItem, MemoryText } from '../../shared/schemas/memory'
import { formatDay } from './formatDay'
import { createMemoryActivity, type MemoryActivityLog } from './memoryActivity'
import { openMemoryDb } from './memoryDb'
import { createMemoryGate } from './memoryGate'
import { createMemoryRecall, type MemoryRecall } from './memoryRecall'
import { createMemoryStore, type MemoryStore } from './memoryStore'
import type { MemorySessionMeta } from './memoryTools'

const NOW = 1_762_800_000_000
const DAY = formatDay(NOW)
const grant = { sessionId: 's1' }
const FRESH_HEADER = 'Memory (Claude Watcher): saved or changed since this conversation started'
const MOVED_LINE =
  'This session moved to another workspace. The lists at the start of this conversation no longer apply.'
const RECALL_HEADER = 'Memory (Claude Watcher): items that may match this prompt'
const OPERATOR_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge'])

let ids: number
let clock: number
let store: MemoryStore
let session: MemorySessionMeta
let activity: MemoryActivityLog
let recall: MemoryRecall

function build(
  over: { windowChars?: number; recallChars?: number; now?: () => number } = {}
): MemoryRecall {
  return createMemoryRecall({
    gate: createMemoryGate({
      enabled: () => true,
      store: () => store,
      session: (id) => (id === 's1' ? session : null)
    }),
    tasks: () => null,
    names: { goalName: () => null, tagName: () => null },
    activity,
    operatorOrigins: OPERATOR_ORIGINS,
    now: () => NOW,
    log: () => undefined,
    ...over
  })
}

beforeEach(() => {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  ids = 0
  clock = NOW
  store = createMemoryStore({
    db: open.db,
    now: () => clock,
    newId: () => `m${++ids}`,
    report: () => undefined,
    log: () => undefined
  })
  session = {
    workspaceId: 'w1',
    folder: '/work/app',
    sessionName: 'fix login',
    tagIds: [],
    templateId: null,
    goalId: null,
    taskIds: []
  }
  activity = createMemoryActivity(() => undefined)
  recall = build()
})

type Place = {
  folder?: string | null
  workspaceId?: string
  tagIds?: string[]
  goalId?: string
}

function add(text: MemoryText, place: Place = {}): MemoryItem {
  return store.add({
    text,
    workspaceId: place.workspaceId ?? 'w1',
    check: null,
    basis: 'inferred',
    origin: { by: 'agent', sessionId: 's0' },
    meta: {
      folder: place.folder === undefined ? '/work/app' : place.folder,
      sessionName: null,
      tagIds: place.tagIds ?? [],
      templateId: null,
      goalId: place.goalId ?? null,
      taskIds: []
    },
    source: null
  })
}

const specific = (key: string, value: string): MemoryText => ({ kind: 'specific', key, value })

/** A key added one second after the last change (after the section was built at NOW). */
function later(key: string, value: string, place: Place = {}): MemoryItem {
  clock += 1000
  return add(specific(key, value), place)
}

function edit(id: string, key: string, value: string): void {
  clock += 1000
  store.edit(id, { text: specific(key, value), check: null }, 'operator', null)
}

function index(window = 0): string {
  const out = recall.index(grant, { version: 1, window })
  if (!out.ok) throw new Error('index refused')
  return out.text
}

function recallText(text: string, origin = 'composer', window = 0): string {
  const out = recall.recall(grant, { version: 1, window, origin, text })
  if (!out.ok) throw new Error('recall refused')
  return out.text
}

/** A key line; an operator's edit (`edit`) makes the item `stated`. */
const line = (key: string, value: string, id: string, basis = 'inferred'): string =>
  `- ${key} = ${value} (seen ${DAY}, ${basis}) id=${id}`

describe('the saved or changed block', () => {
  it('a key saved after the section was built comes with the next prompt, once', () => {
    add(specific('api port', '9281'))
    index()
    later('new port', '7001')
    expect(recallText('hello there')).toBe(`${FRESH_HEADER}\n${line('new port', '7001', 'm2')}`)
    expect(recallText('hello again')).toBe('')
  })

  it('a prompt with no word to match still gets the block', () => {
    index()
    later('new port', '7001')
    expect(recallText('ok')).toBe(`${FRESH_HEADER}\n${line('new port', '7001', 'm1')}`)
  })

  it('a listed value that changed comes again with its new value', () => {
    const port = add(specific('api port', '9281'))
    expect(index()).toContain('api port = 9281')
    edit(port.id, 'api port', '9300')
    expect(recallText('which api port now')).toBe(
      `${FRESH_HEADER}\n${line('api port', '9300', port.id, 'stated')}`
    )
    expect(recallText('which api port again')).toBe('')
  })

  it('nothing new and the same context costs one count and adds nothing', () => {
    add(specific('api port', '9281'))
    index()
    const rows = vi.spyOn(store, 'contextRows')
    const counted = vi.spyOn(store, 'changedSince')
    expect(recallText('hello there')).toBe('')
    expect(rows).not.toHaveBeenCalled()
    expect(counted).toHaveBeenCalledTimes(1)
  })

  it('a tag added to the session brings the keys saved with that tag, once', () => {
    add(specific('other key', 'acme.test'), { folder: '/other', tagIds: ['t9'] })
    expect(index()).not.toContain('other key')
    session = { ...session, tagIds: ['t9'] }
    expect(recallText('hello there')).toBe(
      `${FRESH_HEADER}\n${line('other key', 'acme.test', 'm1')}`
    )
    expect(recallText('hello again')).toBe('')
  })

  it('a key the section already listed is not sent again when only the context changed', () => {
    add(specific('here key', '1234'), { tagIds: ['t9'] })
    expect(index()).toContain('here key')
    session = { ...session, tagIds: ['t9'] }
    expect(recallText('hello there')).toBe('')
  })

  it('a workspace change says so, then lists the new context', () => {
    add(specific('api port', '9281'))
    const there = add(specific('w2 port', '7002'), { workspaceId: 'w2' })
    index()
    session = { ...session, workspaceId: 'w2' }
    expect(recallText('hello there').split('\n')).toEqual([
      FRESH_HEADER,
      MOVED_LINE,
      line('w2 port', '7002', there.id)
    ])
    expect(recallText('hello again')).toBe('')
  })

  it('a workspace change with nothing to list still says so, once', () => {
    index()
    session = { ...session, workspaceId: 'w2' }
    expect(recallText('hello there')).toBe(`${FRESH_HEADER}\n${MOVED_LINE}`)
    expect(recallText('hello again')).toBe('')
  })

  it('at most five lines, the first reasons first', () => {
    session = { ...session, goalId: 'g1' }
    index()
    for (let i = 0; i < 8; i++) later(`folder key ${i}`, `${i}`)
    const goalA = later('goal key a', 'a', { folder: null, goalId: 'g1' })
    const goalB = later('goal key b', 'b', { folder: null, goalId: 'g1' })
    const lines = recallText('hello there').split('\n')
    expect(lines).toHaveLength(6)
    expect(lines.slice(1, 3)).toEqual([
      line('goal key b', 'b', goalB.id),
      line('goal key a', 'a', goalA.id)
    ])
  })

  it('the fresh lines come before recall items, and both fit 2,000 characters', () => {
    add(specific('deploy host', 'acme.test'), { folder: '/other' })
    index()
    const fresh = later('new port', '7001')
    const out = recallText('which deploy host')
    expect(out).toBe(
      [
        FRESH_HEADER,
        line('new port', '7001', fresh.id),
        RECALL_HEADER,
        `- deploy host: acme.test (seen ${DAY}, inferred) id=m1`
      ].join('\n')
    )
    expect(out.length).toBeLessThanOrEqual(2000)
  })

  it('when both do not fit the block, recall lines are left out first', () => {
    add(specific('deploy host', 'acme.test'), { folder: '/other' })
    const fresh = `${FRESH_HEADER}\n${line('new port', '7001', 'm2')}`
    recall = build({ recallChars: fresh.length + 20 })
    index()
    later('new port', '7001')
    expect(recallText('which deploy host')).toBe(fresh)
    expect(recallText('which deploy host again')).toContain('- deploy host: acme.test')
  })

  it('a key that is new and matches the prompt goes out once, in the fresh lines', () => {
    index()
    const fresh = later('deploy host', 'acme.test')
    expect(recallText('which deploy host')).toBe(
      `${FRESH_HEADER}\n${line('deploy host', 'acme.test', fresh.id)}`
    )
  })

  it('a block the window budget refuses tells nothing, and the next window can', () => {
    recall = build({ windowChars: 50 })
    index()
    later('new port', '7001')
    expect(recallText('hello there')).toBe('')
    expect(activity.get('s1').entries).toEqual([])
    expect(index(1)).toContain('new port = 7001')
  })

  it('a resumed window gets no fresh block', () => {
    recall.launched('s1', { excludeTaskIds: [], resume: true })
    index()
    later('new port', '7001')
    expect(recallText('hello there')).toBe('')
  })

  it('a window whose section was never asked gets no fresh block', () => {
    later('new port', '7001')
    expect(recallText('hello there')).toBe('')
  })

  it('a prompt that is not the operator gets no fresh block', () => {
    index()
    later('new port', '7001')
    expect(recallText('hello there', 'task-notification')).toBe('')
  })

  it('an item saved in another workspace never comes', () => {
    index()
    later('w2 port', '7002', { workspaceId: 'w2' })
    expect(recallText('hello there')).toBe('')
  })

  it('a hidden value stays hidden in the fresh block', () => {
    index()
    later('dbPassword', 'hunter2-hunter2')
    const out = recallText('hello there')
    expect(out).toContain('- dbPassword (value not shown, 15 chars')
    expect(out).not.toContain('hunter2')
  })

  it('a key this session saved itself is not sent back to it', () => {
    index()
    const own = later('own key', '4242')
    activity.record('s1', {
      at: clock,
      action: 'saved',
      tool: 'memory_save',
      itemId: own.id,
      reason: null
    })
    expect(recallText('hello there')).toBe('')
    edit(own.id, 'own key', '4343')
    expect(recallText('hello again')).toBe(
      `${FRESH_HEADER}\n${line('own key', '4343', own.id, 'stated')}`
    )
  })

  it('every fresh item is recorded as injected with a prompt, by id only', () => {
    index()
    const a = later('new port', '7001')
    const b = later('new host', 'acme.test')
    recallText('hello there')
    expect(activity.get('s1').entries.filter((e) => e.action === 'injected')).toEqual([
      { at: NOW, action: 'injected', tool: 'prompt', itemId: b.id, reason: null },
      { at: NOW, action: 'injected', tool: 'prompt', itemId: a.id, reason: null }
    ])
  })
})

describe('what the saved or changed block costs', () => {
  /** Recall on the store's clock and its section built; a prompt comes one millisecond after the
   *  last change; `runs` counts the selections after the section. */
  function counted(): { prompt: (text?: string) => string; runs: () => number } {
    recall = build({ now: () => clock })
    index()
    const rows = vi.spyOn(store, 'contextRows')
    return {
      prompt: (text = 'hello there') => {
        clock += 1
        return recallText(text)
      },
      runs: () => rows.mock.calls.length
    }
  }

  it('one save elsewhere in the workspace runs the selection once, then the count again', () => {
    add(specific('api port', '9281'))
    const { prompt, runs } = counted()
    expect(prompt()).toBe('')
    expect(runs()).toBe(0)
    later('other key', '1', { folder: '/other' })
    expect(prompt()).toBe('')
    expect(runs()).toBe(1)
    expect(prompt()).toBe('')
    expect(prompt('ok')).toBe('')
    expect(runs()).toBe(1)
    const fresh = later('new port', '7001')
    expect(prompt()).toBe(`${FRESH_HEADER}\n${line('new port', '7001', fresh.id)}`)
    expect(runs()).toBe(2)
    expect(prompt()).toBe('')
    expect(runs()).toBe(2)
  })

  it('a key saved in the same millisecond as a prompt, after it, comes with the next one', () => {
    const { prompt } = counted()
    later('other key', '1', { folder: '/other' })
    expect(prompt()).toBe('')
    const same = add(specific('same ms', '5'))
    expect(prompt()).toBe(`${FRESH_HEADER}\n${line('same ms', '5', same.id)}`)
  })

  it('a context change that relates no key runs the selection once', () => {
    const { prompt, runs } = counted()
    session = { ...session, tagIds: ['t9'] }
    expect(prompt()).toBe('')
    expect(prompt()).toBe('')
    expect(runs()).toBe(1)
  })

  it('keys left out by the five-line cap still come with the next prompt', () => {
    const { prompt, runs } = counted()
    for (let i = 0; i < 7; i++) later(`folder key ${i}`, `${i}`)
    expect(prompt().split('\n')).toHaveLength(6)
    expect(prompt().split('\n')).toEqual([
      FRESH_HEADER,
      line('folder key 1', '1', 'm2'),
      line('folder key 0', '0', 'm1')
    ])
    expect(prompt()).toBe('')
    expect(runs()).toBe(2)
  })
})
