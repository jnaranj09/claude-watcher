// Rules — the LAUNCH rules, run at spawn (spec §2.1, T-21) just before `buildLaunchedSession`, so
// the card is born tagged: one delta, no flash of an untagged card. Deliberately NOT "the first time
// the tracker sees an id" — `/clear` re-upserts the card under a new id, and launch rules must not
// run again for it. Kept out of index.ts so the rule inputs are unit-tested.
import { basename } from 'node:path'
import { applyRules, type RulesSnapshot } from './evaluateRules'

export interface LaunchFacts {
  templateId: string | null
  displayName: string
  spawn: { cwd: string }
}

export function launchTags(
  snapshot: RulesSnapshot,
  minted: LaunchFacts,
  workspaceId: string
): string[] {
  return applyRules(
    snapshot,
    { kind: 'launched' },
    {
      workspaceId,
      tagIds: [],
      templateId: minted.templateId,
      projectPath: minted.spawn.cwd,
      // The same fallback the card title uses (launchSynthesis.ts), so a `name` condition matches
      // what the operator sees on the card.
      sessionName: minted.displayName || basename(minted.spawn.cwd)
    }
  )
}
