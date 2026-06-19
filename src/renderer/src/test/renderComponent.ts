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

/** Dispatch a native event inside `act` so React state settles before asserting. */
export function fireEvent(target: Element | Window | Document, event: Event): void {
  act(() => {
    target.dispatchEvent(event)
  })
}
