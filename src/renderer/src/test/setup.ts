// Setup for the jsdom `unit` project: registers the jest-dom matchers (`toHaveAttribute`,
// `toBeVisible`, …) on Vitest's `expect`. No RTL `cleanup` here: tests unmount what they render
// (`renderTracked` + `unmountRendered`, or the `unmount` they get back).
import '@testing-library/jest-dom/vitest'
