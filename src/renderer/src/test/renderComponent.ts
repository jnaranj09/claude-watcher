// The renderer test render harness. `renderComponent` is a thin wrapper over React Testing
// Library's `render` (spec 2026-10-15 testing standards), so there is one way to render. New
// tests use RTL directly (`render`, `screen`, `userEvent`; `.claude/rules/testing.md`); this
// wrapper keeps the old `container`-based callers working while the lint budget drains them.
//
// Usage:
//   const { container, unmount } = renderComponent(<StatusDot status="working" />)
//   ...assert against container...
//   unmount()
import { act } from 'react'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

export interface RenderResult {
  container: HTMLElement
  /** `render` re-renders in place (RTL `rerender`); `unmount` unmounts. */
  root: Pick<Root, 'render' | 'unmount'>
  unmount: () => void
}

/** Synchronously render a React element into a container attached to `document.body`. */
export function renderComponent(element: ReactElement): RenderResult {
  const r = render(element)
  const unmount = (): void => {
    r.unmount()
    r.container.remove()
  }
  return { container: r.container, root: { render: r.rerender, unmount: r.unmount }, unmount }
}
const rendered = new Set<() => void>()

/** `renderComponent`, plus `unmountRendered()` (call it in afterEach) unmounts it — unless the test
 *  already did: the returned `unmount` runs once, whoever calls it first. */
export function renderTracked(element: ReactElement): RenderResult {
  const r = renderComponent(element)
  let mounted = true
  const unmount = (): void => {
    if (!mounted) return
    mounted = false
    rendered.delete(unmount)
    r.unmount()
  }
  rendered.add(unmount)
  return { ...r, unmount }
}

/** afterEach: unmount everything `renderTracked` rendered that is still mounted. */
export function unmountRendered(): void {
  for (const unmount of [...rendered]) unmount()
}

/** Dispatch a native event inside `act` so React state settles before asserting. */
export function fireEvent(target: Element | Window | Document, event: Event): void {
  act(() => {
    target.dispatchEvent(event)
  })
}

/** Let `microtasks` turns of the microtask queue run inside `act`, so promise-driven effects
 *  settle before the test asserts. */
export async function flush(microtasks = 2): Promise<void> {
  await act(async () => {
    for (let i = 0; i < microtasks; i++) await Promise.resolve()
  })
}

/** The one element under `r` matching `sel`; throws when there is none, so a typo cannot pass. */
export function q<T extends Element = HTMLElement>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

/** Click `el` inside `act`. */
export function click(el: Element): void {
  act(() => (el as HTMLElement).click())
}
