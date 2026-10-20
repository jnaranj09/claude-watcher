import { CH } from '../../shared/ipc/contract'
import { GoalsViewSchema, type GoalsView } from '../../shared/schemas/goal'

// Push the goals view to a window after any change (`goals:changed`). Validated AT SOURCE before
// send (main→renderer; zod-boundaries.md), PATH + CODE only on a miss (Guardrail #6) — a goal name
// or task title is operator text and never reaches a log. The renderer replaces its whole
// projection, so a repeat push is free.
export function sendGoalsChanged(wc: Electron.WebContents, view: GoalsView): void {
  const r = GoalsViewSchema.safeParse(view)
  if (!r.success) {
    const issue = r.error.issues[0]
    console.error(
      `[claude-watcher][goals] dropped goals:changed path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
    )
    return
  }
  if (!wc.isDestroyed()) wc.send(CH.goalsChanged, r.data)
}
