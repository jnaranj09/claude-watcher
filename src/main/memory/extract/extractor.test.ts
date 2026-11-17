// Saving memory from sessions (addendum "Save points and the job", D9, D20–D25, D33; rulings R2,
// R7, R21–R24): save points, one job at a time, results. Real `:memory:` store, commands, state and
// goals store; fake transcripts, a fake model call, a hand-driven clock. Each test reads the save
// row, the store and the Past sessions record after the scenario, not only what was returned.
import { beforeEach, describe, expect, it } from 'vitest'
import { NO_COUNTS } from '../../../shared/schemas/memory'
import { EXTRACT_LIMITS } from '../../../shared/schemas/memoryExtract'
import { episode, specific, task } from '../../../__fixtures__/extractCandidates'
import {
  META,
  answer,
  bashCall,
  bashResult,
  createHarness,
  failure,
  flush,
  noise,
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
const DB = specific('db port', '5433', 'listens on port 5433')

/** Two prompts: enough for the substance guard. */
function firstPart(id = 's1'): void {
  h.write(
    id,
    prompt('the api now listens on port 9281 locally'),
    said('moved the api'),
    prompt('thanks, that works'),
    said('glad it works')
  )
}

/** `n` long prompts: about 3,900 characters each, so a chunk holds about 25 of them. */
function longPart(id: string, n: number): void {
  for (let i = 0; i < n; i += 1) h.write(id, prompt(`step ${i} ${'word '.repeat(780)}`))
}

const items = (): number => h.state.get('s1')?.counts.specifics ?? -1
const firstEntry = (input: string | undefined): number => Number(/\[#(\d+) /.exec(input ?? '')?.[1])

describe('save points', () => {
  it('queues a checkpoint at the 15th Stop and not before', async () => {
    firstPart()
    stops(h, 's1', 14)
    await h.ex.idle()
    expect(h.calls).toHaveLength(0)
    h.ex.stop('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]?.input).toContain('This is a checkpoint in a running session.')
  })

  it('never checkpoints while the setting is Off', async () => {
    h.set.checkpoint = 0
    firstPart()
    stops(h, 's1', 40)
    await h.ex.idle()
    expect(h.calls).toHaveLength(0)
    expect(h.state.get('s1')?.phase).toBe('live')
  })

  it('a Stop with Memory off makes no row and no call', async () => {
    h.set.enabled = false
    firstPart()
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(h.calls).toHaveLength(0)
    expect(h.state.get('s1')).toBeNull()
  })

  it('counts Stops per session', async () => {
    h.meta.set('s2', META)
    firstPart('s1')
    h.write('s2', prompt('the db listens on port 5433'), said('ok'), prompt('good'), said('ok'))
    stops(h, 's1', 14)
    stops(h, 's2', 14)
    await h.ex.idle()
    expect(h.calls).toHaveLength(0)
    h.ex.stop('s2')
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]?.input).toContain('port 5433')
  })
})

describe('an end', () => {
  it('an end saves, marks the row done and reports the whole session', async () => {
    firstPart()
    h.answers.push(answer([API]))
    stops(h, 's1', 15)
    await h.ex.idle()
    h.write(
      's1',
      prompt('the db listens on port 5433 now, restart the worker later'),
      said('noted the db port')
    )
    h.answers.push(
      answer([
        DB,
        task('restart the worker', 'restart the worker later'),
        episode('moved the ports', 'The api and db ports moved.', 'noted the db port')
      ])
    )
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'saved',
      specifics: 2,
      facts: 0,
      tasks: 1,
      episodes: 1,
      episodeId: expect.any(String)
    })
    expect(h.pushed).toEqual([
      {
        sessionName: 'fix api port',
        trigger: 'end',
        outcome: 'saved',
        counts: { specifics: 2, facts: 0, tasks: 1, episodes: 1 },
        reason: null
      }
    ])
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.goals.view().tasks.map((t) => t.title)).toEqual(['restart the worker'])
  })

  it('an end with no candidates says nothing new', async () => {
    firstPart()
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'nothing',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.pushed).toEqual([
      {
        sessionName: 'fix api port',
        trigger: 'end',
        outcome: 'nothing',
        counts: NO_COUNTS,
        reason: null
      }
    ])
    expect(h.state.get('s1')?.phase).toBe('done')
  })

  it('a session under 2 prompts gets no call and no push, and its record says nothing new', async () => {
    h.write('s1', prompt('the api now listens on port 9281'), said('ok'))
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(0)
    expect(h.pushed).toEqual([])
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'nothing',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_skipped reason=guard')
  })

  it('a checkpoint that saves is quiet; one that fails pushes failed', async () => {
    firstPart()
    h.answers.push(answer([API]), failure('timeout'))
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(h.pushed).toEqual([])
    h.write('s1', prompt('the db listens on port 5433'), said('ok'))
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(h.pushed).toEqual([
      {
        sessionName: 'fix api port',
        trigger: 'checkpoint',
        outcome: 'failed',
        counts: { ...NO_COUNTS, specifics: 1 },
        reason: null
      }
    ])
    expect(h.setMemory).not.toHaveBeenCalled()
    expect(h.state.get('s1')?.phase).toBe('live')
  })

  it('a turn with Memory on, then Memory off: the end writes off on the record, closes the row and starts nothing', async () => {
    firstPart()
    stops(h, 's1', 1)
    h.set.enabled = false
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.setMemory).toHaveBeenCalledWith('s1', { state: 'off', ...NO_COUNTS, episodeId: null })
    expect(h.calls).toHaveLength(0)
    expect(h.pushed).toEqual([])
    expect(h.state.get('s1')?.phase).toBe('done')
  })

  it('memory off at the end: the row is done, and a later start with memory on catches nothing up', async () => {
    firstPart()
    stops(h, 's1', 3)
    expect(h.state.get('s1')?.phase).toBe('live')
    h.set.enabled = false
    h.ex.ended('s1')
    expect(h.state.get('s1')?.phase).toBe('done')
    h.set.enabled = true
    const next = h.restart()
    next.catchUp()
    await next.idle()
    expect(h.calls).toHaveLength(0)
    expect(h.state.pending()).toEqual([])
  })

  it('a failed write is a failed call with reason write: the offset stays, an end pushes failed', async () => {
    firstPart()
    h.db.run(
      `CREATE TRIGGER refuse_items BEFORE INSERT ON item BEGIN SELECT RAISE(ABORT, 'refused'); END`
    )
    h.answers.push(answer([API]))
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    const row = h.state.get('s1')
    expect(row?.attempts).toBe(1)
    expect(row?.byteOffset).toBe(0)
    expect(row?.phase).toBe('ending')
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_failed reason=write')
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'failed',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.pushed.map((p) => p.outcome)).toEqual(['failed'])
  })

  it('an end whose read says more stays saving, and the next start reads the rest and writes the episode', async () => {
    firstPart()
    h.write('s1', prompt('the db listens on port 5433 too'), said('noted the db port'))
    h.set.linesPerRead = 4
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.calls.some((c) => c.input.includes('end of the session'))).toBe(false)
    expect(h.state.get('s1')?.phase).toBe('ending')
    expect(h.state.get('s1')?.byteOffset).toBe(400)
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'saving',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.pushed).toEqual([])

    h.set.linesPerRead = null
    h.answers.push(answer([episode('moved the ports', 'Both ports moved.', 'noted the db port')]))
    const next = h.restart()
    next.catchUp()
    await next.idle()
    expect(h.reads.at(-1)?.from).toBe(400)
    expect(firstEntry(h.calls[1]?.input)).toBe(5)
    expect(h.calls.at(-1)?.input).toContain('This is the end of the session.')
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'saved',
      ...NO_COUNTS,
      episodes: 1,
      episodeId: expect.any(String)
    })
    expect(h.pushed).toEqual([])
  })

  it('the check gets the saved notes, never the call own note', async () => {
    h.meta.set('s2', META)
    for (const id of ['s1', 's2']) firstPart(id)
    h.answers.push(answer([], 'the api port moved to 9281 today'))
    stops(h, 's1', 15)
    h.answers.push(answer([], 'the api port moved to 9281 today'))
    stops(h, 's2', 15)
    await h.ex.idle()
    for (const id of ['s1', 's2']) h.write(id, prompt('what is next'), said('nothing else'))
    // s1: the episode's evidence is only in this call's own note → dropped.
    h.answers.push(
      answer(
        [episode('worker plan', 'The worker restart was planned.', 'worker restart was planned')],
        'the worker restart was planned'
      )
    )
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.state.get('s1')?.counts.episodes).toBe(0)
    expect(h.logs).toContain(
      '[claude-watcher][memory] code=memory_candidates_dropped reason=evidence_not_found count=1'
    )
    // s2: the evidence is in a note saved before the call → kept.
    h.answers.push(answer([episode('api port', 'The api port moved.', 'api port moved to 9281')]))
    h.ex.ended('s2')
    await h.ex.idle()
    expect(h.state.get('s2')?.counts.episodes).toBe(1)
  })

  it('an end of a session with no name sets the record and pushes nothing', async () => {
    h.meta.set('s1', { ...META, sessionName: '' })
    firstPart()
    h.answers.push(answer([API]))
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'saved',
      ...NO_COUNTS,
      specifics: 1,
      episodeId: null
    })
    expect(h.pushed).toEqual([])
  })

  it('only the last chunk of an end asks for the episode', async () => {
    longPart('s1', 30)
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(2)
    expect(h.calls[0]?.input).toContain('This is a checkpoint in a running session.')
    expect(h.calls.at(-1)?.input).toContain('This is the end of the session.')
  })
})

describe('the queue and failures', () => {
  it('runs one call at a time across sessions', async () => {
    h.set.manual = true
    h.meta.set('s2', META)
    firstPart('s1')
    firstPart('s2')
    stops(h, 's1', 1)
    h.ex.ended('s1')
    stops(h, 's2', 1)
    h.ex.ended('s2')
    await flush()
    expect(h.calls).toHaveLength(1)
    h.calls[0]?.resolve(answer([]))
    await flush()
    expect(h.calls).toHaveLength(2)
    h.calls[1]?.resolve(answer([]))
    await h.ex.idle()
    expect(h.state.get('s2')?.phase).toBe('done')
  })

  it('a failed call leaves the slice for the next save point', async () => {
    firstPart()
    h.answers.push(failure('exit'))
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(h.state.get('s1')?.byteOffset).toBe(0)
    expect(h.state.get('s1')?.attempts).toBe(1)
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(h.calls[1]?.input).toBe(h.calls[0]?.input)
    expect(h.state.get('s1')?.byteOffset).toBe(400)
    expect(h.state.get('s1')?.attempts).toBe(0)
  })

  it('gives a chunk up after 3 failed calls and goes on with the next', async () => {
    longPart('s1', 30)
    h.answers.push(failure('exit'), failure('output'), failure('envelope'))
    for (let i = 0; i < 3; i += 1) {
      stops(h, 's1', 15)
      await h.ex.idle()
    }
    expect(h.calls).toHaveLength(4)
    expect(h.calls[3]?.input).not.toContain('[#1 operator]')
    expect(firstEntry(h.calls[3]?.input)).toBeGreaterThan(1)
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_gave_up')
    expect(h.state.get('s1')?.byteOffset).toBe(3000)
    expect(h.state.get('s1')?.entryCount).toBe(30)
  })

  it('a chunk records its commands with repeats; a failed chunk records none until it is written', async () => {
    h.write('s1', bashCall('b1', 'npm test'), bashResult('b1', 'ok'))
    h.write('s1', bashCall('b2', 'npm test'), bashResult('b2', 'ok'))
    longPart('s1', 30)
    h.write('s1', bashCall('b3', 'npm run build'), bashResult('b3', 'built'))
    longPart('s1', 30)
    h.write('s1', bashCall('b4', 'npm run lint'), bashResult('b4', 'clean'))
    h.answers.push(answer([]), failure('exit'))
    stops(h, 's1', 15)
    await h.ex.idle()
    const runs = (): [string, number][] =>
      h.commands
        .list('w1', { query: null, folder: null, offset: 0, limit: 10 })
        .rows.map((c) => [c.text, c.count])
    expect(runs()).toEqual([['npm test', 2]])
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(h.calls).toHaveLength(4)
    expect(runs()).toEqual([
      ['npm run lint', 1],
      ['npm run build', 1],
      ['npm test', 2]
    ])
  })

  it('a too-old claude fails the save with reason claude_version and says so once', async () => {
    h.set.version = false
    h.meta.set('s2', META)
    firstPart('s1')
    firstPart('s2')
    stops(h, 's1', 1)
    h.ex.ended('s1')
    stops(h, 's2', 1)
    h.ex.ended('s2')
    await h.ex.idle()
    expect(h.calls).toHaveLength(0)
    expect(h.pushed).toEqual([
      {
        sessionName: 'fix api port',
        trigger: 'end',
        outcome: 'failed',
        counts: NO_COUNTS,
        reason: 'claude_version'
      }
    ])
    expect(h.setMemory).toHaveBeenLastCalledWith('s2', {
      state: 'failed',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.logs).toContain(
      '[claude-watcher][memory] code=memory_extract_failed reason=claude_version'
    )
    expect(h.state.get('s1')?.phase).toBe('ending')
  })

  it('a job with three chunks asks the version gate once', async () => {
    longPart('s1', 60)
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(h.calls).toHaveLength(3)
    expect(h.versionOk).toHaveBeenCalledTimes(1)
  })

  it('a too-old claude keeps the sessions owed, and once claude is updated the next start saves them', async () => {
    h.set.version = false
    h.meta.set('s2', META)
    firstPart('s1')
    firstPart('s2')
    stops(h, 's1', 1)
    h.ex.ended('s1')
    stops(h, 's2', 1)
    h.ex.ended('s2')
    await h.ex.idle()
    for (let i = 0; i < 2; i += 1) {
      const start = h.restart()
      start.catchUp()
      await start.idle()
    }
    expect(h.calls).toHaveLength(0)
    expect(h.state.get('s1')?.attempts).toBe(0)
    expect(h.state.pending().map((r) => r.sessionId)).toEqual(['s1', 's2'])
    h.set.version = true
    h.answers.push(answer([API]), answer([]))
    const updated = h.restart()
    updated.catchUp()
    await updated.idle()
    expect(h.calls).toHaveLength(2)
    expect(h.state.pending()).toEqual([])
    expect(h.setMemory).toHaveBeenCalledWith('s1', {
      state: 'saved',
      ...NO_COUNTS,
      specifics: 1,
      episodeId: null
    })
  })

  it('a job stops after 12 calls: an end stays ending and saving, and pushes nothing', async () => {
    longPart('s1', 14 * 25)
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(EXTRACT_LIMITS.chunksPerJob)
    expect(h.state.get('s1')?.phase).toBe('ending')
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'saving',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.pushed).toEqual([])
  })

  it('no transcript for a session that never said anything: the end is quiet and closes the row (R49)', async () => {
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_no_transcript')
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'nothing',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.pushed).toEqual([])
  })
})

describe('catch-up and resume', () => {
  it('catch-up at start saves quietly from every pending row, closes it and sets its record', async () => {
    firstPart()
    stops(h, 's1', 3)
    h.answers.push(answer([API]))
    const next = h.restart()
    next.catchUp()
    await next.idle()
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'saved',
      ...NO_COUNTS,
      specifics: 1,
      episodeId: null
    })
    expect(h.pushed).toEqual([])
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_started trigger=catchup')
  })

  it('catch-up with memory off closes each pending row as off', async () => {
    firstPart()
    stops(h, 's1', 3)
    h.set.enabled = false
    const next = h.restart()
    next.catchUp()
    await next.idle()
    expect(h.calls).toHaveLength(0)
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'off',
      ...NO_COUNTS,
      episodeId: null
    })
  })

  it('a resumed session reads only what is new and rewrites its episode', async () => {
    firstPart()
    h.answers.push(answer([episode('api port', 'The api port moved.', 'moved the api')]))
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    const episodeId = h.state.get('s1')?.episodeId ?? ''
    h.write('s1', prompt('one more change to the api'), said('changed the api again'))
    h.ex.stop('s1')
    h.answers.push(
      answer([episode('api changed twice', 'The api changed again.', 'changed the api again')])
    )
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.reads.at(-1)?.from).toBe(400)
    expect(firstEntry(h.calls[1]?.input)).toBe(5)
    expect(h.state.get('s1')?.episodeId).toBe(episodeId)
    expect(h.store.get(episodeId)).toMatchObject({ title: 'api changed twice' })
    expect(h.state.get('s1')?.phase).toBe('done')
  })

  it('a read with no conversation line only moves the offset', async () => {
    h.write('s1', noise(), noise())
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(h.calls).toHaveLength(0)
    expect(h.state.get('s1')?.byteOffset).toBe(200)
    expect(h.state.get('s1')?.entryCount).toBe(0)
  })

  it('a job reads once, with readBytesPerJob, even when the slice says more', async () => {
    firstPart()
    h.write('s1', prompt('more text'), said('ok'))
    h.set.linesPerRead = 4
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(h.reads).toEqual([
      { path: '/transcripts/s1.jsonl', from: 0, max: EXTRACT_LIMITS.readBytesPerJob }
    ])
  })

  it('an end with nothing new and two notes makes one call for the episode; with an episode already, none', async () => {
    firstPart()
    h.answers.push(answer([], 'the api port moved to 9281'))
    stops(h, 's1', 15)
    await h.ex.idle()
    h.write('s1', prompt('and the docs'), said('ok'), prompt('fine'), said('ok'))
    h.answers.push(answer([], 'the docs were updated'))
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(h.state.get('s1')?.notes).toHaveLength(2)
    h.answers.push(answer([episode('api port', 'The api port moved.', 'api port moved to 9281')]))
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(3)
    expect(h.calls[2]?.input).toContain('(nothing new)')
    expect(h.calls[2]?.input).toContain('This is the end of the session.')
    expect(h.state.get('s1')?.episodeId).not.toBeNull()
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(3)
    expect(h.state.get('s1')?.phase).toBe('done')
  })

  it('a chunk that was written is not sent again after the next chunk failed', async () => {
    longPart('s1', 30)
    h.answers.push(answer([]), failure('exit'))
    stops(h, 's1', 15)
    await h.ex.idle()
    const second = firstEntry(h.calls[1]?.input)
    expect(second).toBeGreaterThan(1)
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(firstEntry(h.calls[2]?.input)).toBe(second)
    expect(h.state.get('s1')?.entryCount).toBe(30)
  })
})

describe('activity and logs', () => {
  it('records saved and dropped entries for a card on the board and none for a card that is gone', async () => {
    h.meta.set('s2', META)
    firstPart('s1')
    h.write('s2', prompt('the db listens on port 5433'), said('ok'), prompt('good'), said('ok'))
    const bad = specific('api host', 'example.org', 'the host is example.org')
    h.answers.push(answer([API, bad]), answer([DB, bad]))
    stops(h, 's1', 15)
    await h.ex.idle()
    const entries = h.activity.get('s1').entries
    expect(entries.map((e) => [e.action, e.tool, e.reason])).toEqual([
      ['saved', 'extract', null],
      ['dropped', 'extract', 'evidence_not_found']
    ])
    stops(h, 's2', 1)
    h.ex.ended('s2')
    h.meta.delete('s2')
    await h.ex.idle()
    expect(h.state.get('s2')?.counts.specifics).toBe(1)
    expect(h.activity.get('s2').entries).toEqual([])
    expect(items()).toBe(1)
  })

  it('logs codes only', async () => {
    firstPart()
    h.write('s1', prompt('the db listens on port 5433'), said('ok'))
    h.answers.push(
      { ok: false, reason: 'output', issue: { path: 'candidates.0.head', code: 'too_big' } },
      answer([API, specific('api host', 'example.org', 'the host is example.org')])
    )
    stops(h, 's1', 15)
    await h.ex.idle()
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.logs.length).toBeGreaterThan(0)
    expect(h.logs).toContain(
      '[claude-watcher][memory] code=memory_extract_invalid path=candidates.0.head issue=too_big'
    )
    expect(h.logs).toContain(
      '[claude-watcher][memory] code=memory_extract_done trigger=end saved=1 dropped=1'
    )
    for (const line of h.logs)
      expect(line).toMatch(/^\[claude-watcher\]\[memory\] code=memory_\w+( \w+=[\w.]+)*$/)
  })
})

describe('an end needs a turn', () => {
  const NO_ACTIVITY = '[claude-watcher][memory] code=memory_extract_skipped reason=no_activity'

  it('a row-less session ended with no turn makes no job, no row, no record, logs no_activity', async () => {
    for (let i = 0; i < 10; i += 1) h.write('s1', prompt(`old prompt ${i} about port 9281`))
    h.ex.ended('s1')
    await flush()
    expect(h.calls).toHaveLength(0)
    expect(h.setMemory).not.toHaveBeenCalled()
    expect(h.state.get('s1')).toBeNull()
    expect(h.logs).toContain(NO_ACTIVITY)
  })

  it('a session with a done row ended with no turn changes nothing', async () => {
    firstPart()
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    const before = h.state.get('s1')
    const records = h.setMemory.mock.calls.length
    h.write('s1', prompt('a look at the old session'), said('ok'))
    const next = h.restart()
    next.ended('s1')
    await flush()
    expect(h.calls).toHaveLength(1)
    expect(h.setMemory).toHaveBeenCalledTimes(records)
    expect(h.state.get('s1')?.byteOffset).toBe(before?.byteOffset)
    expect(h.state.get('s1')?.counts).toEqual(before?.counts)
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.logs).toContain(NO_ACTIVITY)
  })

  it('an end after one turn runs', async () => {
    firstPart()
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.state.get('s1')?.phase).toBe('done')
  })

  it('StopFailures count nothing toward a checkpoint', async () => {
    firstPart()
    for (let i = 0; i < 15; i += 1) h.ex.stopFailed('s1')
    await flush()
    expect(h.calls).toHaveLength(0)
    expect(h.state.get('s1')).toBeNull()
  })

  it('a StopFailure counts as a turn', async () => {
    firstPart()
    h.ex.stopFailed('s1')
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
  })

  it('a second end with no turn between makes no job', async () => {
    firstPart()
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.logs).toContain(NO_ACTIVITY)
  })

  it('/clear after turns, then archive with no new turn, makes one job', async () => {
    h.meta.set('s2', META)
    firstPart()
    stops(h, 's1', 1)
    h.ex.ended('s1')
    h.ex.rebind('s1', 's2')
    h.ex.ended('s2')
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.logs.filter((l) => l === NO_ACTIVITY)).toHaveLength(1)
  })

  it('turns while memory was off do not count', async () => {
    firstPart()
    h.set.enabled = false
    stops(h, 's1', 1)
    h.ex.stopFailed('s1')
    h.set.enabled = true
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(0)
    expect(h.state.get('s1')).toBeNull()
    expect(h.logs).toContain(NO_ACTIVITY)
  })

  it('memory off, no turn: the record keeps its state', async () => {
    firstPart()
    h.answers.push(answer([API]))
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', expect.objectContaining({ state: 'saved' }))
    const before = h.state.get('s1')
    const records = h.setMemory.mock.calls.length
    h.set.enabled = false
    const next = h.restart()
    next.ended('s1')
    await flush()
    expect(h.setMemory).toHaveBeenCalledTimes(records)
    expect(h.state.get('s1')).toEqual(before)
    expect(h.logs).toContain(NO_ACTIVITY)
  })

  it('forget drops the turn', async () => {
    firstPart()
    stops(h, 's1', 1)
    h.ex.forget('s1')
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(0)
    expect(h.logs).toContain(NO_ACTIVITY)
  })

  it('a no-turn /clear while the old id catch-up is queued logs no end_missing', async () => {
    h.meta.set('s0', META)
    for (const id of ['s0', 's1']) firstPart(id)
    stops(h, 's0', 1)
    stops(h, 's1', 1)
    h.set.manual = true
    const next = h.restart()
    next.catchUp()
    await flush()
    next.ended('s1')
    next.rebind('s1', 's2')
    expect(h.logs).not.toContain('[claude-watcher][memory] code=memory_extract_end_missing')
    h.set.manual = false
    h.calls[0]?.resolve(answer([]))
    await next.idle()
    expect(h.calls).toHaveLength(2)
  })
})

describe('a resumed session with no save row starts at the transcript end', () => {
  /** Ten prompts from before the resume; answers the transcript's size then. */
  function oldHistory(): number {
    for (let i = 0; i < 10; i += 1) h.write('s1', prompt(`old prompt ${i} about port 9281`))
    return h.transcripts.get('s1')?.at(-1)?.end ?? -1
  }

  it('a row-less resumed session archived with no Stop makes no job', async () => {
    oldHistory()
    h.ex.resumed('s1', 'w1')
    h.ex.ended('s1')
    await flush()
    expect(h.calls).toHaveLength(0)
    expect(h.setMemory).not.toHaveBeenCalled()
  })

  it('a resumed row-less session saves only text after the resume', async () => {
    const size = oldHistory()
    h.ex.resumed('s1', 'w1')
    firstPart()
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.reads[0]?.from).toBe(size)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]?.input).not.toContain('old prompt')
  })

  it('resumed on a session with a row changes nothing', async () => {
    firstPart()
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    const before = h.state.get('s1')
    h.write('s1', prompt('more text'))
    h.ex.resumed('s1', 'w1')
    expect(h.state.get('s1')).toEqual(before)
  })

  it('resumed with no transcript makes no row', () => {
    h.ex.resumed('s1', 'w1')
    expect(h.state.get('s1')).toBeNull()
  })

  it('resumed with memory off still seeds', () => {
    const size = oldHistory()
    h.set.enabled = false
    h.ex.resumed('s1', 'w1')
    expect(h.state.get('s1')).toEqual(
      expect.objectContaining({ byteOffset: size, phase: 'done', workspaceId: 'w1' })
    )
  })

  it('resumed whose transcript size cannot be read makes no row and logs it', () => {
    oldHistory()
    h.deps.size = () => null
    h.ex.resumed('s1', 'w1')
    expect(h.state.get('s1')).toBeNull()
    expect(h.logs).toContain(
      '[claude-watcher][memory] code=memory_extract_seed_skipped reason=size'
    )
  })

  it('resumed with the database closed makes no row and does not throw', () => {
    oldHistory()
    h.set.memoryOpen = false
    h.ex.resumed('s1', 'w1')
    h.set.memoryOpen = true
    expect(h.state.get('s1')).toBeNull()
  })

  it('memory-off turns, then resume and a real turn, save only text after the resume', async () => {
    h.set.enabled = false
    firstPart()
    stops(h, 's1', 1)
    h.set.enabled = true
    h.ex.ended('s1')
    expect(h.state.get('s1')).toBeNull()
    h.ex.resumed('s1', 'w1')
    const size = h.transcripts.get('s1')?.at(-1)?.end
    expect(h.state.get('s1')?.byteOffset).toBe(size)
    firstPart()
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.reads[0]?.from).toBe(size)
  })

  it('a seeded row whose transcript went missing ends nothing, not failed (R49)', async () => {
    oldHistory()
    h.ex.resumed('s1', 'w1')
    h.transcripts.delete('s1')
    stops(h, 's1', 1)
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'nothing',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.pushed).toEqual([])
  })
})
