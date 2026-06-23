# Rule: xterm / terminal rendering

## Canonical example (do this)

```tsx
// xterm is owned IMPERATIVELY via refs — NEVER React useState. Re-renders must not
// thrash the terminal.
const containerRef = useRef<HTMLDivElement | null>(null)
const termRef = useRef<Terminal | null>(null)
const fitRef = useRef<FitAddon | null>(null)

useEffect(() => {
  const container = containerRef.current
  if (!container || termRef.current) return       // create exactly once
  const term = new Terminal({ convertEol: false })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(container)
  try { term.loadAddon(new WebglAddon()) } catch { /* canvas/dom fallback */ }
  termRef.current = term; fitRef.current = fit

  const doFit = () => {
    const c = containerRef.current
    if (!c || c.clientWidth === 0 || c.clientHeight === 0) return  // non-zero before fit()
    fit.fit()
    window.pty.resize(term.cols, term.rows)   // renderer computes cols/rows, THEN resize PTY
  }
  // ...
  return () => { term.dispose(); termRef.current = null }
}, [])
```

## The rules

- **xterm lives in refs, NEVER `useState`** — and it is **NOT in the Zustand store**
  (it is imperative external state; SM-C2). A render must never recreate it.
- **Non-zero container BEFORE `fit()`** — `fit()` on a 0×0 element corrupts sizing.
  Guard `clientWidth/clientHeight === 0` and bail.
- **Resize ordering:** the RENDERER computes cols/rows (via `fit()`), then the main
  process resizes the PTY FIRST, then the terminal reflows. Send the new dims to
  main on every fit.
- **Kept-alive terminals:** hide with `visibility: hidden`, NOT `display: none`
  (`display:none` collapses the box to 0×0 and breaks the next `fit()`).
- **Hide the WHOLE frame, not just the inner host.** Kept-alive terminal frames are
  stacked (`position:absolute`, same z-index) in `.terminalWrap`, and each frame paints
  an OPAQUE `bg-terminal` background. If `visibility:hidden` is applied only to the inner
  host, an inactive frame still paints its opaque background — and when it sorts later in
  DOM order it covers the active terminal, blanking the one you're looking at whenever a
  2nd terminal is alive. Apply the hidden toggle to the frame; `visibility:hidden` keeps
  the layout box so the inner host stays sized for `fit()`. (This was the blank-2nd-
  terminal bug — see `.claude/rules/troubleshooting.md` worked example.)
- **`convertEol: false`** — let the PTY own newline semantics.
- **WebGL is the active renderer; canvas/dom is fallback only.** On WebGL context
  loss, dispose the addon, flip to canvas, and surface it (don't keep claiming
  WebGL). xterm falls back automatically once the addon is disposed.

## NOT applicable here (don't copy from generic xterm guides)

- No tmux integration, no WebSocket transport, no multi-window terminal sharing.
  This app is: ONE node-pty per xterm, a SINGLE window, transport over Electron IPC
  (preload bridge). Ignore xterm guidance written for those topologies.
