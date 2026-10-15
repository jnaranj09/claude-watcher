// AttentionRail — the rail's remembered choices (owner, 2026-10-15): "Show all tags" per workspace
// and the collapsed rail, both saved in settings so they survive a restart. jsdom `unit` project.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetRailStores } from '../../test/railHarness'
import { stubSettings } from '../../test/settingsBridge'
import { AttentionRail } from './AttentionRail'
import { boardStore } from '../../stores/boardStore'
import { tagsStore } from '../../stores/tagsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { settingsStore } from '../../stores/settingsStore'
import { toastStore } from '../../stores/toastStore'
import { DEFAULT_SETTINGS } from '../../../../shared/schemas/settings'
import type { Tag } from '../../../../shared/ipc/contract'
import { watchUpdated } from '../../../../__fixtures__/watchEvents'

const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }

beforeEach(() => {
  resetRailStores()
  toastStore.setState({ toasts: [] })
  act(() => {
    tagsStore.getState().hydrate([PROD])
    boardStore
      .getState()
      .applyWatchEvent(watchUpdated(1, 'tagged', 'working', 10, { tagIds: ['t-prod'] }))
  })
})

// No RTL auto-cleanup in this project (test/setup.ts): unmount what each test rendered.
let rendered: RenderResult | undefined
afterEach(() => {
  rendered?.unmount()
  rendered = undefined
})

function renderRail(): void {
  rendered = render(<AttentionRail onActivateSession={() => {}} />)
}

const showTags = (): HTMLElement => screen.getByRole('button', { name: 'Show all tags' })

describe('AttentionRail — Show all tags is remembered per workspace', () => {
  it('opens on the saved choice of the active workspace', () => {
    settingsStore
      .getState()
      .hydrate({ ...DEFAULT_SETTINGS, showAllTagsByWorkspace: { default: true } })
    renderRail()
    expect(showTags()).toHaveAttribute('aria-pressed', 'true')
  })

  it('turning it on saves it for the active workspace only', async () => {
    const { setCalls } = stubSettings()
    renderRail()
    await userEvent.click(showTags())
    expect(setCalls).toEqual([{ showAllTagsByWorkspace: { default: true } }])
    expect(showTags()).toHaveAttribute('aria-pressed', 'true')
    act(() => workspacesStore.setState({ activeId: 'ws-other' }))
    expect(showTags()).toHaveAttribute('aria-pressed', 'false')
  })

  it('a refused save rolls the toggle back and says so', async () => {
    stubSettings(() => Promise.reject(new Error('disk full')))
    renderRail()
    await userEvent.click(showTags())
    expect(showTags()).toHaveAttribute('aria-pressed', 'false')
    expect(toastStore.getState().toasts.map((t) => t.title)).toEqual([
      'Could not save the Show all tags choice.'
    ])
  })
})

describe('AttentionRail — the collapsed rail is remembered', () => {
  it('opens collapsed when the saved choice says so', () => {
    settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, railCollapsed: true })
    renderRail()
    expect(screen.getByRole('button', { name: 'Expand sessions rail' })).toBeInTheDocument()
  })

  it('collapsing saves the choice', async () => {
    const { setCalls } = stubSettings()
    renderRail()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sessions rail' }))
    expect(setCalls).toEqual([{ railCollapsed: true }])
    expect(screen.getByRole('button', { name: 'Expand sessions rail' })).toBeInTheDocument()
  })
})
