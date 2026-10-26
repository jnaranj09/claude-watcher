// Setup for the jsdom `unit` project: registers the jest-dom matchers (`toHaveAttribute`,
// `toBeVisible`, …) on Vitest's `expect`, and empties the toast singleton before every
// test. No RTL `cleanup` here: tests unmount what they render (`renderTracked` +
// `unmountRendered`, or the `unmount` they get back).
import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import { toastStore } from '../stores/toastStore'

beforeEach(() => {
  toastStore.setState({ toasts: [] })
})
