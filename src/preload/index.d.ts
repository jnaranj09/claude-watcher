import type { PtyApi } from './index'

declare global {
  interface Window {
    pty: PtyApi
  }
}
