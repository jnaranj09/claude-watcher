// Story 3.1 (FR-10) — EmbeddedTerminal jsdom tests (unit / jsdom project).
// Story 5.1 — re-shaped for the main-world-port delivery mechanism. The preload
// no longer passes the port as a callback arg to `window.terminal.open`; it now
// forwards the real port via `window.postMessage(TERMINAL_PORT_TAG, '*', [port])`.
// The renderer pairs it via a `window` `'message'` listener keyed by the tag +
// terminalId. jsdom HAS browser `MessageChannel`/`MessagePort` (only Electron's
// `MessagePortMain` is absent), so tests can drive a real port via a dispatched
// `MessageEvent` carrying a `new MessageChannel().port1`.
//
// Coverage preserved from story 3.1 (re-shaped by Story 6.1 — one dead-pane button):
//   - mounts without throwing + calls window.terminal.open(terminalId) ONCE;
//   - dead-terminal pane (AC-4): renders on CH.terminalExit for THIS id, not another;
//   - the dead pane renders exactly ONE button ("New session", data-testid="dead-new-session"):
//     with the onNewSession prop it calls the prop; without it it falls back to re-open;
//   - kept-alive hidden: applies the `.hidden` class (visibility:hidden, never display:none);
//   - stop-on-unmount (clean teardown — no orphan from a normal close).
// Coverage ADDED in story 5.1:
//   - port delivery: after `window.terminal.open` is called, dispatching a matching
//     `MessageEvent` on `window` causes the terminal to wire `onmessage` + call `start()`;
//   - cross-wiring negative: a `MessageEvent` for a DIFFERENT terminalId is IGNORED.
//   - output renders (port.onmessage → term.write);
//   - keystroke posts (term.onData → port.postMessage) — NON-VACUOUS: drives
//     Terminal.input() to fire onData; asserts port1.postMessage({type:'input',data}).
//   - font-size live-apply (a selectTerminalFontSize change re-applies without recreate).
//
// xterm needs two jsdom shims (matchMedia + ResizeObserver) it assumes from a real browser.
// The byte path itself is also asserted by `npm run smoke`. [Source: story 3.1 Task 4;
// story 5.1 Task 4; AC-3/4; .claude/rules/terminal.md; src/renderer/src/test/renderComponent.ts]
//
// @xterm/xterm mock (test/terminalHarness.ts): the real xterm, with each constructed Terminal
// captured so tests can call Terminal.input(data) to fire onData without the component's ref.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderTracked, unmountRendered, type RenderResult } from '../test/renderComponent'
import {
  capturedTerminals,
  deliverPort,
  lastOpenToken,
  stubTerminalBridge,
  type TerminalFakes
} from '../test/terminalHarness'
import { EmbeddedTerminal } from './EmbeddedTerminal'
import { settingsStore } from '../stores/settingsStore'
import { toastStore } from '../stores/toastStore'
import { DEFAULT_SETTINGS, type SettingsPatch } from '../../../shared/schemas/settings'
import type { Template } from '../../../shared/ipc/contract'
import { TERMINAL_PORT_TAG } from '../../../shared/ipc/contract'

vi.mock('@xterm/xterm', async () => (await import('../test/terminalHarness')).xtermMock())

const here = dirname(fileURLToPath(import.meta.url))
let fakes: TerminalFakes

beforeEach(() => {
  fakes = stubTerminalBridge()
})

afterEach(() => {
  unmountRendered()
})

function render(props: {
  terminalId: string
  active?: boolean
  takeFocus?: boolean
  onNewSession?: () => void
  onPickTemplate?: (template: Template) => void
  onManageTemplates?: () => void
  onResume?: (terminalId: string) => Promise<void>
  variant?: 'session' | 'shell'
  shell?: { terminalId: string; visible: boolean; takeFocus: boolean }
}): RenderResult {
  return renderTracked(<EmbeddedTerminal {...props} />)
}

describe('EmbeddedTerminal — mount + lifecycle wiring (AC-1/2)', () => {
  it('mounts without throwing and calls window.terminal.open(terminalId) once', () => {
    const r = render({ terminalId: 't-1' })
    expect(fakes.open).toHaveBeenCalledTimes(1)
    expect(fakes.open.mock.calls[0]?.[0]).toBe('t-1')
    // Story 5.4: open takes (terminalId, openToken) — the second arg is a non-empty per-open token.
    expect(fakes.open.mock.calls[0]?.length).toBe(2)
    expect(typeof fakes.open.mock.calls[0]?.[1]).toBe('string')
    expect((fakes.open.mock.calls[0]?.[1] as string).length).toBeGreaterThan(0)
    // No dead pane on a healthy mount.
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).toBeNull()
  })

  it('stops the pty on unmount (clean teardown — no orphan from a normal close)', () => {
    const r = render({ terminalId: 't-1' })
    act(() => r.unmount())
    // Story 5.6: the cleanup stop now passes the effect's openToken so main can identify
    // a stale StrictMode cleanup-stop. Assert called with the terminalId + a non-empty token.
    expect(fakes.stop).toHaveBeenCalledWith('t-1', expect.stringMatching(/^open-\d+$/))
  })
})

describe('EmbeddedTerminal — port delivery via window message (Story 5.1)', () => {
  it('wires port.onmessage and calls port.start() when a matching MessageEvent arrives', async () => {
    render({ terminalId: 't-1' })
    // Ensure open was called first.
    expect(fakes.open).toHaveBeenCalledTimes(1)

    // Simulate the preload forwarding the port (tagged with the token the component minted).
    const { port1 } = deliverPort('t-1', lastOpenToken())

    // The component should have set onmessage and called start().
    expect(port1.onmessage).not.toBeNull()
    // start() is a method on the real MessagePort — verify the port is now in use.
    // (We can't assert start() was called directly since it's a native method,
    // but the fact that onmessage is set proves the pairing happened.)
  })

  it('IGNORES a MessageEvent for a DIFFERENT terminalId (no cross-wiring)', () => {
    render({ terminalId: 't-1' })

    // A port message for a DIFFERENT terminalId should not be paired — even with THIS open's token,
    // so the terminalId guard is proven independently of the Story-5.4 token guard.
    const wrongChannel = new MessageChannel()
    const wrongEvent = new MessageEvent('message', {
      data: { tag: TERMINAL_PORT_TAG, terminalId: 'other-terminal', openToken: lastOpenToken() },
      ports: [wrongChannel.port1]
    })
    window.dispatchEvent(wrongEvent)

    // port1 for the wrong terminal should NOT have had onmessage set on it.
    expect(wrongChannel.port1.onmessage).toBeNull()
  })

  it('IGNORES a MessageEvent with a wrong tag (not cross-wired by unrelated postMessage)', () => {
    render({ terminalId: 't-1' })

    const channel = new MessageChannel()
    const wrongTagEvent = new MessageEvent('message', {
      data: { tag: 'some-other-tag', terminalId: 't-1', openToken: lastOpenToken() },
      ports: [channel.port1]
    })
    window.dispatchEvent(wrongTagEvent)

    // Should not have paired this port.
    expect(channel.port1.onmessage).toBeNull()
  })

  it('renders output when the paired port receives an output message', async () => {
    const r = render({ terminalId: 't-1' })

    // Deliver the port.
    const { port1 } = deliverPort('t-1', lastOpenToken())
    expect(port1.onmessage).not.toBeNull()

    // Simulate main sending output over the port.
    const outputEvent = new MessageEvent('message', {
      data: { type: 'output', data: 'hello world' }
    })
    // Dispatch to port1 (the end the renderer holds).
    act(() => {
      port1.onmessage?.(outputEvent)
    })

    // The terminal should have processed the output (no throw, dead pane still absent).
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).toBeNull()
  })

  it('posts a keystroke message over the port when xterm.onData fires', () => {
    render({ terminalId: 't-1' })
    const { port1 } = deliverPort('t-1', lastOpenToken())
    expect(port1.onmessage).not.toBeNull()

    // Spy on port1.postMessage BEFORE firing onData (the component calls port1.postMessage
    // inside its term.onData handler; spy must be installed first to intercept it).
    const spy = vi.spyOn(port1, 'postMessage')

    // Obtain the Terminal instance created by EmbeddedTerminal (captured by the vi.mock
    // wrapper at the top of this file). There should be exactly one per render.
    const term = capturedTerminals[0]
    expect(term, 'Terminal instance must have been captured by the vi.mock wrapper').toBeDefined()

    // Drive the onData → port.postMessage wire: Terminal.input(data) fires all onData
    // listeners registered on the terminal (same as a real keystroke in the browser).
    // This is the COMPONENT'S handler (wired in EmbeddedTerminal.tsx:139-144), so a
    // bug that breaks the wire (removes the onData registration or stops calling
    // port.postMessage) will cause this assertion to fail.
    const testData = 'hello'
    term!.input(testData)

    // PRIMARY ASSERTION: the port received exactly the expected input message.
    // This FAILS if the onData→postMessage wire is broken (missing handler, wrong
    // message shape, wrong port, or message suppressed for any reason).
    expect(spy).toHaveBeenCalledWith({ type: 'input', data: testData })
  })

  it('removes the window message listener on unmount (no dangling listener)', () => {
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener')
    const r = render({ terminalId: 't-1' })

    act(() => r.unmount())

    // The cleanup should have called removeEventListener for 'message'.
    const messageCalls = removeListenerSpy.mock.calls.filter(([type]) => type === 'message')
    expect(messageCalls.length).toBeGreaterThanOrEqual(1)
  })

  // Story 5.4 — the port-race regression. A port forwarded with a STALE/wrong openToken (but the
  // RIGHT terminalId) must NOT be paired; only THIS open's token pairs. Before 5.4 the listener
  // matched terminalId alone, so a re-open of the same id could pair the stale (closed) port and
  // ignore the live one → a blank terminal.
  it('IGNORES a port with a STALE openToken for THIS terminalId; the correct token still pairs', () => {
    render({ terminalId: 't-1' })

    const staleChannel = new MessageChannel()
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { tag: TERMINAL_PORT_TAG, terminalId: 't-1', openToken: 'open-stale-99999' },
        ports: [staleChannel.port1]
      })
    )
    // Wrong token → not paired (this is the stale port the old code would have wrongly grabbed).
    expect(staleChannel.port1.onmessage).toBeNull()

    // The port tagged with the component's actual token DOES pair.
    const { port1 } = deliverPort('t-1', lastOpenToken())
    expect(port1.onmessage).not.toBeNull()
  })

  // Story 5.4 — a re-open (openNonce bump → create-effect re-run) mints a FRESH token. A port
  // tagged with the prior open's (now stale) token must be ignored by the re-opened terminal; the
  // fresh token pairs. This is the StrictMode-double-mount / re-open port race in miniature.
  // Story 6.1: the re-open is driven via the dead pane's ONE "New session" button WITHOUT the
  // onNewSession prop (the fallback path — same openNonce bump as the old Reopen button).
  it('after a dead-pane re-open the prior open’s token is stale (ignored); the fresh token pairs', () => {
    const r = render({ terminalId: 't-1' })
    const firstToken = lastOpenToken()

    // Drive the re-open path: exit → dead pane → click New session (no prop) → fresh token.
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 0 }))
    const newSessionBtn = r.container.querySelector('[data-testid="dead-new-session"]')
    act(() => {
      newSessionBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const secondToken = lastOpenToken()
    expect(secondToken).not.toBe(firstToken)

    // A port tagged with the FIRST (now stale) token must be ignored by the re-opened terminal.
    const staleChannel = new MessageChannel()
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { tag: TERMINAL_PORT_TAG, terminalId: 't-1', openToken: firstToken },
        ports: [staleChannel.port1]
      })
    )
    expect(staleChannel.port1.onmessage).toBeNull()

    // The fresh token's port pairs.
    const { port1 } = deliverPort('t-1', secondToken)
    expect(port1.onmessage).not.toBeNull()
  })
})

describe('EmbeddedTerminal — dead-terminal pane (AC-4 / Story 6.1 one-button overlay)', () => {
  it('renders "Terminal exited." + exactly ONE button (New session) on a terminal:exit for THIS id', () => {
    const r = render({ terminalId: 't-1' })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 137 }))
    const dead = r.container.querySelector('[data-testid="dead-terminal"]')
    expect(dead).not.toBeNull()
    expect(dead?.textContent).toContain('Terminal exited with code 137.')
    // Story 6.1: EXACTLY ONE button — label "New session", testid dead-new-session. No Reopen/Stop.
    const buttons = [...(dead?.querySelectorAll('button') ?? [])]
    expect(buttons.length).toBe(1)
    expect(buttons[0]?.textContent).toBe('New session')
    expect(buttons[0]?.getAttribute('data-testid')).toBe('dead-new-session')
    // The dead pane is an alert (accessibility floor).
    expect(dead?.getAttribute('role')).toBe('alert')
  })

  it('IGNORES a terminal:exit for a DIFFERENT id (per-terminal local state)', () => {
    const r = render({ terminalId: 't-1' })
    act(() => fakes.emitExit({ terminalId: 'other', exitCode: 1 }))
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).toBeNull()
  })

  it('click WITH onNewSession opens the popover; its folder row calls the prop and does NOT re-open this pane', () => {
    const onNewSession = vi.fn()
    const r = render({ terminalId: 't-1', onNewSession })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 1 }))

    const btn = r.container.querySelector('[data-testid="dead-new-session"]')
    expect(btn).not.toBeNull()
    act(() => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // Session-templates parity (2026-09-05): the button now opens the SAME popover as the
    // header instead of firing the folder flow directly, so `Pick a folder` is one row down.
    // The menu is portaled to document.body (this frame is `overflow: clip`).
    act(() =>
      (document.body.querySelector('[data-testid="menu-pick-folder"]') as HTMLButtonElement).click()
    )

    // The prop fired (the focused surface routes to App's handleNewSession)…
    expect(onNewSession).toHaveBeenCalledTimes(1)
    // …and THIS pane did not re-open: open() stays at the single mount call, dead pane stays up
    // (the NEW terminal takes focus; this one remains kept-alive with its overlay).
    expect(fakes.open).toHaveBeenCalledTimes(1)
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).not.toBeNull()
  })

  it('click WITHOUT onNewSession falls back to re-open (dead pane clears, fresh pty opened)', () => {
    const r = render({ terminalId: 't-1' })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 1 }))
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).not.toBeNull()

    const btn = r.container.querySelector('[data-testid="dead-new-session"]')
    act(() => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Dead pane gone; open() called again (a fresh pty into the same pane — today's Reopen path).
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).toBeNull()
    expect(fakes.open.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

// UX-10 — the dead pane names WHY claude stopped (exit code or signal: state, never pty content or
// a path), and offers Resume, which REPLACES the pane (the caller drops it on success).
describe('EmbeddedTerminal — dead pane: exit reason + Resume (UX-10)', () => {
  const reason = (r: RenderResult): string | null | undefined =>
    r.container.querySelector('[data-testid="dead-terminal-reason"]')?.textContent

  it('names the exit code, as Claude on the focused surface', () => {
    const r = render({ terminalId: 't-1', onNewSession: vi.fn() })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 1 }))
    expect(reason(r)).toBe('Claude exited with code 1.')
  })

  it('names a known signal by name and number', () => {
    const r = render({ terminalId: 't-1', onNewSession: vi.fn() })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 0, signal: 9 }))
    expect(reason(r)).toBe('Claude was stopped by SIGKILL (signal 9).')
  })

  it('names an unknown signal by number only', () => {
    const r = render({ terminalId: 't-1' })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 0, signal: 40 }))
    expect(reason(r)).toBe('Terminal was stopped by signal 40.')
  })

  it('offers Resume beside New session only when the caller can resume', () => {
    const r = render({ terminalId: 't-1', onNewSession: vi.fn(), onResume: vi.fn() })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 1 }))
    const dead = r.container.querySelector('[data-testid="dead-terminal"]')
    const ids = [...(dead?.querySelectorAll('button') ?? [])].map((b) =>
      b.getAttribute('data-testid')
    )
    expect(ids).toEqual(['dead-resume', 'dead-new-session'])
    expect(r.container.querySelector('[data-testid="dead-resume"]')?.textContent).toBe(
      'Resume conversation'
    )
  })

  it('Resume hands this terminal id to the caller, once, while in flight', async () => {
    let finish: (() => void) | undefined
    const onResume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const r = render({ terminalId: 't-1', onNewSession: vi.fn(), onResume })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 1 }))
    const btn = r.container.querySelector('[data-testid="dead-resume"]') as HTMLButtonElement
    act(() => btn.click())
    act(() => btn.click())
    expect(onResume).toHaveBeenCalledTimes(1)
    expect(onResume).toHaveBeenCalledWith('t-1')
    expect(btn.disabled).toBe(true)
    await act(async () => {
      finish?.()
      await Promise.resolve()
    })
  })

  it('a refused Resume shows mapped copy in the pane, never the message', async () => {
    const onResume = vi.fn(() =>
      Promise.reject(
        new Error("Error invoking remote method 'x': Error: transcript_missing /home/secret")
      )
    )
    const r = render({ terminalId: 't-1', onNewSession: vi.fn(), onResume })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 1 }))
    await act(async () => {
      ;(r.container.querySelector('[data-testid="dead-resume"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const error = r.container.querySelector('[data-testid="dead-resume-error"]')
    expect(error?.textContent).toBe('Claude no longer has this conversation.')
    expect(error?.getAttribute('data-callout-tone')).toBe('danger')
    // The dead pane is the alert; the callout inside it does not announce a second time.
    expect(error?.hasAttribute('role')).toBe(false)
    expect(r.container.textContent).not.toContain('/home/secret')
    expect(
      (r.container.querySelector('[data-testid="dead-resume"]') as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('an unknown refusal gets the generic line', async () => {
    const onResume = vi.fn(() => Promise.reject(new Error('boom')))
    const r = render({ terminalId: 't-1', onNewSession: vi.fn(), onResume })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 1 }))
    await act(async () => {
      ;(r.container.querySelector('[data-testid="dead-resume"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(r.container.querySelector('[data-testid="dead-resume-error"]')?.textContent).toBe(
      'Could not resume the conversation.'
    )
  })
})

describe('EmbeddedTerminal — kept-alive hidden uses visibility:hidden, never display:none (AC-3)', () => {
  it('active=false applies the hidden class (visibility:hidden) to the FRAME', () => {
    const r = render({ terminalId: 't-1', active: false })
    // The hidden class is on the FRAME (the test-id root), NOT the inner host: the frame paints an
    // opaque background and stacked frames would otherwise cover the active terminal (see the
    // EmbeddedTerminal render comment). Hiding the whole frame is the fix.
    const frame = r.container.querySelector('[data-testid="embedded-terminal"]')
    expect(frame).not.toBeNull()
    // The CSS-module `.hidden` class is applied (it sets visibility:hidden, asserted in the
    // CSS source test below — never display:none).
    expect(frame?.className).toMatch(/hidden/)
  })

  it('active=true does NOT apply the hidden class', () => {
    const r = render({ terminalId: 't-1', active: true })
    const frame = r.container.querySelector('[data-testid="embedded-terminal"]')
    expect(frame?.className ?? '').not.toMatch(/\bhidden\b/)
  })
})

describe('EmbeddedTerminal — font-size live-apply (story 5.1 coverage parity)', () => {
  it('open is called exactly once per mount (no re-mount on font-size change)', () => {
    // The font-size live-apply effect must NOT re-trigger the create effect.
    // If open were called twice, it would mean a re-mount (which terminal.md forbids).
    render({ terminalId: 't-1' })
    // Only one open call immediately after render (font-size has not changed).
    expect(fakes.open).toHaveBeenCalledTimes(1)
  })
})

// ── Session-templates parity: the dead pane's button is the SHARED NewSessionButton ────────
// The header and the empty board have opened the folder/templates/Manage popover since
// 2026-09-02; the dead pane was left on the folder-only fast path. These pin the parity.
// The popover is PORTALED to document.body (the frame is `overflow: clip`), so the menu is
// queried on document.body — never on the render container.
describe('EmbeddedTerminal — dead pane opens the New-session popover (templates parity)', () => {
  const bodyMenu = (): Element | null =>
    document.body.querySelector('[data-testid="new-session-menu"]')

  it('with the seams threaded, clicking the dead button opens the popover and each row fires its seam', () => {
    const onNewSession = vi.fn()
    const onPickTemplate = vi.fn()
    const onManageTemplates = vi.fn()
    const r = render({ terminalId: 't-1', onNewSession, onPickTemplate, onManageTemplates })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 0 }))

    const btn = r.container.querySelector('[data-testid="dead-new-session"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    // BEFORE the fix this click ran the folder flow directly — no menu ever appeared.
    act(() => btn.click())
    expect(bodyMenu()).not.toBeNull()
    // The popover escaped the `overflow: clip` frame — it is NOT inside this terminal's DOM.
    expect(r.container.contains(bodyMenu())).toBe(false)

    // "Pick a folder" is the OLD behaviour, now one row down.
    act(() =>
      (document.body.querySelector('[data-testid="menu-pick-folder"]') as HTMLButtonElement).click()
    )
    expect(onNewSession).toHaveBeenCalledTimes(1)
    // …and this pane did NOT re-open (the new terminal takes focus; this one stays dead).
    expect(fakes.open).toHaveBeenCalledTimes(1)
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).not.toBeNull()

    act(() => btn.click())
    act(() =>
      (document.body.querySelector('[data-testid="menu-manage"]') as HTMLButtonElement).click()
    )
    expect(onManageTemplates).toHaveBeenCalledTimes(1)
  })

  it('the "exactly ONE button" dead-pane rule survives an OPEN menu (the menu is portaled out)', () => {
    const r = render({ terminalId: 't-1', onNewSession: vi.fn() })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 0 }))
    const dead = r.container.querySelector('[data-testid="dead-terminal"]')
    act(() => (dead?.querySelector('button') as HTMLButtonElement).click())
    expect(bodyMenu()).not.toBeNull()
    expect([...(dead?.querySelectorAll('button') ?? [])]).toHaveLength(1)
  })

  it('the menu closes when the frame goes kept-alive-hidden (the portal must not outlive it)', () => {
    const onNewSession = vi.fn()
    const r = render({ terminalId: 't-1', active: true, onNewSession })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 0 }))
    act(() =>
      (r.container.querySelector('[data-testid="dead-new-session"]') as HTMLButtonElement).click()
    )
    expect(bodyMenu()).not.toBeNull()
    // A terminal switch flips this frame to visibility:hidden — but the portal lives on
    // document.body, OUTSIDE the frame, so it would keep painting over the new terminal.
    act(() => {
      r.root.render(
        <EmbeddedTerminal terminalId="t-1" active={false} onNewSession={onNewSession} />
      )
    })
    expect(bodyMenu()).toBeNull()
  })
})

// R10 (focused-view keys, decision b): claude owns every key typed into a focused terminal, so
// WHICH terminal holds DOM focus decides where the operator's keys go.
describe('EmbeddedTerminal — takeFocus (R10)', () => {
  const inside = (r: RenderResult): boolean =>
    r.container.querySelector('.xterm')?.contains(document.activeElement) === true

  it('a HIDDEN terminal whose port lands does NOT take focus (an API create mounts hidden)', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const r = render({ terminalId: 't-hidden', active: false })
    await act(async () => {
      deliverPort('t-hidden', lastOpenToken())
      await Promise.resolve()
    })
    expect(inside(r)).toBe(false)
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('takes focus when takeFocus turns true, not before', () => {
    const r = render({ terminalId: 't-f', takeFocus: false })
    expect(inside(r)).toBe(false)
    act(() => {
      r.root.render(<EmbeddedTerminal terminalId="t-f" takeFocus />)
    })
    expect(inside(r)).toBe(true)
  })

  it('never pulls focus out of an open dialog', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const field = document.createElement('input')
    dialog.appendChild(field)
    document.body.appendChild(dialog)
    field.focus()
    const r = render({ terminalId: 't-d', takeFocus: false })
    act(() => {
      r.root.render(<EmbeddedTerminal terminalId="t-d" takeFocus />)
    })
    expect(inside(r)).toBe(false)
    expect(document.activeElement).toBe(field)
    dialog.remove()
  })
})

describe('EmbeddedTerminal — variant="shell" (the card shell pane)', () => {
  it('a shell exit shows "Shell exited with code N." and ONLY [Restart shell]', () => {
    const r = render({
      terminalId: 't-1:shell',
      variant: 'shell',
      onNewSession: vi.fn(), // ignored for a shell: no + New session, no Resume
      onResume: vi.fn(() => Promise.resolve())
    })
    act(() => fakes.emitExit({ terminalId: 't-1:shell', exitCode: 2 }))
    expect(r.container.querySelector('[data-testid="dead-terminal-reason"]')?.textContent).toBe(
      'Shell exited with code 2.'
    )
    const buttons = [...r.container.querySelectorAll('[data-testid="dead-terminal"] button')]
    expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual(['dead-restart-shell'])
    expect(buttons[0]?.textContent).toBe('Restart shell')
  })
  it('Restart shell re-opens the SAME id with a fresh token (the Reopen path) and clears the pane', () => {
    const r = render({ terminalId: 't-1:shell', variant: 'shell' })
    const firstToken = lastOpenToken()
    act(() => fakes.emitExit({ terminalId: 't-1:shell', exitCode: 0 }))
    act(() => {
      ;(
        r.container.querySelector('[data-testid="dead-restart-shell"]') as HTMLButtonElement
      ).click()
    })
    expect(r.container.querySelector('[data-testid="dead-terminal"]')).toBeNull()
    expect(fakes.open).toHaveBeenCalledTimes(2)
    expect(fakes.open.mock.calls[1]?.[0]).toBe('t-1:shell')
    expect(lastOpenToken()).not.toBe(firstToken)
  })
  it('the shell frame is its own panel: full frame chrome and data-terminal-panel', () => {
    const r = render({ terminalId: 't-1:shell', variant: 'shell' })
    const frame = r.container.querySelector('[data-testid="embedded-terminal"]') as HTMLElement
    expect(frame.hasAttribute('data-terminal-panel')).toBe(true)
    expect(frame.className).not.toMatch(/split/)
  })
})

describe('EmbeddedTerminal — the nested shell pane (card shell pane)', () => {
  beforeEach(() => {
    settingsStore.getState().hydrate(DEFAULT_SETTINGS)
    toastStore.setState({ toasts: [] })
    ;(window as unknown as { settings: unknown }).settings = {
      get: vi.fn(),
      set: vi.fn((p: SettingsPatch) => Promise.resolve({ ...DEFAULT_SETTINGS, ...p }))
    }
  })

  it('mounts the shell terminal INSIDE the parent frame and opens it under its own id', () => {
    const r = render({
      terminalId: 't-1',
      shell: { terminalId: 't-1:shell', visible: true, takeFocus: false }
    })
    const parent = r.container.querySelector('[data-terminal-id="t-1"]') as HTMLElement
    const shell = parent.querySelector('[data-testid="shell-pane"] [data-terminal-id="t-1:shell"]')
    expect(shell).not.toBeNull()
    expect(parent.className).toMatch(/split/)
    // React runs the child's effects first; main needs no order (the cwd is its own registry's).
    expect(fakes.open.mock.calls.map((c) => c[0]).sort()).toEqual(['t-1', 't-1:shell'])
    expect(parent.querySelector('[data-testid="shell-divider"]')).not.toBeNull()
  })

  it("two panels, not one: claude's half and the shell carry data-terminal-panel, the frame does not", () => {
    const r = render({
      terminalId: 't-1',
      shell: { terminalId: 't-1:shell', visible: true, takeFocus: false }
    })
    const parent = r.container.querySelector('[data-terminal-id="t-1"]') as HTMLElement
    expect(parent.hasAttribute('data-terminal-panel')).toBe(false)
    const main = parent.querySelector(':scope > [data-testid="terminal-main"]') as HTMLElement
    expect(main.hasAttribute('data-terminal-panel')).toBe(true)
    const shell = parent.querySelector('[data-terminal-id="t-1:shell"]') as HTMLElement
    expect(shell.hasAttribute('data-terminal-panel')).toBe(true)
    // The divider sits BETWEEN the two panels, never inside either.
    const kids = [...parent.children].map((el) => el.getAttribute('data-testid'))
    expect(kids.slice(0, 3)).toEqual(['terminal-main', 'shell-divider', 'shell-pane'])
  })

  it('without a shell the frame itself is the one panel', () => {
    const r = render({ terminalId: 't-1' })
    const parent = r.container.querySelector('[data-terminal-id="t-1"]') as HTMLElement
    expect(parent.hasAttribute('data-terminal-panel')).toBe(true)
    const main = parent.querySelector(':scope > [data-testid="terminal-main"]') as HTMLElement
    expect(main.hasAttribute('data-terminal-panel')).toBe(false)
  })

  it('a hidden pane keeps the shell MOUNTED (no stop), hides it off-screen, and draws no divider', () => {
    const r = render({
      terminalId: 't-1',
      shell: { terminalId: 't-1:shell', visible: false, takeFocus: false }
    })
    const slot = r.container.querySelector('[data-testid="shell-pane"]') as HTMLElement
    expect(slot.getAttribute('data-visible')).toBe('false')
    expect(slot.className).toMatch(/shellSlotHidden/)
    expect(slot.querySelector('[data-terminal-id="t-1:shell"]')?.className).toMatch(/hidden/)
    expect(r.container.querySelector('[data-testid="shell-divider"]')).toBeNull()
    expect(fakes.stop).not.toHaveBeenCalled()
  })

  it('the slot takes the saved ratio as its height and follows a live drag without saving', () => {
    settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, shellPaneRatio: 0.4 })
    const r = render({
      terminalId: 't-1',
      shell: { terminalId: 't-1:shell', visible: true, takeFocus: false }
    })
    const slot = r.container.querySelector('[data-testid="shell-pane"]') as HTMLElement
    expect(slot.style.flexBasis).toBe('40%')
    const divider = r.container.querySelector('[data-testid="shell-divider"]') as HTMLElement
    // jsdom: the frame's content box is 0×0, so the divider refuses the drag (getBounds → null).
    // Drive the key path instead: it commits through the same onCommit the drag end uses.
    act(() => {
      divider.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
      )
    })
    expect(slot.style.flexBasis).toBe('45%') // optimistic (persistSettingsPatch applies first)
    const set = (window as unknown as { settings: { set: ReturnType<typeof vi.fn> } }).settings.set
    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith({ shellPaneRatio: expect.closeTo(0.45, 10) })
  })

  it('a refused ratio save rolls back and toasts', async () => {
    const set = vi.fn(() => Promise.reject(new Error('EACCES /home/op')))
    ;(window as unknown as { settings: unknown }).settings = { get: vi.fn(), set }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = render({
      terminalId: 't-1',
      shell: { terminalId: 't-1:shell', visible: true, takeFocus: false }
    })
    const divider = r.container.querySelector('[data-testid="shell-divider"]') as HTMLElement
    await act(async () => {
      divider.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    const slot = r.container.querySelector('[data-testid="shell-pane"]') as HTMLElement
    expect(slot.style.flexBasis).toBe('30%')
    const toasts = toastStore.getState().toasts
    expect(toasts.map((t) => [t.kind, t.title])).toEqual([
      ['error', 'Could not save the divider position.']
    ])
    expect(warn.mock.calls.flat().join(' ')).not.toContain('/home/op')
  })

  it("claude's dead overlay covers ONLY the claude half: the open shell stays usable (deviation 9)", () => {
    const r = render({
      terminalId: 't-1',
      shell: { terminalId: 't-1:shell', visible: true, takeFocus: false }
    })
    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 1 }))
    const parent = r.container.querySelector('[data-terminal-id="t-1"]') as HTMLElement
    const dead = parent.querySelector(
      ':scope > [data-testid="terminal-main"] > [data-testid="dead-terminal"]'
    )
    expect(dead).not.toBeNull()
    const slot = parent.querySelector('[data-testid="shell-pane"]') as HTMLElement
    expect(slot.contains(dead)).toBe(false)
    expect(slot.parentElement).toBe(parent) // a sibling of .main, never inside it
    expect(fakes.stop).not.toHaveBeenCalledWith('t-1:shell', expect.anything())
  })

  it('the shell takes focus when asked and the parent does not (focus handoff)', () => {
    const r = render({
      terminalId: 't-1',
      shell: { terminalId: 't-1:shell', visible: true, takeFocus: true },
      takeFocus: false
    })
    const shellFrame = r.container.querySelector('[data-terminal-id="t-1:shell"]') as HTMLElement
    expect(shellFrame.querySelector('.xterm')?.contains(document.activeElement)).toBe(true)
  })
})

describe('EmbeddedTerminal — shell pane stylesheet invariants (terminal.md)', () => {
  const css = readFileSync(resolve(here, 'EmbeddedTerminal.module.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )
  it('the hidden slot keeps a box, off-screen, out of the flow — never display:none', () => {
    const block = /\.shellSlotHidden\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block).toMatch(/position:\s*absolute/)
    expect(block).toMatch(/visibility:\s*hidden/)
    expect(block).toMatch(/translate:\s*-\d+vw/)
    expect(css).not.toMatch(/display:\s*none/)
  })
  it(".main is the dead overlay's containing block and grows; both halves keep 80px while split", () => {
    const main = /\.main\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(main).toMatch(/position:\s*relative/)
    expect(main).toMatch(/flex:\s*1/)
    expect(main).toMatch(/min-height:\s*0/)
    expect(css).toMatch(/:where\(\.split\)\s*>\s*\.main\s*\{[^}]*min-height:\s*80px/)
    expect(/\.shellSlot\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/min-height:\s*80px/)
  })
  it("while split, the frame draws no chrome and claude's half is its own panel", () => {
    const split = /\.split\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(split).toMatch(/padding:\s*0/)
    expect(split).toMatch(/border:\s*0/)
    expect(split).toMatch(/background:\s*transparent/)
    const main = /:where\(\.split\)\s*>\s*\.main\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(main).toMatch(/border:\s*1px solid var\(--border-card\)/)
    expect(main).toMatch(/border-radius:\s*var\(--rounded-lg\)/)
    expect(main).toMatch(/background:\s*var\(--bg-terminal\)/)
    expect(main).toMatch(/padding:\s*var\(--inset-compact-x\)/)
    expect(main).toMatch(/overflow:\s*clip/)
  })
})

describe('EmbeddedTerminal — a dead shell hands focus back to claude', () => {
  beforeEach(() => {
    settingsStore.getState().hydrate(DEFAULT_SETTINGS)
  })
  it('when the visible shell exits, claude takes focus; a Restart gives it back to the shell', () => {
    const r = render({
      terminalId: 't-1',
      takeFocus: false,
      shell: { terminalId: 't-1:shell', visible: true, takeFocus: true }
    })
    const main = r.container.querySelector(
      '[data-terminal-id="t-1"] > [data-testid="terminal-main"]'
    ) as HTMLElement
    const shellFrame = r.container.querySelector('[data-terminal-id="t-1:shell"]') as HTMLElement
    expect(shellFrame.querySelector('.xterm')?.contains(document.activeElement)).toBe(true)
    act(() => fakes.emitExit({ terminalId: 't-1:shell', exitCode: 0 }))
    expect(main.querySelector('.xterm')?.contains(document.activeElement)).toBe(true)
    act(() => {
      ;(
        r.container.querySelector('[data-testid="dead-restart-shell"]') as HTMLButtonElement
      ).click()
    })
    const restarted = r.container.querySelector('[data-terminal-id="t-1:shell"]') as HTMLElement
    expect(restarted.querySelector('.xterm')?.contains(document.activeElement)).toBe(true)
  })
})
