// The extractor's fix round 1 (rulings R30–R34): a given-up chunk is a failure, a too-old claude
// is asked once per 10 minutes and never costs an attempt, a corrupt save row never stops the
// catch-up of the others, a second end with nothing new makes no job, and a `/clear` reported in
// the wrong order keeps the old transcript owed. R49: a session that never said anything ends
// quietly when it has no transcript. Same harness as the other extractor tests.
import { beforeEach, describe, expect, it } from 'vitest'
import { NO_COUNTS } from '../../../shared/schemas/memory'
import { EXTRACT_LIMITS } from '../../../shared/schemas/memoryExtract'
import { episode, specific } from '../../../__fixtures__/extractCandidates'
import {
  META,
  answer,
  createHarness,
  failure,
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

describe('R30: a given-up chunk is a failure', () => {
  it('an end whose chunk is given up on its third failed call is failed, never nothing new', async () => {
    conversation('s1')
    h.answers.push(failure('timeout'), failure('output'), failure('spawn'))
    stops(h, 's1', 15)
    await h.ex.idle()
    stops(h, 's1', 15)
    await h.ex.idle()
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_gave_up')
    expect(h.pushed.map((p) => [p.trigger, p.outcome])).toEqual([
      ['checkpoint', 'failed'],
      ['checkpoint', 'failed'],
      ['end', 'failed']
    ])
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'failed',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.state.get('s1')?.byteOffset).toBe(400)
  })

  it('a checkpoint that gives a chunk up pushes failed', async () => {
    conversation('s1')
    h.answers.push(failure('exit'), failure('exit'), failure('exit'))
    for (let i = 0; i < 3; i += 1) {
      stops(h, 's1', 15)
      await h.ex.idle()
    }
    expect(h.pushed.map((p) => p.outcome)).toEqual(['failed', 'failed', 'failed'])
    expect(h.state.get('s1')?.phase).toBe('live')
  })
})

describe('R31: a too-old answer is kept for 10 minutes', () => {
  it('30 owed sessions at a start with a too-old claude ask the version once and call nothing', async () => {
    for (let i = 0; i < 30; i += 1) {
      h.meta.set(`o${i}`, META)
      conversation(`o${i}`)
      stops(h, `o${i}`, 3)
    }
    h.set.version = false
    const start = h.restart()
    start.catchUp()
    await start.idle()
    expect(h.versionOk).toHaveBeenCalledTimes(1)
    expect(h.calls).toHaveLength(0)
    expect(h.setMemory.mock.calls.filter(([, m]) => m.state === 'failed')).toHaveLength(30)
    expect(h.pushed.map((p) => p.reason)).toEqual(['claude_version'])
    expect(h.state.pending()).toHaveLength(30)
  })

  it('a claude_version result nothing took is tried again by the next such failure (R38)', async () => {
    for (let i = 0; i < 3; i += 1) {
      h.meta.set(`o${i}`, META)
      conversation(`o${i}`)
      stops(h, `o${i}`, 3)
    }
    h.set.version = false
    h.set.pushTaken = false
    const start = h.restart()
    start.catchUp()
    await start.idle()
    expect(h.pushTries.count).toBe(3)
    expect(h.pushed).toEqual([])
  })

  it('a job within 10 minutes is not asked again; one after 10 minutes is', async () => {
    h.set.version = false
    conversation('s1')
    h.ex.ended('s1')
    await h.ex.idle()
    h.clock.now += EXTRACT_LIMITS.versionRecheckMs - 1
    h.ex.catchUp()
    await h.ex.idle()
    expect(h.versionOk).toHaveBeenCalledTimes(1)
    h.clock.now += 1
    h.set.version = true
    h.ex.catchUp()
    await h.ex.idle()
    expect(h.versionOk).toHaveBeenCalledTimes(2)
    expect(h.calls).toHaveLength(1)
    expect(h.state.get('s1')?.phase).toBe('done')
  })
})

describe('R33: a corrupt save row', () => {
  it('catch-up skips a row that fails its schema, logs a count, and saves the others', async () => {
    h.meta.set('s2', META)
    conversation('s1')
    conversation('s2', 'the db listens on port 5433')
    stops(h, 's1', 3)
    stops(h, 's2', 3)
    h.db.run(`UPDATE extract_state SET meta = '{}' WHERE session_id = 's1'`)
    const start = h.restart()
    start.catchUp()
    await start.idle()
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_state_invalid count=1')
    expect(h.calls).toHaveLength(1)
    expect(h.state.get('s2')?.phase).toBe('done')
  })
})

describe('R34: an end with nothing new', () => {
  it('a second end with nothing new makes no job, no call and no push', async () => {
    conversation('s1')
    h.answers.push(answer([episode('api port', 'The api port moved.', 'moved the api')]))
    h.ex.ended('s1')
    await h.ex.idle()
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.pushed).toHaveLength(1)
    expect(h.logs.filter((l) => l.includes('memory_extract_started'))).toHaveLength(1)
    expect(h.logs).toContain(
      '[claude-watcher][memory] code=memory_extract_skipped reason=nothing_new'
    )
  })

  it('a second end while the first is still queued makes no second job', async () => {
    h.set.manual = true
    h.meta.set('s0', META)
    conversation('s0', 'the db listens on port 5433')
    conversation('s1')
    h.ex.ended('s0')
    h.ex.ended('s1')
    h.ex.ended('s1')
    h.set.manual = false
    h.calls[0]?.resolve(answer([]))
    await h.ex.idle()
    expect(h.calls).toHaveLength(2)
    expect(h.pushed.map((p) => p.trigger)).toEqual(['end', 'end'])
  })

  it('a second end while the first runs makes no second job and no second push', async () => {
    h.set.manual = true
    conversation('s1')
    h.ex.ended('s1')
    await flush()
    h.ex.ended('s1')
    h.calls[0]?.resolve(answer([episode('api port', 'The api port moved.', 'moved the api')]))
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.pushed).toHaveLength(1)
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', expect.objectContaining({ state: 'saved' }))
  })

  it('a resumed session with a new turn ends normally', async () => {
    conversation('s1')
    h.ex.ended('s1')
    await h.ex.idle()
    h.write('s1', prompt('the api listens on port 9281 again'), said('ok'))
    h.ex.stop('s1')
    h.answers.push(answer([API]))
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(2)
    expect(h.pushed.map((p) => p.outcome)).toEqual(['nothing', 'saved'])
  })
})

describe('/clear in the wrong order', () => {
  it('a rebind before the end keeps the old transcript owed under the new id and logs it', async () => {
    conversation('old')
    h.meta.set('old', META)
    stops(h, 'old', 3)
    h.ex.rebind('old', 'new')
    expect(h.logs).toContain('[claude-watcher][memory] code=memory_extract_end_missing')
    expect(h.state.get('old')?.phase).toBe('ending')
    expect(h.state.get('old')?.originSessionId).toBe('new')
    h.answers.push(answer([API]))
    const start = h.restart()
    start.catchUp()
    await start.idle()
    expect(h.state.get('old')?.counts.specifics).toBe(1)
  })

  it('a rebind after the end logs nothing', async () => {
    conversation('old')
    h.meta.set('old', META)
    h.ex.ended('old')
    h.ex.rebind('old', 'new')
    await h.ex.idle()
    expect(h.logs).not.toContain('[claude-watcher][memory] code=memory_extract_end_missing')
  })
})

describe('what the reviewer found untested', () => {
  it('the substance guard waits for a read that left lines unread', async () => {
    conversation('s1')
    h.set.linesPerRead = 2
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
    expect(h.state.get('s1')?.phase).toBe('ending')
  })

  it('a rebind carries the Stop count to the new id', async () => {
    h.meta.set('old', META)
    stops(h, 'old', 14)
    h.ex.rebind('old', 'new')
    h.meta.set('new', META)
    conversation('new')
    h.ex.stop('new')
    await h.ex.idle()
    expect(h.calls).toHaveLength(1)
  })

  it('the done log counts what was written, not what the model labelled', async () => {
    conversation('s1')
    h.answers.push(answer([API]), answer([API]))
    stops(h, 's1', 15)
    await h.ex.idle()
    h.write('s1', prompt('the api still listens on port 9281'), said('yes'))
    stops(h, 's1', 15)
    await h.ex.idle()
    expect(h.logs).toContain(
      '[claude-watcher][memory] code=memory_extract_done trigger=checkpoint saved=0 dropped=0'
    )
  })
})

describe('R49: no transcript', () => {
  it('a card left open at quit that never said anything is closed quietly by the next start', async () => {
    stops(h, 's1', 1)
    const start = h.restart()
    start.catchUp()
    await start.idle()
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.setMemory.mock.calls.filter(([, m]) => m.state === 'failed')).toEqual([])
    expect(h.pushed).toEqual([])
    expect(h.calls).toHaveLength(0)
  })

  it('an end whose transcript went missing after a save read it still fails', async () => {
    conversation('s1')
    stops(h, 's1', 15)
    await h.ex.idle()
    h.transcripts.delete('s1')
    h.ex.ended('s1')
    await h.ex.idle()
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'failed',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.pushed.map((p) => [p.trigger, p.outcome])).toEqual([['end', 'failed']])
  })

  it('a catch-up whose transcript went missing after a save read it still fails', async () => {
    conversation('s1')
    stops(h, 's1', 15)
    await h.ex.idle()
    h.transcripts.delete('s1')
    const start = h.restart()
    start.catchUp()
    await start.idle()
    expect(h.state.get('s1')?.phase).toBe('done')
    expect(h.setMemory).toHaveBeenLastCalledWith('s1', {
      state: 'failed',
      ...NO_COUNTS,
      episodeId: null
    })
    expect(h.pushed.map((p) => [p.trigger, p.outcome])).toEqual([['catchup', 'failed']])
  })
})
