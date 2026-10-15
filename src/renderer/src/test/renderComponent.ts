// Story 1.3 — a minimal jsdom render harness for component tests (Task 8).
//
// React Testing Library is NOT installed (verified in package.json). Per the story
// we chose the lightweight path: render via `react-dom/client` + React's `act` —
// NO new dependency (jsdom + react-dom are already devDeps). This keeps the test
// surface tiny and avoids pulling RTL just for a handful of presentational
// components.
//
// Usage:
//   const { container, unmount } = renderComponent(<StatusDot status="working" />)
//   ...assert against container...
//   unmount()
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'

export interface RenderResult {
  container: HTMLElement
  root: Root
  unmount: () => void
}

/** Synchronously render a React element into a detached jsdom container. */
export function renderComponent(element: ReactElement): RenderResult {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  const unmount = (): void => {
    act(() => {
      root.unmount()
    })
    container.remove()
  }
  return { container, root, unmount }
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
