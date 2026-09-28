// Server health (UX-05, R11) — main's view of the hook ingest and the API listener. Asked once on
// mount, then followed through the push. Null until the first answer arrives: a caller draws
// nothing for "don't know yet".
//
// The bridge is absent in unit tests that do not stub it (same guard as the theme bridge in
// App.tsx), so a missing `window.serverHealth` is "no answer", never a crash.

import { useEffect, useState } from 'react'
import type { ServerHealth } from '../../../shared/ipc/contract'

export function useServerHealth(): ServerHealth | null {
  const [health, setHealth] = useState<ServerHealth | null>(null)
  useEffect(() => {
    if (typeof window.serverHealth !== 'object') return
    let alive = true
    // Subscribe FIRST, so a change between the ask and its answer is not lost; a push always
    // wins over the (older) answer to the ask.
    let pushed = false
    const off = window.serverHealth.onChanged((next) => {
      pushed = true
      setHealth(next)
    })
    window.serverHealth
      .get()
      .then((first) => {
        if (alive && !pushed) setHealth(first)
      })
      .catch(() => console.warn('[claude-watcher][health] code=get_failed'))
    return () => {
      alive = false
      off()
    }
  }, [])
  return health
}
