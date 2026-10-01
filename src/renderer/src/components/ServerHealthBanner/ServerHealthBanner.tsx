// The hook-server banner (UX-05). While the hook ingest is down every card stays in Connecting /
// idle, and nothing alerts: no needs-you, no badge, no reminder, no rule. Before this banner that
// was silent. It sits under the header, on every view, until main reports the listener healthy.
//
// Main decides the state; the copy lives in lib/serverHealthCopy.ts.

import type { JSX } from 'react'
import type { ServerHealth } from '../../../../shared/ipc/contract'
import { serverHealthMessage } from '../../lib/serverHealthCopy'
import { Callout } from '../Callout/Callout'
import styles from './ServerHealthBanner.module.css'

export function ServerHealthBanner({
  health
}: {
  health: ServerHealth | null
}): JSX.Element | null {
  const message = serverHealthMessage(health)
  if (message === null) return null
  return (
    <div className={styles.slot}>
      <Callout tone="danger" title={message} testId="server-health-banner" />
    </div>
  )
}
