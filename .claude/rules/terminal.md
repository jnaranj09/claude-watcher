# Rule: xterm / terminal rendering

## Canonical example

```tsx
// xterm owned IMPERATIVELY via refs — never useState, never the store.
const containerRef = useRef<HTMLDivElement | null>(null)
const termRef = useRef<Terminal | null>(null)

useEffect(() => {
  const container = containerRef.current
  if (!container || termRef.current) return // create exactly once
  const term = new Terminal({ convertEol: false })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(container)
  try {
    term.loadAddon(new WebglAddon())
  } catch {
    /* canvas/dom fallback */
  }
  termRef.current = term
  const doFit = () => {
    const c = containerRef.current
    if (!c || c.clientWidth === 0 || c.clientHeight === 0) return // non-zero before fit()
    fit.fit()
    window.pty.resize(term.cols, term.rows) // renderer computes, main resizes PTY, then reflow
  }
  return () => {
    term.dispose()
    termRef.current = null
  }
}, [])
```

## Rules

- **Refs only**, never `useState` or Zustand (SM-C2).
- **Non-zero container before `fit()`** (0×0 corrupts sizing). Send new dims to main on every fit.
- **Kept-alive terminals: `visibility: hidden` on the WHOLE frame**, never `display:none` (breaks
  `fit()`) and never just the inner host (each frame paints opaque `bg-terminal`; a later hidden
  frame covers the active one — the blank-2nd-terminal bug).
- **Hidden terminals also move off-screen** (`translate: -200vw 0` on `.hidden` and
  `App.module.css` `.viewLayer[data-active='false']`). WebGL never clears a canvas that is never
  shown, so output stacks; off-screen lets xterm's IntersectionObserver pause and full-refresh.
  Guarded by `terminalRules.test.ts`.
- `convertEol: false` — the PTY owns newlines.
- **Every key reaches the terminal.** No app menu; a new `before-input-event` `preventDefault`
  steals the key from claude (only one allowed: dev F12).
- **App takes no key typed into the terminal** (R1): App keydown returns on
  `isInsideTerminal(e.target)` (`lib/terminalFocus.ts`) — don't rely on xterm's
  `stopPropagation`. Test keys on xterm's helper textarea AND `.xterm` root
  (`App.terminalKeys.test.tsx`). R10: the visible terminal takes focus on every switch
  (`takeFocus`); a hidden one never does.
- **Links open in the OS browser** (`terminalLinks.ts`): one activator for `linkHandler` (OSC 8)
  and `@xterm/addon-web-links`; Ctrl/Cmd+click → `window.links.openExternal` →
  `CH.linkOpenExternal` → `externalLinks` gate (http/https) → `shell.openExternal`. Without
  `linkHandler` xterm uses `confirm()` + `window.open()`. **`createLinkClickGuard`** takes the
  gesture mousedown/mouseup in the CAPTURE phase so claude's mouse reporting doesn't open it twice.
  Main denies all `window.open` and navigation (`installLinkGuards`). Never log a URL.
- **WebGL is ON** (canvas/dom fallback). The smoke gate requires `webglActive`. It was off
  2026-08-03→09-22 after `amdgpu` shader faults in our GPU process blanked every terminal; host now
  renders on the NVIDIA dGPU. **If terminals blank again: `journalctl -k | grep -E "amdgpu|NVRM"`**
  — a fault naming `claude-watcher` ⇒ re-add `app.disableHardwareAcceleration()` +
  `disable-software-rasterizer`.
- **Keep context-loss recovery:** `onContextLoss` → dispose → `doFit()` → `clearTextureAtlas()` →
  `refresh(0, rows-1)` (fallback paints only dirty cells, so without it the terminal looks dead).
  Guarded by `EmbeddedTerminal.webgl.test.tsx`.

Not applicable: tmux, WebSocket transport, multi-window sharing. This app = one node-pty per xterm,
one window, Electron IPC.
