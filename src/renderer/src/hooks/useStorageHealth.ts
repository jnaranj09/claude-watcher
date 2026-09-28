// Storage health (UX-06, UX-07) — the store files main could not read or write this run. Asked once
// on mount (the load problems happen before the window exists), then followed through the push.
// Null until the first answer arrives.
//
// The bridge is absent in unit tests that do not stub it, so a missing `window.storageHealth` is
// "no answer", never a crash (the useServerHealth guard).

import { useEffect, useState } from 'react'
import type { StorageHealth } from '../../../shared/ipc/contract'

export function useStorageHealth(): StorageHealth | null {
  const [health, setHealth] = useState<StorageHealth | null>(null)
  useEffect(() => {
    if (typeof window.storageHealth !== 'object') return
    let alive = true
    // Subscribe FIRST, so a problem between the ask and its answer is not lost; a push always
    // wins over the (older) answer to the ask.
    let pushed = false
    const off = window.storageHealth.onChanged((next) => {
      pushed = true
      setHealth(next)
    })
    window.storageHealth
      .get()
      .then((first) => {
        if (alive && !pushed) setHealth(first)
      })
      .catch(() => console.warn('[claude-watcher][health] code=storage_get_failed'))
    return () => {
      alive = false
      off()
    }
  }, [])
  return health
}
