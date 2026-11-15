// A card's `Tags…` from the keyboard (slice 2 review, round 1): the tag list is portaled, so it
// takes focus when it opens; Escape hands focus back to the card's tags button.
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionCard } from './SessionCard'
import type { Tag } from '../../../../shared/ipc/contract'

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
})

const OPS: Tag = { id: 't-ops', name: 'ops', color: 'blue', workspaceId: null }
const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }

describe('SessionCard — Tags… from the keyboard', () => {
  it('the list takes focus on open, Space ticks a tag, Escape returns to the button', async () => {
    const onSetTags = vi.fn()
    const onActivate = vi.fn()
    unmount = render(
      <SessionCard
        variant="hero"
        sessionName="deploy-prod"
        projectPath="/work/acme/api"
        status="needs-you"
        accent="needs-you"
        pid={4242}
        availableTags={[OPS, PROD]}
        tags={[PROD]}
        onSetTags={onSetTags}
        onActivate={onActivate}
      />
    ).unmount
    const button = screen.getByTestId('card-tags-button')
    await userEvent.click(button)
    expect(screen.getByTestId('card-tag-picker-row-t-ops')).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(onSetTags).toHaveBeenCalledWith(['t-ops', 't-prod'])
    await userEvent.keyboard('{Escape}')
    expect(button).toHaveFocus()
    expect(screen.queryByTestId('card-tag-picker')).not.toBeInTheDocument()
    expect(onActivate).not.toHaveBeenCalled()
  })
})
