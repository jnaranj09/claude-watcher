// Name-sync — the READ-BACK decision: should this hook event rename the board card?
//
// Claude is the authority on its own name. The app asks for a name (`-n` at launch, a
// `sessionTitle` in the hook response for a rename), but what claude ACTUALLY ends up
// called can differ, and the app never sees why:
//   - a live-name collision makes claude keep the name with the older session and suffix
//     ours (`api` → `api-graceful-unicorn`);
//   - the operator types `/rename` straight into the terminal;
//   - accepting a plan retitles the session.
// Every one of those arrives back as `session_title` on the next `UserPromptSubmit`. Trusting
// that field is what makes the board show the name claude really has, rather than the name we
// hoped for — and it collapses three special cases into one rule.
//
// Extracted from index.ts deliberately: nothing can import index.ts, so logic inlined there is
// unfalsifiable — reverting it would leave the suite green. That is a defect class this repo
// has hit before (see spec-session-naming.md's KEEP note).
//
// PURE: no I/O, no logging. The inputs are SENSITIVE (a session name is operator content) —
// callers must never log either name. [spec-claude-session-name-sync.md]

/** The fields of a validated hook event this decision reads. Structural, so callers can pass
 *  a full `HookEvent` without this module depending on the schema. */
export interface TitleReadBackInput {
  /** Claude's own current name for the session. Verified to ride `UserPromptSubmit` ONLY —
   *  absent on `Stop`/`SessionEnd`, hence optional. */
  session_title?: string | undefined
}

/**
 * Decide the name the card should take, or `null` to leave it alone.
 *
 * Returns `null` — meaning DO NOTHING — when:
 *  - a push is PENDING for this session (`pushPending`) — see below;
 *  - the event carries no `session_title` (every event that is not `UserPromptSubmit`);
 *  - the title is blank (never blank out a card's name);
 *  - there is no such card (`currentName` undefined — a hook racing a stop/exit, or an
 *    external session that must stay off the board);
 *  - the name already matches.
 *
 * That last case is the load-bearing one: `reducer.renameSession` emits a `session.updated`
 * UNCONDITIONALLY — it does not skip an unchanged name — so without this compare every single
 * prompt submit would ship a redundant delta to the renderer, forever.
 */
export function titleReadBackRename(
  evt: TitleReadBackInput,
  currentName: string | undefined,
  pushPending: boolean
): string | null {
  // THE RACE THIS GUARD EXISTS FOR (observed in the app, 2026-08-25):
  // a rename is pushed by ANSWERING a UserPromptSubmit POST. Claude builds that payload
  // BEFORE it reads our response, so `session_title` on the very event that carries the push
  // still holds claude's OLD name. Without this check the read-back reverts the card to the
  // name the operator just changed away from, and the board visibly snaps back one prompt
  // after the rename — while claude, having applied the push, moves to the NEW name. The two
  // ended up swapped. While a push is pending, OUR name is the intended truth; claude's
  // reported name only becomes authoritative once the push has landed (the next prompt).
  if (pushPending) return null

  const claudeTitle = evt.session_title
  if (claudeTitle === undefined || claudeTitle.length === 0) return null
  if (currentName === undefined) return null
  if (currentName === claudeTitle) return null
  return claudeTitle
}
