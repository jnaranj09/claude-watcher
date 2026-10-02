import { CH } from '../../shared/ipc/contract'
import { LaunchCorrelatedSchema } from '../../shared/schemas/launch'

// Push an exact terminalId ↔ sessionId binding to a window (the Starting-banner join). Validated
// AT SOURCE before send (main→renderer delta; zod-boundaries.md), PATH + CODE only on a miss
// (Guardrail #6). The renderer's boardStore.addCorrelation is idempotent, so a repeat push for an
// unchanged pair is free. Two call sites: the spawn-time mint (Story 6.2) and the session-rebind
// adoption (a live terminal re-pointed at claude's new session id).
export function sendLaunchCorrelated(
  wc: Electron.WebContents,
  terminalId: string,
  sessionId: string
): void {
  const r = LaunchCorrelatedSchema.safeParse({ terminalId, sessionId })
  if (!r.success) {
    const issue = r.error.issues[0]
    console.error(
      `[c9watch][launch] dropped launch:correlated path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
    )
    return
  }
  if (!wc.isDestroyed()) wc.send(CH.launchCorrelated, r.data)
}
