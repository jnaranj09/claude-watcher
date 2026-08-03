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
- **The GPU is OFF app-wide — canvas/dom is THE renderer, not a fallback.** (Changed
  2026-08-03; this bullet used to say the opposite.) `src/main/index.ts` calls
  `app.disableHardwareAcceleration()` + `app.commandLine.appendSwitch('disable-software-rasterizer')`
  before `ready`, so WebGL2 is genuinely absent, `new WebglAddon()` throws, and the
  existing try/catch lands on canvas/dom. Do NOT "restore" WebGL as an optimization —
  the packaged smoke gate now FAILS if `webglActive` is true (`SmokeCockpit.tsx`).
  Why: an `amdgpu` **shader page fault inside our own GPU process** (`[gfxhub] page
  fault ... Process claude-watcher ... Faulty UTCL2 client ID: SQC (data)`) hung the
  graphics ring, the driver reset it, and every live WebGL context died at once —
  blanking every open terminal while its PTY was healthy. Twice: 2026-07-31 and
  2026-08-03. `coredumpctl` shows no coredump — the app never crashed, only the GPU
  context did. The underlying defect is in the driver stack (mesa 26.1.6 / kernel
  7.1.5-cachyos, AMD integrated GPU on a hybrid laptop), but recovery is not
  prevention: every new terminal armed a fresh context and the fault kept returning.
  Two seconds of a terminal cockpit's paint budget is not worth that.
- **Keep the context-loss recovery anyway.** The `onContextLoss` handler (dispose →
  `doFit()` → `clearTextureAtlas()` → `refresh(0, rows-1)`) and
  `EmbeddedTerminal.webgl.test.tsx` stay. They are unreachable while the GPU is off,
  and they are the safety net the moment anyone turns it back on.
- **Force a full redraw after the fallback swap** — `term.clearTextureAtlas()` +
  `term.refresh(0, term.rows - 1)`. The fallback renderer paints only DIRTY cells, so
  every row already on screen stays black and the terminal looks dead while the PTY is
  healthy and the buffer is intact; only an unrelated resize brings it back. This is
  not theoretical: an `amdgpu` `ring gfx_0.0.0` reset killed the GPU process (2026-07-31)
  and blanked every live terminal exactly this way. Guarded by
  `EmbeddedTerminal.webgl.test.tsx`.

## NOT applicable here (don't copy from generic xterm guides)

- No tmux integration, no WebSocket transport, no multi-window terminal sharing.
  This app is: ONE node-pty per xterm, a SINGLE window, transport over Electron IPC
  (preload bridge). Ignore xterm guidance written for those topologies.
