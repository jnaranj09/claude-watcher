// EmbeddedTerminal — keys typed before the MessagePort pairs are queued and sent, in order, when
// it pairs (a fix: the operator can click into a new pane and type before main hands the port
// over). Its own file because it renders with React Testing Library (`screen`), which turns on the
// testing-library lint rules the older tests in EmbeddedTerminal.test.tsx are budgeted against.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { screen } from '@testing-library/react'
import { renderTracked, unmountRendered } from '../test/renderComponent'
import {
  capturedKeyHandlers,
  capturedTerminals,
  deliverPort,
  lastOpenToken,
  stubTerminalBridge,
  type TerminalFakes
} from '../test/terminalHarness'
import { EmbeddedTerminal } from './EmbeddedTerminal'
import { TERMINAL_PORT_TAG } from '../../../shared/ipc/contract'

vi.mock('@xterm/xterm', async () => (await import('../test/terminalHarness')).xtermMock())

let fakes: TerminalFakes

beforeEach(() => {
  fakes = stubTerminalBridge()
})

afterEach(() => {
  unmountRendered()
})

function render(props: { terminalId: string }): void {
  renderTracked(<EmbeddedTerminal {...props} />)
}

/** The `data` of every `{ type: 'input' }` message posted on any MessagePort, in order. */
function inputsPosted(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .map(([message]) => message as { type: string; data?: string })
    .filter((message) => message.type === 'input')
    .map((message) => message.data ?? '')
}

describe('EmbeddedTerminal — keys typed before the port pairs are kept', () => {
  it('sends keys typed before pairing, in order, once the port pairs', () => {
    render({ terminalId: 't-1' })
    const spy = vi.spyOn(MessagePort.prototype, 'postMessage')
    const term = capturedTerminals[0]!

    term.input('a')
    term.input('b')
    deliverPort('t-1', lastOpenToken())
    term.input('c')

    expect(inputsPosted(spy)).toEqual(['a', 'b', 'c'])
  })

  it('a Ctrl+V before pairing is sent once the port pairs', () => {
    render({ terminalId: 't-1' })
    const spy = vi.spyOn(MessagePort.prototype, 'postMessage')
    const handler = capturedKeyHandlers[0]!

    const suppressed = handler(new KeyboardEvent('keydown', { ctrlKey: true, key: 'v' }))
    deliverPort('t-1', lastOpenToken())

    expect(suppressed).toBe(false)
    expect(inputsPosted(spy)).toEqual(['\x16'])
  })

  it('queued keys go to the paired port only, never to a stale-token port', () => {
    render({ terminalId: 't-1' })
    const spy = vi.spyOn(MessagePort.prototype, 'postMessage')
    capturedTerminals[0]!.input('a')

    const stale = new MessageChannel()
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { tag: TERMINAL_PORT_TAG, terminalId: 't-1', openToken: 'open-stale-1' },
        ports: [stale.port1]
      })
    )
    const { port1 } = deliverPort('t-1', lastOpenToken())

    expect(inputsPosted(spy)).toEqual(['a'])
    expect(spy.mock.contexts).toEqual([port1])
  })

  it('a re-open never receives keys queued by the previous open', () => {
    render({ terminalId: 't-1' })
    capturedTerminals[0]!.input('old')

    act(() => fakes.emitExit({ terminalId: 't-1', exitCode: 0 }))
    const newSession = screen.getByTestId('dead-new-session')
    act(() => newSession.click())
    const spy = vi.spyOn(MessagePort.prototype, 'postMessage')
    deliverPort('t-1', lastOpenToken())

    expect(inputsPosted(spy)).toEqual([])
  })
})
