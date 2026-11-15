// The rail peek's `+ tag` from the keyboard (slice 2 review, round 1): the tag list is portaled,
// so it takes focus when it opens; Escape hands focus back to `+ tag`.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetRailStores } from '../../test/railHarness'
import { AttentionRail } from './AttentionRail'
import { boardStore } from '../../stores/boardStore'
import { tagsStore } from '../../stores/tagsStore'
import type { Tag } from '../../../../shared/ipc/contract'
import { watchUpdated } from '../../../../__fixtures__/watchEvents'

const DEPLOY: Tag = { id: 't-deploy', name: 'deploy', color: 'amber', workspaceId: null }
const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }

beforeEach(() => {
  resetRailStores()
  act(() => {
    tagsStore.getState().hydrate([DEPLOY, PROD])
    boardStore
      .getState()
      .applyWatchEvent(watchUpdated(1, 'tagged', 'working', 10, { tagIds: ['t-prod'] }))
  })
})
let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
})

describe('AttentionRail — + tag from the keyboard', () => {
  it('the list takes focus on open, and Escape returns to + tag', async () => {
    const onSetSessionTags = vi.fn()
    unmount = render(
      <AttentionRail onActivateSession={() => {}} onSetSessionTags={onSetSessionTags} />
    ).unmount
    await userEvent.click(screen.getByTestId('rail-tags-peek'))
    const add = screen.getByTestId('rail-tags-add')
    await userEvent.click(add)
    expect(screen.getByTestId('rail-tag-picker-row-t-deploy')).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(onSetSessionTags).toHaveBeenCalledWith('tagged', ['t-deploy', 't-prod'])
    await userEvent.keyboard('{Escape}')
    expect(add).toHaveFocus()
  })
})
