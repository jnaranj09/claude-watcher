// Story 2.4 — the WebAudio attention-sound tests (jsdom `unit` project).
//
// Inject a FAKE AudioContext (the DI seam) + a fake asset fetch so NO real audio device and
// NO real asset are touched. Asserts:
//   - AC-1: once the cue buffer is decoded, each play() fires EXACTLY ONE source.start.
//   - AC-2 (no debounce): two play() calls → two source.start (the module adds no throttle).
//   - AC-8 never-crash: a throwing AudioContext factory / a decode failure / a throwing
//     source.start each degrade to a SILENT no-op (play() never throws); logs a `code=` ONLY.
//   - a suspended context attempts resume() (best-effort) and never throws.
// [Source: story 2.4 Task 4.4; AC-1/2/3/8; F1/F2; notifications.test.ts DI-seam style]
import { describe, it, expect, vi } from 'vitest'
import { createAttentionSound, type AudioContextLike, type AudioSourceLike } from './attentionSound'

/** A fake AudioBuffer sentinel — the module treats it opaquely (only assigns it to
 *  source.buffer), so a bare object cast is sound for the test path. */
const FAKE_BUFFER = { __fake: 'audiobuffer' } as unknown as AudioBuffer

/** Build a fake AudioContext that records every source.start. `state` controls the
 *  suspended-resume path; `decodeFails` simulates a decode failure; `startThrows` makes
 *  source.start throw (never-crash assertion). */
function makeFakeContext(
  opts: {
    state?: string
    decodeFails?: boolean
    startThrows?: boolean
  } = {}
): {
  ctx: AudioContextLike
  startCount: number
  resumeCount: number
} {
  let startCount = 0
  let resumeCount = 0
  const destination = {} as AudioNode
  const ctx: AudioContextLike = {
    destination,
    state: opts.state ?? 'running',
    decodeAudioData: async () => {
      if (opts.decodeFails) throw new Error('decode failed')
      return FAKE_BUFFER
    },
    createBufferSource: (): AudioSourceLike => ({
      buffer: null,
      connect: () => {},
      start: () => {
        if (opts.startThrows) throw new Error('start failed')
        startCount++
      }
    }),
    resume: async () => {
      resumeCount++
    }
  }
  return {
    ctx,
    get startCount() {
      return startCount
    },
    get resumeCount() {
      return resumeCount
    }
  }
}

/** Flush microtasks so the async decode kicked by the first play() resolves. */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('createAttentionSound — one sound per play, no debounce (AC-1/2)', () => {
  it('after the cue decodes, each play() fires EXACTLY ONE source.start', async () => {
    const fake = makeFakeContext()
    const sound = createAttentionSound({
      audioContextFactory: () => fake.ctx,
      fetchAsset: async () => new ArrayBuffer(8)
    })

    // First play() kicks the (async) decode — no sound yet.
    sound.play()
    expect(fake.startCount).toBe(0)
    await flush() // decode resolves, buffer cached

    sound.play()
    expect(fake.startCount).toBe(1)
  })

  it('two play() calls after warm-up → TWO source.start (NO internal debounce — AC-2)', async () => {
    const fake = makeFakeContext()
    const sound = createAttentionSound({
      audioContextFactory: () => fake.ctx,
      fetchAsset: async () => new ArrayBuffer(8)
    })
    sound.play() // warm the buffer
    await flush()

    sound.play()
    sound.play()
    expect(fake.startCount).toBe(2)
  })
})

describe('createAttentionSound — never-crash (AC-8)', () => {
  it('a throwing AudioContext factory degrades to a silent no-op (play never throws)', () => {
    const log = vi.fn()
    const sound = createAttentionSound({
      audioContextFactory: () => {
        throw new Error('no WebAudio')
      },
      log
    })
    expect(() => sound.play()).not.toThrow()
    expect(() => sound.play()).not.toThrow()
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('code=audiocontext_unavailable')
  })

  it('a decode failure degrades to a silent no-op (no source.start ever); logs a code', async () => {
    const fake = makeFakeContext({ decodeFails: true })
    const log = vi.fn()
    const sound = createAttentionSound({
      audioContextFactory: () => fake.ctx,
      fetchAsset: async () => new ArrayBuffer(8),
      log
    })
    sound.play() // kicks the decode (which fails)
    await flush()
    sound.play() // buffer still null → no sound
    expect(fake.startCount).toBe(0)
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('code=decode_failed')
  })

  it('a throwing source.start does NOT throw out of play(); logs a code', async () => {
    const fake = makeFakeContext({ startThrows: true })
    const log = vi.fn()
    const sound = createAttentionSound({
      audioContextFactory: () => fake.ctx,
      fetchAsset: async () => new ArrayBuffer(8),
      log
    })
    sound.play()
    await flush()
    expect(() => sound.play()).not.toThrow()
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('code=play_failed')
  })

  it('a suspended context attempts resume() (best-effort) and never throws', async () => {
    const fake = makeFakeContext({ state: 'suspended' })
    const sound = createAttentionSound({
      audioContextFactory: () => fake.ctx,
      fetchAsset: async () => new ArrayBuffer(8)
    })
    sound.play()
    await flush()
    sound.play()
    expect(fake.resumeCount).toBeGreaterThan(0)
    // Even suspended, a non-throwing source.start is recorded (resume is async/best-effort).
    expect(fake.startCount).toBe(1)
  })
})
