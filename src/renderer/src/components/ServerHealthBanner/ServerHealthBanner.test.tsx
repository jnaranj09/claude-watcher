// UX-05 — the banner is the ONLY sign that session status is off. These pin that it draws for
// every failure state, names the port, and stays away while the listener is fine or starting.

import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import type { ServerHealth } from '../../../../shared/ipc/contract'
import { ServerHealthBanner } from './ServerHealthBanner'
import { serverHealthMessage } from '../../lib/serverHealthCopy'
import { useServerHealth } from '../../hooks/useServerHealth'

const health = (hooks: ServerHealth['hooks']): ServerHealth => ({
  hooks,
  hookPort: 9279,
  api: 'off'
})

let r: RenderResult | undefined
afterEach(() => {
  r?.unmount()
  r = undefined
  delete (window as unknown as { serverHealth?: unknown }).serverHealth
})

describe('serverHealthMessage', () => {
  it('says nothing while starting, ok, or not known yet', () => {
    expect(serverHealthMessage(null)).toBeNull()
    expect(serverHealthMessage(health('starting'))).toBeNull()
    expect(serverHealthMessage(health('ok'))).toBeNull()
  })

  it('names the port when another program holds it', () => {
    expect(serverHealthMessage(health('port_in_use'))).toContain('port 9279')
  })

  it('has copy for every failure state', () => {
    for (const s of ['port_in_use', 'server_error', 'hooks_file_failed'] as const) {
      expect(serverHealthMessage(health(s))).toMatch(/^Session status is off/)
    }
  })
})

function Probe(): React.JSX.Element | null {
  return <ServerHealthBanner health={useServerHealth()} />
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('ServerHealthBanner + useServerHealth', () => {
  it('draws the alert from the first answer, and clears on a healthy push', async () => {
    let push: ((h: ServerHealth) => void) | null = null
    ;(window as unknown as { serverHealth: unknown }).serverHealth = {
      get: () => Promise.resolve(health('port_in_use')),
      onChanged: (cb: (h: ServerHealth) => void) => {
        push = cb
        return () => {}
      }
    }
    r = renderComponent(<Probe />)
    await settle()
    const banner = r.container.querySelector('[data-testid="server-health-banner"]')
    expect(banner?.getAttribute('role')).toBe('alert')
    expect(banner?.getAttribute('data-callout-tone')).toBe('danger')

    act(() => push?.(health('ok')))
    expect(r.container.querySelector('[data-testid="server-health-banner"]')).toBeNull()
  })

  it('a push that lands before the first answer wins over it', async () => {
    ;(window as unknown as { serverHealth: unknown }).serverHealth = {
      get: () => Promise.resolve(health('ok')),
      onChanged: (cb: (h: ServerHealth) => void) => {
        cb(health('port_in_use'))
        return () => {}
      }
    }
    r = renderComponent(<Probe />)
    await settle()
    expect(r.container.querySelector('[data-testid="server-health-banner"]')).not.toBeNull()
  })

  it('no bridge (a test that does not stub it) draws nothing and does not throw', async () => {
    r = renderComponent(<Probe />)
    await settle()
    expect(r.container.querySelector('[data-testid="server-health-banner"]')).toBeNull()
  })
})
