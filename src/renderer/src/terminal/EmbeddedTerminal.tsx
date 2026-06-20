// Story 3.1 (FR-10) — the embedded-terminal React component (xterm owned IMPERATIVELY).
//
// This is where `.claude/rules/terminal.md` becomes load-bearing for the FIRST time. The
// xterm instance lives in REFS — NEVER React `useState`, and NOT in the Zustand store (it is
// imperative external state; SM-C2 / state.md). A board re-render must never recreate it.
//
// Structure COPIED from the proven Story-0.1 `SmokeCockpit.tsx` (refs + FitAddon + WebGL +
// ResizeObserver → doFit → resize-main-first, 0×0 guard, dispose-on-unmount), with the four
// deltas the story mandates:
//   (1) ADD `convertEol:false` (SmokeCockpit omits it — the PTY owns newline semantics;
//       deferred-work.md item) — let the PTY own newlines.
//   (2) THEME from the Story-1.3 `xtermTheme` token object (UX-DR2 one-theme-source) — NOT a
//       hand-authored ANSI palette, NOT SmokeCockpit's hardcoded `{background,foreground}`.
//   (3) `fontSize` from the Story-2.4 persisted `terminalFontSize` (selectTerminalFontSize) —
//       operator-adjustable; a change re-applies to the LIVE terminal (set options.fontSize +
//       re-fit()), never recreates it.
//   (4) bytes ride the transferred MessagePort (window.terminal.open's `port` arg), NOT
//       window.pty: `term.onData → port.postMessage({type:'input'})` (keystrokes) and
//       `port.onmessage → term.write(data, ackCallback)` (output + the renderer-ACK that drives
//       main's flow control). The lifecycle/control (open/resize/stop/exit) rides the typed
//       window.terminal.* bridge.
//
// terminal.md rules obeyed EXACTLY: create-exactly-once (`if (!container || termRef.current)
// return`); non-zero container BEFORE fit() (guard clientWidth/clientHeight===0 and bail);
// resize ordering = renderer fit() computes cols/rows → main resizes the PTY FIRST → terminal
// reflows (send dims to main on every fit; NO local term.resize() ahead of main); WebGL is the
// active renderer, canvas/dom is fallback only (on context loss: dispose addon → flip to canvas
// → surface it); kept-alive hidden uses visibility:hidden (the CSS .hidden class), never
// display:none. [Source: src/renderer/src/SmokeCockpit.tsx; .claude/rules/terminal.md;
//  src/renderer/src/styles/xtermTheme.ts; src/renderer/src/stores/settingsStore.ts]
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type {
  TerminalPortMainMessage,
  TerminalPortRendererMessage,
  TerminalExitEvent
} from '../../../shared/ipc/contract'
import { xtermTheme } from '../styles/xtermTheme'
import { useSettings, selectTerminalFontSize } from '../stores/settingsStore'
import styles from './EmbeddedTerminal.module.css'

export interface EmbeddedTerminalProps {
  /** The opaque per-terminal id (NOT a session id, NOT a pid — F6). Stable for this pane. */
  terminalId: string
  /** When false, the terminal is kept ALIVE but hidden (visibility:hidden, never display:none —
   *  terminal.md). Defaults to true (visible). */
  active?: boolean
}

/** The local dead-terminal state — the ONLY React state here (per-terminal pane state, AC-4).
 *  The xterm instance itself is NEVER in React state (terminal.md). */
type DeadState = { exitCode: number } | null

export function EmbeddedTerminal({
  terminalId,
  active = true
}: EmbeddedTerminalProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const portRef = useRef<MessagePort | null>(null)
  // The dead-terminal pane is per-terminal LOCAL state (AC-4). A nonce bumps to force a fresh
  // open() on Reopen (re-running the mount effect into the SAME pane). The xterm instance and
  // its bytes are NEVER in React state — only this small pane/lifecycle flag is.
  const [dead, setDead] = useState<DeadState>(null)
  const [openNonce, setOpenNonce] = useState(0)

  // The operator-controlled font size (Story 2.4). Subscribed via a NARROW selector (state.md)
  // so an unrelated settings change doesn't re-run anything heavy. A change re-applies to the
  // LIVE terminal in the second effect below (NOT a recreate). The create effect reads the
  // INITIAL value via a ref (kept current) so fontSize is NOT a recreate dependency — a
  // font-size change must never tear down + recreate the terminal (terminal.md / F3).
  const fontSize = useSettings(selectTerminalFontSize)
  // useRef(fontSize) captures the INITIAL value at mount (what the create effect reads); the
  // live font-size effect below keeps it current on every change. Never written during render.
  const fontSizeRef = useRef(fontSize)

  // --- Create the terminal EXACTLY ONCE per (terminalId, openNonce) + wire the port. --------
  // openNonce in the deps re-runs this on Reopen (the cleanup disposes the old terminal first).
  useEffect(() => {
    const container = containerRef.current
    // create-exactly-once: bail if no container or a terminal already exists in the ref.
    if (!container || termRef.current) return

    setDead(null)

    const term = new Terminal({
      cursorBlink: true,
      // convertEol:false — the PTY owns newline semantics (terminal.md; the delta SmokeCockpit omits).
      convertEol: false,
      fontFamily: "'JetBrains Mono', ui-monospace, 'Hack', 'Noto Sans Mono', monospace",
      // Read the INITIAL font size via the ref so fontSize is not a recreate dependency (a live
      // change re-applies in the second effect, never recreates — F3).
      fontSize: fontSizeRef.current,
      // ONE theme source of truth (UX-DR2): the Story-1.3 token-derived ITheme. NO hand-authored ANSI.
      theme: xtermTheme
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)

    // WebGL is the ACTIVE renderer; canvas/dom is fallback only (terminal.md). On context loss:
    // dispose the addon → xterm falls back to canvas automatically → surface it (don't keep
    // claiming WebGL). A construction failure also falls back.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
        console.warn('[c9watch][term] WebGL context lost — fell back to canvas/dom renderer')
      })
      term.loadAddon(webgl)
    } catch (e) {
      console.warn('[c9watch][term] WebGL addon failed, using canvas/dom fallback', e)
    }

    termRef.current = term
    fitRef.current = fit

    // Resize ordering (terminal.md): the renderer computes cols/rows via fit(), then MAIN
    // resizes the PTY FIRST, then the terminal reflows. NO local term.resize() ahead of main —
    // we send the dims to main on every fit and let the PTY drive the reflow. Guard a 0×0
    // container BEFORE fit() (fit() on a 0×0 element corrupts sizing).
    const doFit = (): void => {
      const c = containerRef.current
      if (!c || c.clientWidth === 0 || c.clientHeight === 0) return
      fit.fit()
      // fire-and-forget: a resize reject is non-fatal (the next fit corrects it); void it so
      // no-floating-promises is satisfied. NEVER the value — just a code on failure.
      void window.terminal
        .resize(terminalId, term.cols, term.rows)
        .catch(() => console.warn('[c9watch][term] code=resize_failed'))
    }

    // Keystrokes → the PTY over the port (NOT window.pty). One message per onData chunk.
    const dataDisposable = term.onData((data) => {
      const port = portRef.current
      if (!port) return
      const msg: TerminalPortRendererMessage = { type: 'input', data }
      port.postMessage(msg)
    })

    // Open the terminal: main spawns the pty + transfers the MessagePort the bytes ride. The
    // callback fires ONCE with the port; we wire output → term.write(data, ackCallback) so the
    // renderer ACKs each rendered chunk (the flow-control drain signal main pauses/resumes on).
    const unsubscribeOpen = window.terminal.open(terminalId, (port) => {
      portRef.current = port
      port.onmessage = (event: MessageEvent<TerminalPortMainMessage>): void => {
        const m = event.data
        if (m.type === 'output') {
          // xterm.write(data, callback): the callback fires when the chunk is rendered → ACK
          // main so it can drain the backlog (renderer-ACK flow control, AR-4).
          term.write(m.data, () => {
            const ack: TerminalPortRendererMessage = { type: 'ack' }
            port.postMessage(ack)
          })
        } else {
          // type === 'exit' — the pty exited; the durable dead-terminal push also arrives over
          // CH.terminalExit (onExit below). Either path flips the pane.
          setDead({ exitCode: m.exitCode })
        }
      }
      port.start()
      // First fit AFTER the port is wired so the initial resize reaches a live pty.
      doFit()
      term.focus()
    })

    // The durable dead-terminal signal (CH.terminalExit) — drives the pane even if the port is
    // already gone. PER-TERMINAL local state; the board + siblings are untouched (AC-4).
    const offExit = window.terminal.onExit((info: TerminalExitEvent) => {
      if (info.terminalId === terminalId) setDead({ exitCode: info.exitCode })
    })

    const ro = new ResizeObserver(() => doFit())
    ro.observe(container)

    return () => {
      ro.disconnect()
      dataDisposable.dispose()
      unsubscribeOpen()
      offExit()
      // Stop the pty cleanly (port.close() THEN pty.kill() in main) — no orphan from a normal
      // close. fire-and-forget: a stop reject is non-fatal on teardown.
      void window.terminal
        .stop(terminalId)
        .catch(() => console.warn('[c9watch][term] code=stop_failed'))
      const port = portRef.current
      if (port) {
        port.onmessage = null
        try {
          port.close()
        } catch {
          /* port may already be closed */
        }
        portRef.current = null
      }
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // terminalId + openNonce are the ONLY recreate keys (a Reopen bumps openNonce). fontSize is
    // applied live in the second effect, never here — so it is intentionally not a dependency.
  }, [terminalId, openNonce])

  // --- Apply a LIVE font-size change WITHOUT recreating the terminal (F3/F5). ---------------
  // A settings change sets term.options.fontSize then re-fits (which re-sends dims to main).
  useEffect(() => {
    // Keep the ref current so a later create (Reopen) starts at the live size.
    fontSizeRef.current = fontSize
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    term.options.fontSize = fontSize
    const c = containerRef.current
    if (!c || c.clientWidth === 0 || c.clientHeight === 0) return
    fit.fit()
    void window.terminal
      .resize(terminalId, term.cols, term.rows)
      .catch(() => console.warn('[c9watch][term] code=resize_failed'))
  }, [fontSize, terminalId])

  // Reopen: bump the nonce → the mount effect re-runs into the SAME pane (fresh pty + port).
  const reopen = (): void => {
    setDead(null)
    setOpenNonce((n) => n + 1)
  }
  // Stop: dispose the pane (the parent host decides what to render after). We stop the pty here
  // too so a Stop from the dead pane reaps any lingering main-side state.
  const stop = (): void => {
    void window.terminal
      .stop(terminalId)
      .catch(() => console.warn('[c9watch][term] code=stop_failed'))
    setDead({ exitCode: dead?.exitCode ?? 0 })
  }

  return (
    <div className={styles.frame} data-testid="embedded-terminal" data-terminal-id={terminalId}>
      {/* Kept-alive hidden uses visibility:hidden (the .hidden class), NEVER display:none. */}
      <div ref={containerRef} className={`${styles.host} ${active ? '' : styles.hidden}`} />
      {dead !== null && (
        <div className={styles.dead} role="alert" data-testid="dead-terminal">
          <span className={styles.deadMessage}>Terminal exited.</span>
          <div className={styles.deadActions}>
            <button type="button" className={styles.deadButton} onClick={reopen}>
              Reopen
            </button>
            <button type="button" className={styles.deadButton} onClick={stop}>
              Stop
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
