// Tags — the pure scope rules, shared by main (the move drop, catalog pruning, the set-tags check)
// and the renderer (the picker, the filter). One definition, so the two sides cannot disagree about
// which tags a card may carry.
import type { Tag } from '../schemas/tag'

/** T-11 — a card in `workspaceId` may carry a tag that is global or scoped to that exact
 *  workspace. A tag naming a workspace that no longer exists is visible NOWHERE.
 *
 *  `workspaceId` accepts `null` too (widened for `rules/ruleRefs.ts#inRuleScope`): a RULE, unlike
 *  a card, can itself be global, and the same comparison holds — a global viewer sees only a
 *  global item. Every existing caller here passes a concrete workspace, so this is additive. */
export function isTagVisibleIn(tag: Pick<Tag, 'workspaceId'>, workspaceId: string | null): boolean {
  return tag.workspaceId === null || tag.workspaceId === workspaceId
}

/** The tags a card in `workspaceId` may carry, in the order given (tag-list order). */
export function visibleTags<T extends Pick<Tag, 'workspaceId'>>(
  tags: readonly T[],
  workspaceId: string
): T[] {
  return tags.filter((t) => isTagVisibleIn(t, workspaceId))
}

/**
 * The tag ids a card in `workspaceId` keeps: every id still in the catalog AND visible there, in
 * the card's own order. Serves both T-9 (moving A → B drops A's own tags; global tags travel) and
 * catalog pruning (a deleted or re-scoped tag leaves the cards that can no longer see it).
 */
export function keepVisibleTags(
  tagIds: readonly string[],
  workspaceId: string,
  lookup: (id: string) => Pick<Tag, 'workspaceId'> | null
): string[] {
  return tagIds.filter((id) => {
    const tag = lookup(id)
    return tag !== null && isTagVisibleIn(tag, workspaceId)
  })
}

/** A card's tags are a SET: order carries no meaning (chips render in tag-list order). Inputs are
 *  duplicate-free (SessionSetTagsSchema and the reducer never store a duplicate). */
export function sameTagSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

/**
 * T-9 — the subset of `tags` a move TO `toWorkspaceId` costs: whichever ones are not visible
 * there afterward (the complement of `visibleTags`). `keepVisibleTags` above is what main
 * actually APPLIES on a move (it keeps the survivors); this is the same rule read the other way,
 * for a caller that wants to say what is LOST rather than filter a stored id list — today, the
 * card's move-menu warning (T-9, SessionCard.tsx). Sharing `isTagVisibleIn` here (not a bare
 * `tag.workspaceId === fromWorkspaceId` comparison) is what keeps the warning's count honest if a
 * tag is ever visible in more than just its own workspace + global.
 */
export function tagsDroppedByMove<T extends Pick<Tag, 'workspaceId'>>(
  tags: readonly T[],
  toWorkspaceId: string
): T[] {
  return tags.filter((t) => !isTagVisibleIn(t, toWorkspaceId))
}
