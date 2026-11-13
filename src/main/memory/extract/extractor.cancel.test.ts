// The extractor when its session goes away or the app quits while a job runs (addendum "Save
// points and the job"; R17): quit kills the call with `killNow()`, a forget cancels it, a `/clear`
// moves what is written next to the card's new id, Memory switched off cancels the call and stops
// the job (R51), a full queue refuses only a checkpoint, and one bad session never stops the
// others. Each test ends in a defined state of the save row, the store and the Past sessions
// record.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_COUNTS } from '../../../shared/schemas/memory'
import { specific } from '../../../__fixtures__/extractCandidates'
import {
  META,
  answer,
  createHarness,
  flush,
  prompt,
  said,
  stops,
  type Harness
} from '../../../__fixtures__/extractorHarness'

let h: Harness

beforeEach(() => {
  h = createHarness()
  h.meta.set('s1', META)
})

const API = specific('api port', '9281', 'listens on port 9281')

function conversation(id: string, text = 'the api now listens on port 9281 locally'): void {
  h.write(id, prompt(text), said('moved the api'), prompt('thanks, that works'), said('glad'))
}

function itemCount(): number {
  return h.store.search(
    { workspaceId: 'w1', includeGlobal: true },
    { kind: null, query: null, filters: { includeStale: true }, offset: 0, limit: 100 },
    { sessionFolder: null, tagIdsByName: () => [], goalIdsByName: () => [] }
  ).total
}

describe('quit', () => {
  it('quit kills the running call with killNow, never cancel, writes nothing, pushes nothing, and the row stays ending', async () => {
    h.set.manual = true
    conversation('s1')
    h.ex.ended('s1')
    await flush()
    expect(h.calls).toHaveLength(1)
    h.ex.quit()
    expect(h.calls[0]?.killNow).toHaveBeenCalledTimes(1)
    expect(h.calls[0]?.cancel).not.toHaveBeenCalled()
    h.calls[0]?.resolve({ ok: false, reason: 'cancelled', issue: null })
    await h.ex.idle()
    expect(itemCount()).toBe(0)
    expect(h.pushed).toEqual([])
    expect(h.state.get('s1')?.phase).toBe('ending')
    expect(h.state.get('s1')?.attempts).toBe(0)
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'saving',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_cancelled')
  })

  it('a call that answers after quit writes nothing', async () => {
    h.set.manual = true
    conversation('s1')
    h.ex.ended('s1')
    await flush()
    h.ex.quit()
    h.calls[0]?.resolve(answer([API]))
    await h.ex.idle()
    expect(itemCount()).toBe(0)
    expect(h.state.get('s1')?.byteOffset).toBe(0)
  })

  it('an end after quit only marks the row', async () => {
    conversation('s1')
    h.ex.quit()
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(0)
    expect(h.state.get('s1')?.phase).toBe('ending')
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'saving',
      ...NO_COUNTS,
      episodeId: null
    })
  })

  it('quit drops the queued jobs, and the next start catches their rows up', async () => {
    h.set.manual = true
    h.meta.set('s2', META)
    conversation('s1')
    conversation('s2', 'the db listens on port 5433')
    h.ex.ended('s1')
    h.ex.ended('s2')
    await flush()
    h.ex.quit()
    h.calls[0]?.resolve({ ok: false, reason: 'cancelled', issue: null })
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.state.pending().map((r) => r.sessionId)).toEqual(['s1', 's2'])
  })
})

describe('a session that goes away', () => {
  it('forget cancels the job (cancel, not killNow) and deletes the row; items already saved stay', async () => {
    conversation('s1')
    h.answers.push(answer([API]))
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(itemCount()).toBe(1)
    h.set.manual = true
    h.write('s1', prompt('the db listens on port 5433'), said('ok'))
    stops(h, 's1', 15)
    await flush()
    expect(h.calls).toHaveLength(2)
    h.ex.forget('s1')
    expect(h.calls[1]?.cancel).toHaveBeenCalledTimes(1)
    expect(h.calls[1]?.killNow).not.toHaveBeenCalled()
    expect(h.state.get('s1')).toBeNull()
    h.calls[1]?.resolve({ ok: false, reason: 'cancelled', issue: null })
    await h.ex.idle()
    expect(itemCount()).toBe(1)
    expect(h.pushed).toEqual([])
  })

  it('/clear during a call: what is written carries the new card id', async () => {
    h.set.manual = true
    h.meta.set('old', META)
    conversation('old')
    h.ex.ended('old')
    await flush()
    h.ex.rebind('old', 'new')
    h.meta.delete('old')
    h.meta.set('new', META)
    h.calls[0]?.resolve(answer([API]))
    await h.ex.idle()
    const rows = h.store.search(
      { workspaceId: 'w1', includeGlobal: true },
      { kind: null, query: null, filters: { includeStale: true }, offset: 0, limit: 100 },
      { sessionFolder: null, tagIdsByName: () => [], goalIdsByName: () => [] }
    ).rows
    expect(rows).toHaveLength(1)
    expect(h.store.get(rows[0]?.id ?? '')?.origin.sessionId).toBe('new')
    expect(h.activity.get('new').entries.map((e) => e.action)).toEqual(['saved'])
    expect(h.setMemory).toHaveBeenLastCalledWith('old', {
      state: 'saved',
      ...NO_COUNTS,
      specifics: 1,
      episodeId: null
    })
  })

  it('a call that resolves after its session was forgotten writes nothing', async () => {
    h.set.manual = true
    conversation('s1')
    h.ex.ended('s1')
    await flush()
    h.ex.forget('s1')
    h.calls[0]?.resolve(answer([API]))
    await h.ex.idle()
    expect(itemCount()).toBe(0)
    expect(h.pushed).toEqual([])
    expect(h.state.get('s1')).toBeNull()
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'saving',
      ...NO_COUNTS,
      episodeId: null
    })
  })

  it('a workspace delete cancels its sessions jobs and deletes their rows', async () => {
    h.set.manual = true
    h.meta.set('s2', { ...META, workspaceId: 'w2' })
    conversation('s1')
    conversation('s2', 'the db listens on port 5433')
    h.ex.ended('s1')
    h.ex.ended('s2')
    await flush()
    h.ex.forgetWorkspace('w1')
    expect(h.calls[0]?.cancel).toHaveBeenCalledTimes(1)
    h.calls[0]?.resolve({ ok: false, reason: 'cancelled', issue: null })
    await flush()
    h.calls[1]?.resolve(answer([]))
    await h.ex.idle()
    expect(h.state.get('s1')).toBeNull()
    expect(h.state.get('s2')?.phase).toBe('done')
  })

  it('Memory switched off between two chunks stops the job before its next call and closes an end as off (R2)', async () => {
    for (let i = 0; i < 30; i += 1) h.write('s1', prompt(`step ${i} ${'word '.repeat(780)}`))
    // After the first call, its write asks for the card's stamp: Memory goes off right then.
    const meta = h.deps.sessionMeta
    h.deps.sessionMeta = (id) => {
      if (h.calls.length > 0) h.set.enabled = false
      return meta(id)
    }
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'off',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.pushed).toEqual([])
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_skipped reason=off')
  })
})

describe('Memory switched off while a call runs (R51)', () => {
  it('memoryOff cancels the running call; nothing is written and an end is closed as off', async () => {
    h.set.manual = true
    conversation('s1')
    h.ex.ended('s1')
    await flush()
    h.set.enabled = false
    h.ex.memoryOff()
    expect(h.calls[0]?.cancel).toHaveBeenCalledTimes(1)
    h.calls[0]?.resolve({ ok: false, reason: 'cancelled', issue: null })
    await h.ex.idle()
    expect(itemCount()).toBe(0)
    expect(h.pushed).toEqual([])
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'off',
      ...NO_COUNTS,
      episodeId: null
    })
  })

  it('an answer that arrives after Memory went off is not written', async () => {
    h.set.manual = true
    conversation('s1')
    h.ex.ended('s1')
    await flush()
    h.set.enabled = false
    h.calls[0]?.resolve(answer([API]))
    await h.ex.idle()
    expect(itemCount()).toBe(0)
    expect(h.state.get('s1')?.byteOffset).toBe(0)
    expect(h.pushed).toEqual([])
  })

  it('a checkpoint stopped by Memory off leaves its live row as it was', async () => {
    h.set.manual = true
    conversation('s1')
    stops(h, 's1', 15)
    await flush()
    h.set.enabled = false
    h.ex.memoryOff()
    h.calls[0]?.resolve({ ok: false, reason: 'cancelled', issue: null })
    await h.ex.idle()
    expect(itemCount()).toBe(0)
    expect(h.state.get('s1')?.phase).toBe('live')
    expect(h.setMemory).not.toHaveBeenCalled()
  })

  it('memoryOff with no call running changes nothing', async () => {
    conversation('s1')
    h.ex.memoryOff()
    stops(h, 's1', 15)
    h.answers.push(answer([API]))
    await h.ex.idle()
    expect(itemCount()).toBe(1)
  })
})

describe('the queue', () => {
  it('a full queue refuses a checkpoint with a code and still takes an end', async () => {
    h.set.manual = true
    h.set.checkpoint = 10
    for (let i = 0; i <= 51; i += 1) {
      h.meta.set(`q${i}`, META)
      conversation(`q${i}`)
    }
    for (let i = 0; i <= 51; i += 1) stops(h, `q${i}`, 10)
    expect(h.logs).toEqual([
      '[claude-watcher][memory] code=memory_extract_started trigger=checkpoint',
      '[claude-watcher][memory] code=memory_extract_queue_full'
    ])
    h.ex.ended('q51')
    h.set.manual = false
    await flush()
    h.calls[0]?.resolve(answer([]))
    await h.ex.idle()
    expect(h.calls).toHaveLength(52)
    expect(h.state.get('q51')?.phase).toBe('done')
    expect(h.setMemory).toHaveBeenLastCalledWith('q51', {
      state: 'nothing',
      ...NO_COUNTS,
      episodeId: null
    })
  })

  it('an end while a checkpoint of the same session runs is saved after it, from where it stopped', async () => {
    h.set.manual = true
    conversation('s1')
    stops(h, 's1', 15)
    await flush()
    h.write('s1', prompt('the db listens on port 5433'), said('ok'))
    h.ex.ended('s1')
    h.set.manual = false
    h.answers.push(answer([specific('db port', '5433', 'listens on port 5433')]))
    h.calls[0]?.resolve(answer([API]))
    await h.ex.idle()
    expect(h.calls).toHaveLength(2)
    expect(h.calls[1]?.input).toContain('[#5 operator]')
    expect(h.calls[1]?.input).not.toContain('[#1 operator]')
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'saved',
      ...NO_COUNTS,
      specifics: 2,
      episodeId: null
    })
  })

  it('an end merges into the session queued checkpoint and wins', async () => {
    h.set.manual = true
    h.meta.set('s0', META)
    conversation('s0', 'the db listens on port 5433')
    conversation('s1')
    stops(h, 's0', 15)
    stops(h, 's1', 15)
    await flush()
    h.ex.ended('s1')
    h.set.manual = false
    h.calls[0]?.resolve(answer([]))
    await h.ex.idle()
    expect(h.calls).toHaveLength(2)
    expect(h.calls[1]?.input).toContain('This is the end of the session.')
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.pushed.map((p) => [p.trigger, p.outcome])).toEqual([['end', 'nothing']])
  })

  it('two checkpoints of one session while one runs are one queued job', async () => {
    h.set.manual = true
    h.set.checkpoint = 10
    conversation('s1')
    stops(h, 's1', 10)
    await flush()
    stops(h, 's1', 20)
    h.set.manual = false
    h.calls[0]?.resolve(answer([]))
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.logs.filter((l) => l.includes('memory_extract_started'))).toHaveLength(2)
  })
})

describe('never crash', () => {
  it('a throw from one session is a failed call with reason internal, and the others still save', async () => {
    h.meta.set('s2', META)
    conversation('s1')
    conversation('s2', 'the db listens on port 5433')
    const locate = h.deps.locate
    h.deps.locate = (id) => {
      if (id === 's1') throw new Error('unreadable')
      return locate(id)
    }
    h.answers.push(answer([specific('db port', '5433', 'listens on port 5433')]))
    h.ex.ended('s1')
    h.ex.ended('s2')
    await h.ex.idle()
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_failed reason=internal')
    expect(h.state.get('s1')?.phase).toBe('ending')
    expect(h.state.get('s1')?.attempts).toBe(1)
    expect(h.setMemory).toHaveBeenCalledWith('s1', {
      state: 'failed',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.pushed.map((p) => p.outcome)).toEqual(['failed', 'saved'])
    expect(h.state.get('s2')?.phase).toBe('done')
    expect(h.state.get('s2')?.counts.specifics).toBe(1)
  })

  it('a step that always throws is given up at the third failure, not repeated at every start', async () => {
    conversation('s1')
    h.deps.locate = () => {
      throw new Error('unreadable')
    }
    h.ex.ended('s1')
    await h.ex.idle()
    for (let i = 0; i < 3; i += 1) {
      const start = h.restart()
      start.catchUp()
      await start.idle()
    }
    expect(h.state.get('s1')?.attempts).toBe(3)
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.logs.filter((l) => l.endsWith('reason=internal'))).toHaveLength(3)
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_gave_up')
    expect(h.pushed.map((p) => [p.trigger, p.outcome])).toEqual([
      ['end', 'failed'],
      ['catchup', 'failed'],
      ['catchup', 'failed']
    ])
  })

  it.each([3, 4])(
    '%i unreadable reads at checkpoints never close the row, and the end still saves the text',
    async (failures) => {
      conversation('s1')
      const read = h.deps.read
      h.deps.read = () => Promise.resolve(null)
      for (let i = 0; i < failures; i += 1) {
        stops(h, 's1', 15)
        await h.ex.idle()
      }
      expect(h.state.get('s1')?.attempts).toBe(failures)
      expect(h.state.get('s1')?.phase).toBe('live')
      h.deps.read = read
      h.answers.push(answer([API]))
      h.ex.ended('s1')
      await h.ex.idle()
      expect(h.calls).toHaveLength(1)
      expect(h.state.get('s1')?.phase).toBe('done')
      expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
        state: 'saved',
        ...NO_COUNTS,
        specifics: 1,
        episodeId: null
      })
    }
  )

  it('a job whose failure cannot even be counted never rejects, and the next session still saves', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      h.meta.set('s2', META)
      conversation('s1')
      conversation('s2', 'the db listens on port 5433')
      const get = h.state.get
      let broken = false
      h.state.get = (id) => {
        if (broken) throw new Error('database refuses reads')
        return get(id)
      }
      h.ex.ended('s1')
      broken = true
      await expect(h.ex.idle()).resolves.toBeUndefined()
      await flush()
      expect(unhandled).not.toHaveBeenCalled()
      expect(
        h.logs.filter((l) => l.endsWith('code=memory_extract_failed reason=internal'))
      ).toHaveLength(2)
      broken = false
      h.ex.ended('s2')
      await h.ex.idle()
      expect(h.state.get('s2')?.phase).toBe('done')
      expect(h.state.get('s1')?.attempts).toBe(0)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('an unreadable transcript is a failed attempt, and the next session still saves', async () => {
    h.meta.set('s2', META)
    conversation('s1')
    conversation('s2', 'the db listens on port 5433')
    const read = h.deps.read
    h.deps.read = (path, from, max) =>
      path.includes('s1') ? Promise.resolve(null) : read(path, from, max)
    h.ex.ended('s1')
    h.ex.ended('s2')
    await h.ex.idle()
    expect(h.state.get('s1')?.phase).toBe('ending')
    expect(h.state.get('s1')?.attempts).toBe(1)
    expect(h.setMemory).toHaveBeenCalledWith('s1', {
      state: 'failed',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.state.get('s2')?.phase).toBe('done')
  })

  const METHODS: [string, (ex: Harness['ex']) => void][] = [
    ['stop', (ex) => ex.stop('s1')],
    ['ended', (ex) => ex.ended('s1')],
    ['forget', (ex) => ex.forget('s1')],
    ['forgetWorkspace', (ex) => ex.forgetWorkspace('w1')],
    ['rebind', (ex) => ex.rebind('s1', 's9')],
    ['catchUp', (ex) => ex.catchUp()]
  ]

  it.each(METHODS)(
    '%s never throws when the database throws, and the queue still serves others',
    async (_name, method) => {
      conversation('s1')
      stops(h, 's1', 3)
      const memory = h.deps.memory
      h.deps.memory = () => {
        throw new Error('database gone')
      }
      expect(() => method(h.ex)).not.toThrow()
      expect(h.logs).toContain(
        '[claude-watcher][memory] code=memory_extract_failed reason=internal'
      )
      h.deps.memory = memory
      h.meta.set('s2', META)
      conversation('s2', 'the db listens on port 5433')
      h.ex.ended('s2')
      await h.ex.idle()
      expect(h.state.get('s2')?.phase).toBe('done')
    }
  )

  it.each([
    [
      'a session stamp',
      (): void => {
        h.deps.sessionMeta = () => {
          throw new Error('board gone')
        }
      }
    ],
    [
      'the record',
      (): void => {
        h.deps.pastSessions = () => ({
          setMemory: () => {
            throw new Error('record refused')
          }
        })
      }
    ]
  ])('stop and ended never throw when %s throws', (_name, breakIt) => {
    conversation('s1')
    breakIt()
    expect(() => {
      h.ex.stop('s1')
      h.ex.ended('s1')
    }).not.toThrow()
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_failed reason=internal')
  })
})
