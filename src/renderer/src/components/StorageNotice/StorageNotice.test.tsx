// UX-06 / UX-07 — the notice is the ONLY sign that a store started empty or a change was not kept.
// These pin that it draws every problem as copy (never a code), that dismiss hides only what was
// seen, and that a later problem brings it back.

import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import {
  STORAGE_PROBLEM_CODES,
  STORE_NAMES,
  type StorageHealth
} from '../../../../shared/schemas/storageHealth'
import { StorageNotice } from './StorageNotice'
import { storageProblemMessage } from '../../lib/storageHealthCopy'
import { useStorageHealth } from '../../hooks/useStorageHealth'

let r: RenderResult | undefined
afterEach(() => {
  r?.unmount()
  r = undefined
  delete (window as unknown as { storageHealth?: unknown }).storageHealth
})

const notice = (): Element | null =>
  r?.container.querySelector('[data-testid="storage-notice"]') ?? null

describe('storageProblemMessage', () => {
  it('has copy for every store and code, and never shows the raw code', () => {
    for (const store of STORE_NAMES) {
      for (const code of STORAGE_PROBLEM_CODES) {
        const text = storageProblemMessage({ store, code })
        expect(text.length).toBeGreaterThan(20)
        expect(text).not.toContain(code)
      }
    }
  })

  it('names the store in plain words', () => {
    expect(storageProblemMessage({ store: 'past_sessions', code: 'corrupt_reset' })).toContain(
      'past sessions started empty'
    )
  })
})

function Probe(): React.JSX.Element | null {
  return <StorageNotice health={useStorageHealth()} />
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('StorageNotice + useStorageHealth', () => {
  it('draws nothing while there is no problem', async () => {
    ;(window as unknown as { storageHealth: unknown }).storageHealth = {
      get: () => Promise.resolve({ problems: [] }),
      onChanged: () => () => {}
    }
    r = renderComponent(<Probe />)
    await settle()
    expect(notice()).toBeNull()
  })

  it('draws the load problems from the first answer, one line each', async () => {
    const first: StorageHealth = {
      problems: [
        { store: 'templates', code: 'corrupt_reset' },
        { store: 'settings', code: 'write_failed' }
      ]
    }
    ;(window as unknown as { storageHealth: unknown }).storageHealth = {
      get: () => Promise.resolve(first),
      onChanged: () => () => {}
    }
    r = renderComponent(<Probe />)
    await settle()
    expect(notice()?.getAttribute('role')).toBe('alert')
    expect(notice()?.querySelectorAll('li')).toHaveLength(2)
  })

  it('dismiss hides what was seen; a NEW problem brings the notice back', async () => {
    let push: ((h: StorageHealth) => void) | null = null
    const one: StorageHealth = { problems: [{ store: 'tags', code: 'corrupt_reset' }] }
    ;(window as unknown as { storageHealth: unknown }).storageHealth = {
      get: () => Promise.resolve(one),
      onChanged: (cb: (h: StorageHealth) => void) => {
        push = cb
        return () => {}
      }
    }
    r = renderComponent(<Probe />)
    await settle()
    act(() =>
      (r?.container.querySelector('[data-testid="storage-notice-dismiss"]') as HTMLElement).click()
    )
    expect(notice()).toBeNull()
    act(() => push?.({ problems: [...one.problems, { store: 'rules', code: 'write_failed' }] }))
    expect(notice()).not.toBeNull()
  })

  it('no bridge (a unit test without the stub) is no notice, never a crash', async () => {
    r = renderComponent(<Probe />)
    await settle()
    expect(notice()).toBeNull()
  })
})
