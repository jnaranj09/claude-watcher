// Story 1.4 — App now renders the live three-column <Board/> (the v1 board view).
//
// The Story-0.1 single-PTY xterm smoke shell is preserved as <SmokeCockpit/> and
// mounted ONLY in smoke mode, so `npm run smoke` (the packaged node-pty exit gate)
// does NOT regress. Smoke mode is owned by main (`process.env.C9_SMOKE`) and surfaced
// to the renderer via the typed `window.pty.smokeConfig()` invoke. We resolve it ONCE
// on mount and pick the view; while it resolves we render the Board (which shows its
// own cold-load skeleton until the first c9watch delta — UX-DR16), so there is no
// spinner-on-empty and the smoke decision never flashes the wrong shell first (the
// PTY is requested only inside SmokeCockpit, never by the Board).
//
// The board is the v1 board view; the xterm cockpit is Epic-3's focused-session
// concern. [Source: story 1.4 Task 6]
import { useEffect, useState } from 'react'
import { Board } from './components/board/Board'
import { SmokeCockpit } from './SmokeCockpit'

function App(): React.JSX.Element {
  // null = smoke-config not resolved yet; true/false once known.
  const [smoke, setSmoke] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    window.pty
      .smokeConfig()
      .then((cfg) => {
        if (!cancelled) setSmoke(cfg.enabled)
      })
      .catch((err) => {
        // smokeConfig should never reject; if it does, fall through to the board
        // (smoke=false) rather than hang. Never the value — just the error message.
        console.error('[c9watch] smokeConfig failed; defaulting to board', err)
        if (!cancelled) setSmoke(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // In smoke mode, render the single-PTY cockpit (the packaged smoke harness drives
  // it). Otherwise — including while smoke-config is still resolving — render the
  // board; its cold-load skeleton covers the brief pre-resolution window.
  if (smoke === true) return <SmokeCockpit />
  return <Board />
}

export default App
