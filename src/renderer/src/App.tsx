import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
// Story 0.2 — the renderer imports the typed contract too (AC-1: main, preload,
// AND renderer all import from src/shared/ipc/contract). The renderer reaches
// IPC only through the window.pty bridge, so it has no channel call sites; it
// types its callback payload against the contract instead.
import type { PtyExitEvent } from '../../shared/ipc/contract'

// Story 0.1 bare cockpit shell + single-terminal smoke.
// The xterm instance is owned IMPERATIVELY via refs (Guardrail #6) — never via
// React useState — so re-renders cannot thrash the terminal.
function App(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [renderer, setRenderer] = useState<'webgl' | 'canvas' | 'pending'>('pending')

  useEffect(() => {
    const container = containerRef.current
    if (!container || termRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'monospace',
      fontSize: 14,
      theme: { background: '#1e1e2e', foreground: '#cdd6f4' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)

    // Activate WebGL renderer; canvas is fallback only (Guardrail #7 / AC-3).
    let activeRenderer: 'webgl' | 'canvas' = 'canvas'
    // Review F2/F12: track LIVE webgl status. The smoke must not report
    // webgl=true after the GL context is lost; on loss we dispose the addon
    // (xterm drops to its built-in renderer), flip the flag, and surface it.
    let webglActive = false
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        // GL context lost — dispose the addon and stop claiming WebGL is active.
        webgl.dispose()
        webglActive = false
        activeRenderer = 'canvas'
        console.warn('[c9watch][term] WebGL context lost — fell back to canvas/dom renderer')
        setRenderer('canvas')
      })
      term.loadAddon(webgl)
      activeRenderer = 'webgl'
      webglActive = true
    } catch (e) {
      // WebGL unavailable — xterm keeps its default (canvas/dom) renderer.
      console.warn('[c9watch][term] WebGL addon failed, using fallback', e)
      activeRenderer = 'canvas'
      webglActive = false
    }
    setRenderer(activeRenderer)
    // Surface the active renderer for the packaged-smoke record (AC-3).
    console.log(`[c9watch][term] active renderer = ${activeRenderer}`)

    termRef.current = term
    fitRef.current = fit

    // Container must be non-zero before fit() (Guardrail #8 / xterm discipline).
    const doFit = (): void => {
      if (!containerRef.current) return
      const { clientWidth, clientHeight } = containerRef.current
      if (clientWidth === 0 || clientHeight === 0) return
      fit.fit()
      // Resize ordering: renderer computed cols/rows via fit(); now resize PTY.
      window.pty.resize(term.cols, term.rows)
    }

    // keystroke in -> pty
    const dataDisposable = term.onData((data) => window.pty.input(data))

    // pty data out -> term
    const offData = window.pty.onData((data) => term.write(data))
    const offExit = window.pty.onExit(({ exitCode }: PtyExitEvent) => {
      term.write(`\r\n\x1b[33m[process exited with code ${exitCode}]\x1b[0m\r\n`)
    })

    // Resize observer keeps cols/rows tracking the window.
    const ro = new ResizeObserver(() => doFit())
    ro.observe(container)

    // Initial fit then start the PTY.
    doFit()
    window.pty.start()
    term.focus()

    // --- Story 0.1 smoke harness (AC-3) -------------------------------------
    // When C9_SMOKE=1, run a scripted type -> read-back -> resize -> TUI
    // sequence and report a machine-verifiable verdict. No-op otherwise.
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    const bufferText = (): string => {
      const buf = term.buffer.active
      let s = ''
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i)
        if (line) s += line.translateToString(true) + '\n'
      }
      return s
    }

    const runSmoke = async (): Promise<void> => {
      const checks: Record<string, unknown> = {}
      try {
        // Review F3: fetch config INSIDE the try so a rejected invoke (e.g. main
        // handler error) emits a failing verdict instead of leaving the app to
        // hang until the runner's external timeout.
        const cfg = await window.pty.smokeConfig()
        if (!cfg.enabled) return
        await sleep(1200) // let the shell prompt settle

        // 1) TYPE: echo a unique token; verify it round-trips through the PTY.
        const token = 'C9SMOKE_' + Math.random().toString(36).slice(2, 10)
        window.pty.input(`echo ${token}\n`)
        await sleep(900)
        const afterEcho = bufferText()
        // The shell prints the command AND its output; require >=2 occurrences
        // (typed line + echoed result) to prove genuine round-trip echo.
        const echoCount = afterEcho.split(token).length - 1
        checks.typeEcho = { token, occurrences: echoCount, pass: echoCount >= 2 }

        // 2) RESIZE: shrink the terminal container, fit, confirm cols/rows
        // changed and the buffer is intact (no corruption / crash).
        const colsBefore = term.cols
        const rowsBefore = term.rows
        if (containerRef.current) {
          containerRef.current.style.height = '320px'
          containerRef.current.style.width = '600px'
        }
        await sleep(300)
        doFit()
        await sleep(400)
        const colsAfter = term.cols
        const rowsAfter = term.rows
        checks.resize = {
          colsBefore,
          rowsBefore,
          colsAfter,
          rowsAfter,
          changed: colsAfter !== colsBefore || rowsAfter !== rowsBefore,
          tokenSurvived: bufferText().includes(token),
          pass: (colsAfter !== colsBefore || rowsAfter !== rowsBefore) && colsAfter > 0
        }

        // 3) TUI: run `top` (htop not installed on this host), let it paint the
        // alternate screen, resize while it runs, confirm it keeps rendering,
        // then quit cleanly. This exercises the htop-corruption failure mode.
        window.pty.input('top\n')
        await sleep(1500)
        const topPainted = /top -|load average|Tasks:|%Cpu|PID/i.test(bufferText())
        // resize while the TUI owns the screen
        if (containerRef.current) {
          containerRef.current.style.height = '480px'
          containerRef.current.style.width = '820px'
        }
        await sleep(300)
        doFit()
        await sleep(900)
        const topAfterResize = /top -|load average|Tasks:|%Cpu|PID/i.test(bufferText())
        window.pty.input('q') // quit top
        await sleep(500)
        checks.tui = {
          program: 'top',
          paintedBeforeResize: topPainted,
          paintedAfterResize: topAfterResize,
          pass: topPainted && topAfterResize
        }

        // 4) WEBGL active (AC-3 explicit requirement). Read the LIVE flag
        // (Review F2) — a context loss during the run flips this false.
        checks.webgl = { active: webglActive, pass: webglActive }

        const allPass =
          (checks.typeEcho as { pass: boolean }).pass &&
          (checks.resize as { pass: boolean }).pass &&
          (checks.tui as { pass: boolean }).pass &&
          (checks.webgl as { pass: boolean }).pass

        window.pty.smokeReport({
          pass: allPass,
          rendererAbi: { electron: cfg.electron, abi: cfg.abi, node: cfg.node },
          checks
        })
      } catch (err) {
        window.pty.smokeReport({
          pass: false,
          error: String(err),
          checks
        })
      }
    }
    // Review F3: do not bare-`void` — a rejection here must still emit a failing
    // verdict so the gate fails loudly instead of hanging until the runner timeout.
    runSmoke().catch((err) => {
      console.error('[c9watch][smoke] runSmoke crashed', err)
      window.pty.smokeReport({ pass: false, error: String(err), checks: {} })
    })

    return () => {
      ro.disconnect()
      dataDisposable.dispose()
      offData()
      offExit()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        margin: 0,
        background: '#181825',
        color: '#cdd6f4',
        fontFamily: 'sans-serif'
      }}
    >
      <header
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #313244',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span>c9watch cockpit</span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>renderer: {renderer}</span>
      </header>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, padding: 4 }} />
    </div>
  )
}

export default App
