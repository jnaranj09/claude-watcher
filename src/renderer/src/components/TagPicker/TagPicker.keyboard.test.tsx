// TagPicker from the keyboard (slice 2 review, round 1): the list is portaled to document.body, so
// Tab from its button no longer reaches it by DOM order. Opening it moves focus to its first row,
// as Select's list does (with no row, to the list itself); Escape, or Tab past either end, closes
// it and hands focus back to the button. Also pins the list's rung above a dialog (ManageDialog is 60).
import { afterEach, describe, it, expect, vi } from 'vitest'
import { useRef, useState, type JSX } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagPicker } from './TagPicker'
import { Presence } from '../Presence/Presence'
import { cssRule } from '../../test/cssRule'
import type { Tag } from '../../../../shared/ipc/contract'

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
})

const DEPLOY: Tag = { id: 't-deploy', name: 'deploy', color: 'amber', workspaceId: null }
const PROD: Tag = { id: 't-prod', name: 'prod', color: 'rose', workspaceId: null }

/** A trigger and its picker, as a caller wires them, then a button after the anchor; all inside
 *  an outer key handler that stands for the dialog's (ManageDialog closes on Escape). */
function Harness({
  onClose,
  tags = [DEPLOY, PROD],
  onOuterKey = vi.fn()
}: {
  onClose: (reason: 'escape' | 'outside') => void
  tags?: Tag[]
  onOuterKey?: (key: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  return (
    <div onKeyDown={(e) => onOuterKey(e.key)}>
      <div ref={anchorRef}>
        <button type="button" ref={triggerRef} onClick={() => setOpen((v) => !v)}>
          Tags
        </button>
        <Presence value={open || null}>
          {() => (
            <TagPicker
              tags={tags}
              selectedIds={[]}
              onChange={vi.fn()}
              onClose={(reason) => {
                setOpen(false)
                onClose(reason)
              }}
              anchorRef={anchorRef}
              triggerRef={triggerRef}
              testId="picker"
              label="Tags for api"
            />
          )}
        </Presence>
      </div>
      <button type="button">after</button>
    </div>
  )
}

async function openPicker(
  props: { tags?: Tag[]; onOuterKey?: (key: string) => void } = {}
): Promise<ReturnType<typeof vi.fn>> {
  const onClose = vi.fn()
  unmount = render(<Harness onClose={onClose} {...props} />).unmount
  await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
  await screen.findByRole('group', { name: 'Tags for api' })
  return onClose
}

describe('TagPicker — keyboard', () => {
  it('opening the list moves focus to its first row, and Tab walks its rows', async () => {
    await openPicker()
    expect(screen.getByTestId('picker-row-t-deploy')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByTestId('picker-row-t-prod')).toHaveFocus()
  })

  it('Escape closes the list and hands focus back to its button', async () => {
    const onClose = await openPicker()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveFocus()
  })

  it('Tab past the last row closes the list and continues from its button', async () => {
    const onClose = await openPicker()
    await userEvent.tab()
    await userEvent.tab()
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
  })

  it('with no tags, the list takes focus and Escape closes the list only, back to its button', async () => {
    const onOuterKey = vi.fn()
    const onClose = await openPicker({ tags: [], onOuterKey })
    expect(screen.getByRole('group', { name: 'Tags for api' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(onOuterKey).not.toHaveBeenCalledWith('Escape')
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveFocus()
  })

  it('with no tags, Tab closes the list and hands focus back to its button', async () => {
    const onClose = await openPicker({ tags: [] })
    await userEvent.tab()
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveFocus()
  })

  it('Shift+Tab before the first row closes the list and hands focus back to its button', async () => {
    const onClose = await openPicker()
    await userEvent.tab({ shift: true })
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveFocus()
  })
})

describe('TagPicker — stacking', () => {
  // A portaled list sits in document.body's stacking order: under ManageDialog (60) it is
  // unusable in the Memory form. Same rung as Select's list, under toasts (70).
  it('the portaled list paints above a dialog and under toasts', () => {
    const anchored = cssRule('components/TagMenu/TagMenu.module.css', '.anchored')
    expect(anchored).toMatch(/position:\s*fixed;/)
    expect(anchored).toMatch(/z-index:\s*65;/)
  })
})
