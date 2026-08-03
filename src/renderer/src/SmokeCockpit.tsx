// Story 0.1 bare cockpit shell + single-terminal smoke — EXTRACTED from App.tsx in
// Story 1.4 (App now renders the live <Board/>; this is mounted ONLY in smoke mode so
// `npm run smoke` does not regress). Logic is byte-for-byte the Story-0.1 cockpit.
//
// The xterm instance is owned IMPERATIVELY via refs (Guardrail #6) — never via React
// useState — so re-renders cannot thrash the terminal. Terminals are NOT in the store
// (.claude/rules/terminal.md). [Source: story 1.4 Task 6 — preserve the smoke path]
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { PtyExitEvent } from '../../shared/ipc/contract'

export function SmokeCockpit(): React.JSX.Element {
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
    let webglActive = false
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
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
      console.warn('[c9watch][term] WebGL addon failed, using fallback', e)
      activeRenderer = 'canvas'
      webglActive = false
    }
    setRenderer(activeRenderer)
    console.log(`[c9watch][term] active renderer = ${activeRenderer}`)

    termRef.current = term
    fitRef.current = fit

    const doFit = (): void => {
      if (!containerRef.current) return
      const { clientWidth, clientHeight } = containerRef.current
      if (clientWidth === 0 || clientHeight === 0) return
      fit.fit()
      window.pty.resize(term.cols, term.rows)
    }

    const dataDisposable = term.onData((data) => window.pty.input(data))

    const offData = window.pty.onData((data) => term.write(data))
    const offExit = window.pty.onExit(({ exitCode }: PtyExitEvent) => {
      term.write(`\r\n\x1b[33m[process exited with code ${exitCode}]\x1b[0m\r\n`)
    })

    const ro = new ResizeObserver(() => doFit())
    ro.observe(container)

    doFit()
    window.pty.start()
    term.focus()

    // --- Story 0.1 smoke harness (AC-3) -------------------------------------
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
        const cfg = await window.pty.smokeConfig()
        if (!cfg.enabled) return
        await sleep(1200)

        const token = 'C9SMOKE_' + Math.random().toString(36).slice(2, 10)
        window.pty.input(`echo ${token}\n`)
        await sleep(900)
        const afterEcho = bufferText()
        const echoCount = afterEcho.split(token).length - 1
        checks.typeEcho = { token, occurrences: echoCount, pass: echoCount >= 2 }

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

        window.pty.input('top\n')
        await sleep(1500)
        const topPainted = /top -|load average|Tasks:|%Cpu|PID/i.test(bufferText())
        if (containerRef.current) {
          containerRef.current.style.height = '480px'
          containerRef.current.style.width = '820px'
        }
        await sleep(300)
        doFit()
        await sleep(900)
        const topAfterResize = /top -|load average|Tasks:|%Cpu|PID/i.test(bufferText())
        window.pty.input('q')
        await sleep(500)
        checks.tui = {
          program: 'top',
          paintedBeforeResize: topPainted,
          paintedAfterResize: topAfterResize,
          pass: topPainted && topAfterResize
        }

        // GPU OFF (2026-08-03 incident) — this check FLIPPED meaning. It used to assert that
        // WebGL was the active renderer. Main now calls app.disableHardwareAcceleration() +
        // `disable-software-rasterizer` because an amdgpu shader page fault in our own GPU
        // process kept resetting the graphics ring and blanking every live terminal (see the
        // block above app.whenReady() in src/main/index.ts). So the packaged app MUST come up
        // on the CPU renderer: `webglActive` true here means the GPU path came back — fail the
        // gate loudly rather than let it regress silently. `renderer` is reported so the smoke
        // JSON still says WHICH renderer painted. [.claude/rules/terminal.md]
        checks.webgl = { active: webglActive, renderer: activeRenderer, pass: !webglActive }

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
        <span>Claude Watcher</span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>renderer: {renderer}</span>
      </header>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, padding: 4 }} />
    </div>
  )
}
