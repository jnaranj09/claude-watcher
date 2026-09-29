import { describe, expect, it } from 'vitest'
import { CH } from '../../shared/ipc/contract'
import {
  containSmokeReport,
  registerSmokeIpc,
  type SmokeIpcHandlers,
  type SmokeIpcTarget
} from './smokeIpc'

function recordingIpc(): { ipc: SmokeIpcTarget; channels: string[] } {
  const channels: string[] = []
  const ipc: SmokeIpcTarget = {
    on: (channel) => channels.push(channel),
    handle: (channel) => channels.push(channel)
  }
  return { ipc, channels }
}

const handlers: SmokeIpcHandlers = {
  config: () => ({ enabled: false }),
  ptyStart: () => {},
  ptyInput: () => {},
  ptyResize: () => {},
  report: () => {}
}

describe('registerSmokeIpc', () => {
  it('outside smoke registers ONLY smokeConfig — no raw shell, no archive-less exit', () => {
    const r = recordingIpc()
    registerSmokeIpc(r.ipc, false, handlers)
    expect(r.channels).toEqual([CH.smokeConfig])
  })

  it('in smoke registers the cockpit channels too', () => {
    const r = recordingIpc()
    registerSmokeIpc(r.ipc, true, handlers)
    expect(r.channels).toEqual([
      CH.smokeConfig,
      CH.ptyStart,
      CH.ptyInput,
      CH.ptyResize,
      CH.smokeReport
    ])
  })
})

describe('containSmokeReport', () => {
  it('a rejected report logs a CODE only and exits non-zero — never a discarded rejection', async () => {
    const log: string[] = []
    const exits: number[] = []
    await containSmokeReport(() => Promise.reject(new Error('/home/op/secret path')), {
      log: (m) => log.push(m),
      exit: (code) => exits.push(code)
    })
    expect(exits).toEqual([1])
    expect(log).toEqual(['[claude-watcher][smoke] code=smoke_report_failed'])
  })

  it('a report that resolves exits nothing here (it exits itself) and logs nothing', async () => {
    const log: string[] = []
    const exits: number[] = []
    await containSmokeReport(() => Promise.resolve(), {
      log: (m) => log.push(m),
      exit: (code) => exits.push(code)
    })
    expect(exits).toEqual([])
    expect(log).toEqual([])
  })
})
