// The filter bar's "why is this empty" sentence, shared by the empty board (`.`) and an empty
// column (` here.`), so the two always name the same cause. design.md: three nothings, three
// answers — a board emptied by the search or the tag filter must never read like an empty one.

/** `No sessions tagged prod match “dep”` — names what hides the cards: the tag, the search, or
 *  both. `query` is the search text as typed; it is trimmed here. Ends WITHOUT punctuation. */
export function hiddenByFilterSentence(tagName: string | null, query: string): string {
  const q = query.trim()
  const tagged = tagName !== null ? ` tagged ${tagName}` : ''
  return q === '' ? `No sessions${tagged}` : `No sessions${tagged} match “${q}”`
}

/** How to get every card back, naming each control that is hiding some. */
export function clearFilterHint(tagOn: boolean, query: string): string {
  const searching = query.trim() !== ''
  if (searching && tagOn) return 'Clear the search or remove the tag filter to see every session.'
  if (searching) return 'Clear the search to see every session.'
  return 'Remove the tag filter to see every session.'
}
