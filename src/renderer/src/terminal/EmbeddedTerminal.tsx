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
import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { TERMINAL_PORT_TAG } from '../../../shared/ipc/contract'
import type {
  TerminalPortMainMessage,
  TerminalPortRendererMessage,
  TerminalExitEvent
} from '../../../shared/ipc/contract'
import { xtermTheme } from '../styles/xtermTheme'
import { useSettings, selectTerminalFontSize } from '../stores/settingsStore'
import { TerminalContextMenu } from './TerminalContextMenu'
import styles from './EmbeddedTerminal.module.css'

export interface EmbeddedTerminalProps {
  /** The opaque per-terminal id (NOT a session id, NOT a pid — F6). Stable for this pane. */
  terminalId: string
  /** When false, the terminal is kept ALIVE but hidden (visibility:hidden, never display:none —
   *  terminal.md). Defaults to true (visible). */
  active?: boolean
  /** Story 6.1 — launch a NEW session from the dead pane. The focused-session surface threads
   *  App's `handleNewSession` here (native dir picker → launch → focused view — the same flow as
   *  the header button / Ctrl+N). When ABSENT (the plain-shell terminals view), the dead pane's
   *  button falls back to re-opening a fresh pty into the SAME pane (the openNonce bump). */
  onNewSession?: () => void
}

/** The local dead-terminal state — the ONLY React state here before the clipboard feature
 *  (per-terminal pane state, AC-4). The xterm instance itself is NEVER in React state (terminal.md). */
type DeadState = { exitCode: number } | null

/**
 * Context menu open state — the position + entry-enable flags for the Copy/Paste menu.
 * `null` means the menu is closed. This is the ONLY new React state added by the clipboard
 * feature (view-state — state.md). xterm + selection are NEVER here (stay in refs).
 */
type MenuState = {
  /** Cursor viewport x (from contextmenu event.clientX). */
  x: number
  /** Cursor viewport y (from contextmenu event.clientY). */
  y: number
  /** True when `term.hasSelection()` at the time of right-click. */
  canCopy: boolean
  /** True when `clipboard.readText()` returned a non-empty string (updated async). */
  canPaste: boolean
}

// Story 5.4 — a process-monotonic counter minting a fresh per-OPEN token for each create-effect
// run. The token disambiguates a re-open of the SAME terminalId (a StrictMode dev double-mount, or
// a dead-pane re-open): main echoes it on the port transfer so the renderer pairs THIS port to THIS open and
// never the stale (already-closed) port from the prior open — the second-order cause of the dev
// blank-terminal bug. A plain counter is enough: the token only needs to be unique among opens
// within THIS renderer; it is never persisted or shared. NOT crypto.randomUUID() — that is
// secure-context-only and is `undefined` under file:// in the packaged app (a dev-vs-prod trap);
// NOT Date.now()/Math.random().
let openTokenSeq = 0

export function EmbeddedTerminal({
  terminalId,
  active = true,
  onNewSession
}: EmbeddedTerminalProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const portRef = useRef<MessagePort | null>(null)
  // The dead-terminal pane is per-terminal LOCAL state (AC-4). A nonce bumps to force a fresh
  // open() on the dead-pane fallback re-open (re-running the mount effect into the SAME pane).
  // The xterm instance and its bytes are NEVER in React state — only this small pane flag is.
  const [dead, setDead] = useState<DeadState>(null)
  const [openNonce, setOpenNonce] = useState(0)
  // Terminal clipboard feature — context menu open/position (view-state; state.md).
  // The xterm instance + selection are NOT here: they stay in termRef/portRef (terminal.md).
  const [menu, setMenu] = useState<MenuState | null>(null)

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
  // openNonce in the deps re-runs this on a re-open (the cleanup disposes the old terminal first).
  useEffect(() => {
    const container = containerRef.current
    // create-exactly-once: bail if no container or a terminal already exists in the ref.
    if (!container || termRef.current) return

    setDead(null)

    // Story 5.4 — mint THIS open's token (fresh per effect run). Captured by the port listener +
    // the open() call below so a re-open of the same terminalId pairs only ITS port, never a stale.
    const openToken = `open-${++openTokenSeq}`

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

    // WebGL is the ACTIVE renderer; canvas/dom is fallback only (terminal.md). On context loss:
    // dispose the addon → xterm falls back to canvas automatically → surface it (don't keep
    // claiming WebGL). A construction failure also falls back. Loaded AFTER doFit is defined so
    // the loss handler can re-fit (see below) — loadAddon order is irrelevant to the addon itself.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
        // RE-FIT before repainting. The fallback renderer measures its OWN cell size, so the
        // cols/rows computed under WebGL no longer match the box — cols × cellWidth ends up
        // WIDER than the frame. xterm parks its focused helper textarea on the cursor cell (in
        // px), so as you keep typing that focused element walks past the right edge and the
        // browser scrolls the frame to reveal it: the view slides right and never comes back
        // (the frame clips, it has no user scrollbar). Only an unrelated window resize fixed it.
        // doFit() recomputes cols/rows for the LIVE renderer and resizes the PTY first.
        // The frame is also `overflow: clip` now, so it can never be scrolled at all — belt and
        // suspenders, since a wrong cell measurement must not be able to hide the left columns.
        doFit()
        // FORCE a full redraw after the swap. The fallback renderer only paints DIRTY cells,
        // so everything already on screen stays black until something else damages it — the
        // terminal looks dead while the PTY is healthy and the buffer is intact (observed
        // after an amdgpu ring reset killed the GPU process; a window resize was the only
        // way back). clearTextureAtlas() drops the glyph cache the dead context owned;
        // refresh(0, rows-1) repaints every row. [.claude/rules/terminal.md]
        term.clearTextureAtlas()
        term.refresh(0, term.rows - 1)
        console.warn('[c9watch][term] WebGL context lost — fell back to canvas/dom renderer')
      })
      term.loadAddon(webgl)
    } catch (e) {
      console.warn('[c9watch][term] WebGL addon failed, using canvas/dom fallback', e)
    }

    // Keystrokes → the PTY over the port (NOT window.pty). One message per onData chunk.
    const dataDisposable = term.onData((data) => {
      const port = portRef.current
      if (!port) return
      const msg: TerminalPortRendererMessage = { type: 'input', data }
      port.postMessage(msg)
    })

    // Story 5.1 fix — receive the real MessagePort via the main-world-port pattern.
    // `contextBridge` CANNOT marshal a live port as a callback arg (stripped of methods).
    // The preload forwards it via `window.postMessage(TERMINAL_PORT_TAG, '*', [port])`;
    // we pair it here via a `window` `'message'` listener keyed on the tag + terminalId + openToken.
    // The listener is one-shot: once it pairs its port it removes itself (a terminal receives
    // exactly one port per open; a re-open bumps openNonce and re-runs this effect with a
    // fresh listener + a fresh openToken). Match on terminalId so kept-alive terminals can't
    // cross-wire, AND on openToken (Story 5.4) so a re-open of the SAME terminalId (a StrictMode
    // dev double-mount, or a dead-pane re-open) pairs only THIS open's port — never the stale, already-closed
    // port from the prior open (which would leave the terminal blank).
    const portHandler = (
      e: MessageEvent<{ tag: string; terminalId: string; openToken: string }>
    ): void => {
      if (
        e.data?.tag !== TERMINAL_PORT_TAG ||
        e.data?.terminalId !== terminalId ||
        e.data?.openToken !== openToken
      )
        return
      const port = e.ports[0]
      if (!port) return
      // One-shot: remove the listener immediately after pairing (no re-fire risk).
      window.removeEventListener('message', portHandler)
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
    }
    window.addEventListener('message', portHandler)
    // Open the terminal: triggers main to spawn the pty + transfer the MessagePort.
    // The port arrives asynchronously via the window 'message' listener above (tagged with THIS
    // openToken so a re-open of the same terminalId can't deliver us a stale port).
    const unsubscribeOpen = window.terminal.open(terminalId, openToken)

    // The durable dead-terminal signal (CH.terminalExit) — drives the pane even if the port is
    // already gone. PER-TERMINAL local state; the board + siblings are untouched (AC-4).
    const offExit = window.terminal.onExit((info: TerminalExitEvent) => {
      if (info.terminalId === terminalId) setDead({ exitCode: info.exitCode })
    })

    const ro = new ResizeObserver(() => doFit())
    ro.observe(container)

    // ── Terminal clipboard feature ────────────────────────────────────────────────
    //
    // (1) Ctrl+V takeover — forward `\x16` to the PTY, suppress xterm's text-paste.
    //
    // Problem: xterm intercepts Ctrl+V via a DOM `paste` event on its internal textarea
    // and sends the clipboard TEXT to the PTY — so `claude`'s own `Ctrl+V` image-paste
    // never fires (the `0x16` byte never reaches claude's stdin).
    //
    // Fix: attachCustomKeyEventHandler captures Ctrl+V keydown and manually posts `\x16`
    // over the existing port input frame, then returns `false` (xterm does nothing further).
    // A capture-phase `paste` listener on the container also calls stopImmediatePropagation()
    // so xterm's paste handler (on the descendant textarea) never fires — ensuring exactly
    // ONE `\x16` per keypress, never a text paste (Konsole parity). [spec §Ctrl+V takeover]
    term.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
      if (
        event.type === 'keydown' &&
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key.toLowerCase() === 'v'
      ) {
        // Forward the raw control byte to the PTY over the EXISTING port input frame.
        // No new byte-transport path — the same {type:'input'} message the onData handler uses.
        const port = portRef.current
        if (port) {
          const msg: TerminalPortRendererMessage = { type: 'input', data: '\x16' }
          port.postMessage(msg)
        }
        return false // suppress xterm: no key-sequence write, no built-in paste
      }
      return true // all other keys pass through to xterm unchanged
    })

    // Capture-phase paste suppressor — catches the browser `paste` event BEFORE xterm's
    // textarea listener fires. Prevents clipboard text from being sent to the PTY via the
    // paste path. Combined with the custom key handler above, Ctrl+V sends exactly one
    // `\x16` and NEVER a text paste. Disposed in cleanup below.
    const pasteHandler = (e: Event): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    container.addEventListener('paste', pasteHandler, true) // capture phase

    // (2) Right-click context menu — Copy / Paste entries.
    //
    // Opens a renderer-drawn menu at the cursor position; the menu component handles dismiss.
    // `canCopy` is set at right-click time from `term.hasSelection()`. `canPaste` is initially
    // false and updated async after `clipboard.readText()` resolves (menu shows immediately,
    // Paste entry lights up a moment later if the clipboard has text).
    // [spec §Context menu; .claude/rules/ipc.md; .claude/rules/zod-boundaries.md]
    const contextMenuHandler = (e: MouseEvent): void => {
      e.preventDefault()
      const t = termRef.current
      const canCopy = t ? t.hasSelection() : false
      setMenu({ x: e.clientX, y: e.clientY, canCopy, canPaste: false })
      // Read the clipboard text async to decide if Paste should be enabled.
      // void-wrapped (no-floating-promises). NEVER log the text value (user content).
      void window.clipboard
        .readText()
        .then((text) => {
          setMenu((prev) => (prev !== null ? { ...prev, canPaste: text.length > 0 } : prev))
        })
        .catch(() => {
          // Paste stays disabled; no log needed (clipboard read failure is non-fatal).
        })
    }
    container.addEventListener('contextmenu', contextMenuHandler)

    return () => {
      // Clipboard feature cleanup — remove listeners BEFORE disposing the terminal.
      container.removeEventListener('contextmenu', contextMenuHandler)
      container.removeEventListener('paste', pasteHandler, true)
      // Dismiss any open context menu when this effect re-runs (a re-open) or unmounts.
      setMenu(null)

      ro.disconnect()
      dataDisposable.dispose()
      // Clean up the message listener if the port was never delivered (e.g. manager not ready
      // → dead-pane push via CH.terminalExit; the portHandler never fired). If it already fired
      // it removed itself (one-shot), so this is a safe no-op in the happy path.
      window.removeEventListener('message', portHandler)
      unsubscribeOpen()
      offExit()
      // Stop the pty cleanly (port.close() THEN pty.kill() in main) — no orphan from a normal
      // close. fire-and-forget: a stop reject is non-fatal on teardown.
      // Story 5.6 — pass THIS effect's openToken so main can identify a stale StrictMode
      // cleanup-stop (where open(tok2) has already updated the stored token to tok2, making
      // this stop(tok1) stale → no-op). The PTY stays alive, wired to mount2's port.
      void window.terminal
        .stop(terminalId, openToken)
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
    // terminalId + openNonce are the ONLY recreate keys (the dead-pane fallback re-open bumps
    // openNonce). fontSize is applied live in the second effect, never here — so it is
    // intentionally not a dependency.
  }, [terminalId, openNonce])

  // --- Apply a LIVE font-size change WITHOUT recreating the terminal (F3/F5). ---------------
  // A settings change sets term.options.fontSize then re-fits (which re-sends dims to main).
  useEffect(() => {
    // Keep the ref current so a later create (a re-open) starts at the live size.
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

  // Re-open fallback: bump the nonce → the mount effect re-runs into the SAME pane (fresh pty +
  // port). Only reachable from the dead pane's button when NO onNewSession prop was provided.
  const reopen = (): void => {
    setDead(null)
    setOpenNonce((n) => n + 1)
  }
  // Story 6.1 — the ONE dead-pane action. On the focused-session surface the prop is App's
  // handleNewSession (picker → launch → focused view); this pane stays dead + kept-alive-hidden
  // while the NEW terminal takes focus. Without the prop (plain-shell terminals view), fall back
  // to re-opening a fresh pty into this same pane so the surface keeps a working action.
  const handleDeadNewSession = (): void => {
    if (onNewSession !== undefined) onNewSession()
    else reopen()
  }

  // ── Terminal clipboard feature — context menu action handlers ─────────────
  //
  // These use `termRef.current` (a ref, not state) so they stay stable across renders
  // and can safely be called asynchronously without stale-closure concerns. All Promise
  // calls are void-wrapped (no-floating-promises). NEVER log the clipboard text value
  // (user content; Guardrail #6; .claude/rules/zod-boundaries.md).

  /** Copy: write `term.getSelection()` to the OS clipboard (guard empty selection). */
  const handleCopy = (): void => {
    const t = termRef.current
    const sel = t?.getSelection() ?? ''
    setMenu(null)
    if (!sel) return
    void window.clipboard
      .writeText(sel)
      .catch(() => console.warn('[c9watch][clipboard] code=clipboard_write_failed'))
  }

  /** Paste: read OS clipboard text → `term.paste(text)` if non-empty (bracketed paste). */
  const handlePaste = (): void => {
    const t = termRef.current
    setMenu(null)
    if (!t) return
    void window.clipboard
      .readText()
      .then((text) => {
        if (text) t.paste(text)
      })
      .catch(() => console.warn('[c9watch][clipboard] code=clipboard_paste_failed'))
  }

  /**
   * Dismiss the context menu (called by TerminalContextMenu on outside-click/Esc/scroll/blur).
   * Wrapped in useCallback so its identity is stable across renders — TerminalContextMenu puts
   * it in the dismiss-listener effect's dep array to avoid listener churn per render.
   */
  const handleMenuDismiss = useCallback((): void => {
    setMenu(null)
  }, []) // setMenu is guaranteed stable by React

  return (
    <div
      className={`${styles.frame} ${active ? '' : styles.hidden}`}
      data-testid="embedded-terminal"
      data-terminal-id={terminalId}
    >
      {/* Kept-alive hidden uses visibility:hidden on the WHOLE frame (the .hidden class), NEVER
          display:none. It MUST be the frame, not just the inner host: the frame paints an OPAQUE
          bg-terminal background, and all kept-alive frames are stacked (position:absolute, same
          z-index) in .terminalWrap — so hiding only the host left an inactive frame's opaque
          background painting OVER the active terminal whenever it sorted later in DOM order,
          blanking the visible terminal while a 2nd terminal was alive. visibility:hidden keeps the
          layout box, so the inner host stays sized for fit(). */}
      <div ref={containerRef} className={styles.host} />
      {/* Story 6.1 — the dead pane shows exactly ONE action: New session. */}
      {dead !== null && (
        <div className={styles.dead} role="alert" data-testid="dead-terminal">
          <span className={styles.deadMessage}>Terminal exited.</span>
          <div className={styles.deadActions}>
            <button
              type="button"
              className={styles.deadButton}
              data-testid="dead-new-session"
              onClick={handleDeadNewSession}
            >
              New session
            </button>
          </div>
        </div>
      )}
      {/* Terminal clipboard feature — context menu portal (renders into document.body via
          createPortal; position:fixed; z-index 1000 above all kept-alive frames).
          Mounted only when the user right-clicks this terminal (menu !== null).
          Siblings' menus are untouched: each EmbeddedTerminal owns its own `menu` state. */}
      {menu !== null && (
        <TerminalContextMenu
          x={menu.x}
          y={menu.y}
          canCopy={menu.canCopy}
          canPaste={menu.canPaste}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onDismiss={handleMenuDismiss}
        />
      )}
    </div>
  )
}
