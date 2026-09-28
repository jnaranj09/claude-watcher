// The hook-server banner's copy (UX-05). `starting` and `ok` say nothing: the bind takes
// milliseconds, and a healthy listener needs no line.

import type { ServerHealth } from '../../../shared/ipc/contract'

export function serverHealthMessage(health: ServerHealth | null): string | null {
  if (health === null) return null
  switch (health.hooks) {
    case 'port_in_use':
      return `Session status is off: port ${health.hookPort} is used by another program. New sessions start without status updates. Close that program, then restart Claude Watcher.`
    case 'server_error':
      return 'Session status is off: the status listener could not start. New sessions start without status updates. Restart Claude Watcher.'
    case 'hooks_file_failed':
      return 'Session status is off for new sessions: Claude Watcher could not write its hook settings file in its data folder.'
    case 'starting':
    case 'ok':
      return null
  }
}
