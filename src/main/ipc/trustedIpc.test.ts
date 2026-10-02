import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { CH } from '../../shared/ipc/contract'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { createTrustedIpc, isTrustedSender, rendererSource } from './trustedIpc'

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

describe('createTrustedIpc', () => {
  type FakeEvent = IpcMainEvent & IpcMainInvokeEvent
  type Recorded = (event: FakeEvent, ...args: unknown[]) => unknown
  // The wrapper never reads the event itself (`isTrusted` is stubbed), so an empty one will do.
  const event = {} as FakeEvent

  function setup(trusted: boolean): {
    ipc: ReturnType<typeof createTrustedIpc>
    registered: Map<string, Recorded>
    log: ReturnType<typeof vi.fn>
  } {
    const registered = new Map<string, Recorded>()
    const record = (channel: string, listener: Recorded): void => {
      registered.set(channel, listener)
    }
    const log = vi.fn()
    const ipc = createTrustedIpc({
      ipcMain: { handle: record, on: record },
      isTrusted: () => trusted,
      log
    })
    return { ipc, registered, log }
  }

  it('passes a trusted invoke through with its args and result', async () => {
    const { ipc, registered, log } = setup(true)
    ipc.handle(CH.tagsList, (_e, a: unknown) => `got ${String(a)}`)
    await expect(Promise.resolve(registered.get(CH.tagsList)?.(event, 7))).resolves.toBe('got 7')
    expect(log).not.toHaveBeenCalled()
  })

  it('rejects an untrusted invoke with a code and logs only code + channel', () => {
    const { ipc, registered, log } = setup(false)
    const listener = vi.fn()
    ipc.handle(CH.tagsList, listener)
    expect(() => registered.get(CH.tagsList)?.(event, 'secret-arg')).toThrow('ipc_sender_rejected')
    expect(listener).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      `[claude-watcher][ipc] code=ipc_sender_rejected channel=${CH.tagsList}`
    )
  })

  it('drops an untrusted send without calling the listener', () => {
    const { ipc, registered, log } = setup(false)
    const listener = vi.fn()
    ipc.on(CH.terminalOpen, listener)
    expect(registered.get(CH.terminalOpen)?.(event, {})).toBeUndefined()
    expect(listener).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('passes a trusted send through', () => {
    const { ipc, registered } = setup(true)
    const listener = vi.fn()
    ipc.on(CH.terminalOpen, listener)
    registered.get(CH.terminalOpen)?.(event, { terminalId: 't' })
    expect(listener).toHaveBeenCalledWith(event, { terminalId: 't' })
  })
})

describe('trusted IPC guard', () => {
  it('no main file registers on ipcMain directly (only trustedIpc.ts does)', () => {
    const mainDir = join(__dirname, '..')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
      )
    const offenders = walk(mainDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => relative(mainDir, f).split(sep).join('/') !== 'ipc/trustedIpc.ts')
      .filter((f) =>
        // Comments may name the API; code may not call it.
        /^[^/*]*\bipcMain\s*\.\s*(handle|handleOnce|on|once)\s*\(/m.test(readFileSync(f, 'utf8'))
      )
      .map((f) => relative(mainDir, f))
    expect(offenders).toEqual([])
  })
})
