// Overlay motion — <Presence> keeps the last payload while leaving and tells the subtree.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, type JSX } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { pointerInput } from '../../test/pointerInput'
import { MOTION_EXIT_MS } from '../../styles/motion'
import { Presence } from './Presence'
import { leavingProps, useLeaving } from './leaving'

function Leaf({ name }: { name: string }): JSX.Element {
  const leaving = useLeaving()
  return (
    <div data-testid="leaf" {...leavingProps(leaving)}>
      {name}
    </div>
  )
}
const tree = (payload: { name: string } | null): JSX.Element => (
  <Presence value={payload}>{(p) => <Leaf name={p.name} />}</Presence>
)

let r: RenderResult | undefined
let clearInput: (() => void) | undefined
const leaf = (): HTMLElement | null =>
  r?.container.querySelector<HTMLElement>('[data-testid="leaf"]') ?? null

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  r?.unmount()
  r = undefined
  clearInput?.()
  clearInput = undefined
  vi.useRealTimers()
})

describe('<Presence>', () => {
  it('renders nothing for null', () => {
    r = renderComponent(tree(null))
    expect(leaf()).toBeNull()
  })
  it('keeps the LAST payload while leaving, marks it data-leaving + inert, then unmounts', () => {
    clearInput = pointerInput()
    r = renderComponent(tree({ name: 'api' }))
    expect(leaf()?.hasAttribute('data-leaving')).toBe(false)
    expect(leaf()?.hasAttribute('inert')).toBe(false)
    act(() => {
      r?.root.render(tree(null))
    })
    expect(leaf()?.textContent).toBe('api')
    expect(leaf()?.hasAttribute('data-leaving')).toBe(true)
    expect(leaf()?.hasAttribute('inert')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS)
    })
    expect(leaf()).toBeNull()
  })
})
