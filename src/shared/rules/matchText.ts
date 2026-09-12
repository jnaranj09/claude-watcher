// Rules — the folder / name conditions' text match, shared by main's rule checks and the engine.
// `contains` is case-insensitive; `regex` is used exactly as written (spec §1.2). A pattern that
// does not compile NEVER matches and never throws: the rule is inert and reported broken (T-23).
//
// Accepted risk (spec §5): a pathological regex can backtrack. Patterns are ≤ 200 chars and are
// only ever tested against short strings (a session name ≤ 60, a folder path).

export interface TextMatch {
  mode: 'contains' | 'regex'
  pattern: string
}

function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

/** True when a `regex` pattern compiles. A `contains` pattern always does. */
export function patternCompiles(match: TextMatch): boolean {
  return match.mode === 'contains' || compile(match.pattern) !== null
}

export function textMatches(match: TextMatch, text: string): boolean {
  if (match.mode === 'contains') {
    return text.toLocaleLowerCase().includes(match.pattern.toLocaleLowerCase())
  }
  const re = compile(match.pattern)
  return re !== null && re.test(text)
}
