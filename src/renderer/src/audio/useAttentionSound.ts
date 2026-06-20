// Story 2.4 — wire the attention sound to `attention.raised` (RENDERER side effect).
//
// Subscribes to the SAME `CH.watchEvents` stream the board already consumes (window.watch
// .onEvents) — NO new channel/subscription — and, on a `attention.raised` delta, plays ONE
// sound IFF the live `soundEnabled` setting is on (AC-1/3). The board store still IGNORES
// `attention.raised` for session truth (boardStore.ts) — this sound is a SEPARATE renderer-side
// side effect off the same delta; the frozen `AttentionEvent` union is NOT reshaped (AC-8).
//
// Mute = the SOLE governor (AC-2/3/F2): we read `soundEnabled` LIVE on each event (off the
// settings store) so a mute takes effect IMMEDIATELY with no restart; we fire 1:1 with NO
// debounce here (the Story-1.2 per-session ~700ms attention-emission debounce is the sole
// storm-suppressor). NO self-raise anywhere.
// [Source: story 2.4 Task 5.1; AC-1/2/3/8; F1/F2; src/renderer/src/components/board/Board.tsx
//  (the existing window.watch.onEvents effect this mirrors)]
import { useEffect } from 'react'
import { createAttentionSound, type AttentionSound } from './attentionSound'
import { settingsStore } from '../stores/settingsStore'

/** The app singleton sound player (real WebAudio). Tests pass their own via the hook param. */
const defaultAttentionSound = createAttentionSound()

/** Read the live sound toggle. A getter seam so tests can drive it; defaults to the store. */
type SoundEnabledGetter = () => boolean
const defaultSoundEnabled: SoundEnabledGetter = () => settingsStore.getState().soundEnabled

/**
 * Mount the attention→sound side effect. Subscribes to window.watch.onEvents and plays ONE
 * sound per `attention.raised` when sound is enabled. Returns nothing; cleans up on unmount.
 *
 * The `sound` + `isSoundEnabled` seams are injectable (default = the singleton player + the
 * settings store) so the unit test drives the wiring with a fake player + a controllable flag
 * — no real audio, no real settings round-trip.
 */
export function useAttentionSound(
  sound: AttentionSound = defaultAttentionSound,
  isSoundEnabled: SoundEnabledGetter = defaultSoundEnabled
): void {
  useEffect(() => {
    const off = window.watch.onEvents((payload) => {
      // ONLY react to the attention edge; session.updated/removed never play (AC-1/by-type).
      // Story 3.3 — NO renderer-side launched-vs-external filter here: main GATES the
      // attention.raised SEND at the source (index.ts onDelta), so the renderer only ever
      // receives a LAUNCHED session's raise. An external session's raise never crosses the seam,
      // so the sound auto-narrows with zero edits here. Do NOT add a redundant membership filter
      // (the renderer has no launched-set; main owns it — adding one would be a drift-prone copy).
      if (payload.event.type !== 'attention.raised') return
      // Live mute check (AC-3 — immediate, no restart). NO debounce here (AC-2).
      if (!isSoundEnabled()) return
      sound.play() // 1:1 with the already-debounced attention.raised.
    })
    return off
  }, [sound, isSoundEnabled])
}
