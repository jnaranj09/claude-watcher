// Every e2e app opens on a hidden display (tests/headless/headlessDisplay.mjs), never on the
// desktop. The runner's env is changed BEFORE the workers start, so each spec's
// `env: { ...process.env }` launch inherits it. The returned function is the teardown.
import { startHeadlessDisplay } from '../headless/headlessDisplay.mjs'

export default async function globalSetup(): Promise<() => void> {
  const display = await startHeadlessDisplay()
  const env = display.env(process.env)
  if (!('DISPLAY' in env)) delete process.env.DISPLAY
  if (env.WAYLAND_DISPLAY !== undefined) process.env.WAYLAND_DISPLAY = env.WAYLAND_DISPLAY
  return display.stop
}
