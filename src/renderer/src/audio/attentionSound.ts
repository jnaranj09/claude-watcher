// Story 2.4 — the WebAudio attention sound (RENDERER process).
//
// Plays ONE short bundled sound per `play()` call (AC-1). The CALLER (the wiring in Task 5)
// fires `play()` 1:1 off `attention.raised` ONLY when sound is enabled — this module adds NO
// debounce/cooldown of its own (AC-2/F2: the Story-1.2 per-session ~700ms attention-emission
// debounce is the SOLE storm-suppression authority; the mute toggle is the SOLE sound
// governor). Two `play()` calls → two sounds. There is NO timer/throttle anywhere here.
//
// NEVER-CRASH (AC-8 / PRECEDENCE #2): WebAudio may be unavailable (no AudioContext), the asset
// may fail to decode, or the context may be suspended (autoplay gesture not yet granted). EVERY
// such failure degrades to a SILENT no-op + a `code=` log — `play()` NEVER throws. One failed
// sound must never take the board/feed/notification/badge down.
//
// DI seam (testability): the `AudioContext` constructor + the asset URL are injected, so the
// jsdom unit test passes a FAKE context (no real audio device) and asserts "exactly one
// source.start per play / silent when the seam throws". The default ctor reads the real
// `window.AudioContext`; the default URL is the bundled asset (import-as-URL). The sound is
// alert-only — NO self-raise anywhere on this path.
// [Source: story 2.4 Task 4; AC-1/2/3/8; F1/F2; AR-8 ("sound via renderer WebAudio");
//  UX-DR26 ("one short sound … never auto-escalate"); src/main/kde/notifications.ts (DI seam +
//  never-crash + code-only-log precedent)]

// The bundled cue, imported AS A URL so electron-vite emits it as a renderer asset. A short,
// non-startling rising chime (E5→A5, ~180ms). [UX-DR26]
import attentionAssetUrl from './attention.wav?url'

/** The minimal slice of an `AudioBufferSourceNode` we use. Kept tiny so the test fake
 *  implements exactly this. */
export interface AudioSourceLike {
  buffer: AudioBuffer | null
  connect(destination: AudioNode): void
  start(): void
}

/** The minimal slice of an `AudioContext` this module needs (so the test fake is small and
 *  no real audio device is touched). */
export interface AudioContextLike {
  readonly destination: AudioNode
  readonly state: string
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>
  createBufferSource(): AudioSourceLike
  resume(): Promise<void>
}

/** The injectable AudioContext constructor seam. The default reads the real
 *  `window.AudioContext` (or the webkit-prefixed fallback); a test injects a fake. Returns a
 *  constructed context or throws (the caller catches → silent no-op). */
export type AudioContextFactory = () => AudioContextLike

export interface AttentionSoundOptions {
  /** The AudioContext factory (DI seam). Defaults to the real `window.AudioContext`. */
  audioContextFactory?: AudioContextFactory
  /** The bundled cue URL (DI seam). Defaults to the import-as-URL asset. */
  assetUrl?: string
  /** Fetch the asset bytes (DI seam). Defaults to `fetch(url).then(r => r.arrayBuffer())`.
   *  Injected so tests need no network/asset and can simulate a fetch/decode failure. */
  fetchAsset?: (url: string) => Promise<ArrayBuffer>
  /** Log sink — a `code=` ONLY, never a value (Guardrail #6). Defaults to console.warn. */
  log?: (message: string) => void
}

export interface AttentionSound {
  /** Play ONE short sound. NEVER throws (never-crash). NO internal debounce/cooldown — the
   *  caller gates on the live `soundEnabled` flag and fires 1:1 off `attention.raised`. */
  play(): void
}

/** The default AudioContext factory — the ONLY place the real `window.AudioContext` is read.
 *  NOT on the unit-test path (the test injects a fake). Throws if WebAudio is unavailable;
 *  the controller catches → silent no-op. */
const defaultAudioContextFactory: AudioContextFactory = () => {
  const Ctor =
    (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext ??
    (globalThis as { webkitAudioContext?: new () => AudioContextLike }).webkitAudioContext
  if (typeof Ctor !== 'function') {
    throw new Error('AudioContext unavailable')
  }
  return new Ctor()
}

/** Default asset fetch — pull the bundled cue bytes over the renderer's `fetch`. */
const defaultFetchAsset = async (url: string): Promise<ArrayBuffer> => {
  const res = await fetch(url)
  return res.arrayBuffer()
}

/**
 * Create the attention-sound player (AC-1/8). Lazily creates the AudioContext on the first
 * `play()` and decodes+caches the cue buffer ONCE. Every WebAudio touch is wrapped so `play()`
 * degrades to a silent no-op on any failure (no context / decode failure / suspended context),
 * logging a `code=` only. NO debounce — one `play()` = one sound (AC-2).
 */
export function createAttentionSound(options: AttentionSoundOptions = {}): AttentionSound {
  const audioContextFactory = options.audioContextFactory ?? defaultAudioContextFactory
  const assetUrl = options.assetUrl ?? attentionAssetUrl
  const fetchAsset = options.fetchAsset ?? defaultFetchAsset
  // never-log-the-value: a `code=` ONLY, never a value (Guardrail #6).
  const log = options.log ?? ((message: string): void => console.warn(message))

  let ctx: AudioContextLike | null = null
  let ctxFailed = false // once the context can't be created, stop retrying every play()
  let buffer: AudioBuffer | null = null
  // Guards against firing two concurrent decodes if play() is called rapidly before the first
  // decode resolves (the decode is async; the play itself is synchronous once the buffer is ready).
  let decoding: Promise<void> | null = null

  /** Lazily build the context (once). Returns null on failure (silent no-op). */
  function ensureContext(): AudioContextLike | null {
    if (ctx !== null) return ctx
    if (ctxFailed) return null
    try {
      ctx = audioContextFactory()
      return ctx
    } catch {
      ctxFailed = true
      log('[c9watch][sound] code=audiocontext_unavailable')
      return null
    }
  }

  /** Kick off the one-time decode of the cue into a cached buffer. Idempotent. */
  function ensureBuffer(context: AudioContextLike): void {
    if (buffer !== null || decoding !== null) return
    decoding = (async () => {
      try {
        const bytes = await fetchAsset(assetUrl)
        buffer = await context.decodeAudioData(bytes)
      } catch {
        // Decode/fetch failed — leave buffer null (play() stays a silent no-op) + log a code.
        log('[c9watch][sound] code=decode_failed')
      } finally {
        decoding = null
      }
    })()
  }

  /** Fire one source off the cached buffer. Assumes a non-null buffer + running context. */
  function fireOnce(context: AudioContextLike, buf: AudioBuffer): void {
    const source = context.createBufferSource()
    source.buffer = buf
    source.connect(context.destination)
    source.start()
  }

  function play(): void {
    try {
      const context = ensureContext()
      if (context === null) return // no WebAudio → silent no-op (already logged once)

      // A 'closed' context (auto-closed / audio device lost) would make every fireOnce()
      // throw → log forever without recovering. Drop the dead context so the NEXT play()
      // rebuilds a fresh one (never-crash + self-heal, not infinite retry). This play()
      // produces no sound; the rebuilt context handles subsequent events.
      if (context.state === 'closed') {
        ctx = null
        log('[c9watch][sound] code=audiocontext_closed')
        return
      }

      // Autoplay gesture may not be granted yet → context 'suspended'. Best-effort resume; the
      // promise rejection is swallowed (never-crash). We do NOT block this play on the resume —
      // a suspended context's source.start() is a no-op until resume lands, which is acceptable
      // (one short cue; we never queue/escalate — AC-1). resume() is fire-and-forget.
      if (context.state === 'suspended') {
        context.resume().catch(() => {
          /* swallow — never-crash; the next play() after the gesture will sound */
        })
      }

      if (buffer === null) {
        // First call (or a prior decode failure): kick the (idempotent) decode. This play()
        // produces no sound yet — acceptable (the cue is alert-only; the next attention event
        // after the buffer is ready will sound). We do NOT await here (play() is synchronous +
        // must never throw). NO retry timer (no debounce/cooldown).
        ensureBuffer(context)
        return
      }

      fireOnce(context, buffer)
    } catch {
      // never-crash (AC-8): ANY WebAudio failure degrades to a silent no-op + a code log.
      log('[c9watch][sound] code=play_failed')
    }
  }

  return { play }
}
