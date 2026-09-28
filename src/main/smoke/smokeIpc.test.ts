import { describe, expect, it } from 'vitest'
import { CH } from '../../shared/ipc/contract'
import { registerSmokeIpc, type SmokeIpcHandlers, type SmokeIpcTarget } from './smokeIpc'

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
