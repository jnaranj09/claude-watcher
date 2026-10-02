import { describe, it, expect, vi } from 'vitest'
import { CH } from '../../shared/ipc/contract'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { createRendererIpc, isTrustedSender, rendererSource } from './trustedIpc'

const INDEX_HTML = '/opt/app/resources/app.asar/out/renderer/index.html'
const FILE = rendererSource(undefined, INDEX_HTML)
const DEV = rendererSource('http://localhost:5173', INDEX_HTML)
const top = (url: string): { url: string; parent: null } => ({ url, parent: null })

describe('rendererSource', () => {
  it('is the dev server only when a dev URL is set', () => {
    expect(DEV).toEqual({ kind: 'dev', url: 'http://localhost:5173' })
    expect(FILE).toEqual({ kind: 'file', path: INDEX_HTML })
    expect(rendererSource('', INDEX_HTML)).toEqual(FILE)
  })
})

describe('isTrustedSender', () => {
  it("trusts the packaged renderer's top frame, hash and query ignored", () => {
    expect(isTrustedSender(top(`file://${INDEX_HTML}`), FILE)).toBe(true)
    expect(isTrustedSender(top(`file://${INDEX_HTML}#terminals`), FILE)).toBe(true)
    expect(isTrustedSender(top(`file://${INDEX_HTML}?x=1`), FILE)).toBe(true)
  })

  it('trusts any path on the dev server origin', () => {
    expect(isTrustedSender(top('http://localhost:5173/'), DEV)).toBe(true)
    expect(isTrustedSender(top('http://localhost:5173/index.html#terminals'), DEV)).toBe(true)
  })

  it('rejects another file, another origin or another scheme', () => {
    expect(isTrustedSender(top('file:///tmp/evil.html'), FILE)).toBe(false)
    expect(isTrustedSender(top(`http://localhost:5173${INDEX_HTML}`), FILE)).toBe(false)
    expect(isTrustedSender(top('http://localhost:5174/'), DEV)).toBe(false)
    expect(isTrustedSender(top('https://example.com/'), DEV)).toBe(false)
    expect(isTrustedSender(top(`file://${INDEX_HTML}`), DEV)).toBe(false)
  })

  it('rejects a sub-frame, a gone frame and an unparsable URL', () => {
    expect(isTrustedSender({ url: `file://${INDEX_HTML}`, parent: top('x') }, FILE)).toBe(false)
    expect(isTrustedSender(null, FILE)).toBe(false)
    expect(isTrustedSender(top('not a url'), FILE)).toBe(false)
    expect(isTrustedSender(top(''), DEV)).toBe(false)
  })
})

describe('createRendererIpc', () => {
  type FakeEvent = IpcMainEvent & IpcMainInvokeEvent
  type Recorded = (event: FakeEvent, ...args: unknown[]) => unknown
  // Only `senderFrame` is read; the rest of the event is never touched.
  const from = (frame: { url: string; parent: unknown } | null): FakeEvent =>
    ({ senderFrame: frame }) as unknown as FakeEvent
  const OWN = from(top(`file://${INDEX_HTML}#terminals`))
  const FOREIGN = [
    from(top('file:///tmp/evil.html')),
    from({ url: `file://${INDEX_HTML}`, parent: top('x') }),
    from(null)
  ]

  function setup(): {
    ipc: ReturnType<typeof createRendererIpc>
    registered: Map<string, Recorded>
    log: ReturnType<typeof vi.fn>
  } {
    const registered = new Map<string, Recorded>()
    const record = (channel: string, listener: Recorded): void => {
      registered.set(channel, listener)
    }
    const log = vi.fn()
    const ipc = createRendererIpc({ ipcMain: { handle: record, on: record }, source: FILE, log })
    return { ipc, registered, log }
  }

  it("passes the own renderer's invoke through with its args and result", async () => {
    const { ipc, registered, log } = setup()
    ipc.handle(CH.tagsList, (_e, a: unknown) => `got ${String(a)}`)
    await expect(Promise.resolve(registered.get(CH.tagsList)?.(OWN, 7))).resolves.toBe('got 7')
    expect(log).not.toHaveBeenCalled()
  })

  it('rejects a foreign file, a sub-frame and a gone frame; logs only code + channel', () => {
    const { ipc, registered, log } = setup()
    const listener = vi.fn()
    ipc.handle(CH.tagsList, listener)
    for (const event of FOREIGN) {
      expect(() => registered.get(CH.tagsList)?.(event, 'secret-arg')).toThrow(
        'ipc_sender_rejected'
      )
    }
    expect(listener).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(FOREIGN.length)
    expect(log).toHaveBeenCalledWith(
      `[claude-watcher][ipc] code=ipc_sender_rejected channel=${CH.tagsList}`
    )
  })

  it("drops a foreign send and passes the own renderer's send", () => {
    const { ipc, registered } = setup()
    const listener = vi.fn()
    ipc.on(CH.terminalOpen, listener)
    for (const event of FOREIGN) registered.get(CH.terminalOpen)?.(event, {})
    expect(listener).not.toHaveBeenCalled()
    registered.get(CH.terminalOpen)?.(OWN, { terminalId: 't' })
    expect(listener).toHaveBeenCalledWith(OWN, { terminalId: 't' })
  })
})
