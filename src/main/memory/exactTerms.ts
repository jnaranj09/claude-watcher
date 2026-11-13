// What a term and an exact term are (phase 3 addendum §6): one owner for the candidate check
// (P3-C6: a fact update must bring a new exact value) and recall ranking. Pure.

/** A run of letters, digits and `_`, then any of those or `.`, `:`, `/`, `-`. */
const TERM_RUN = /[\p{L}\p{N}_][\p{L}\p{N}_.:/-]*/gu
const TRAILING = /[.:/-]+$/u
const EXACT_MARK = /[\p{Nd}_/.]/u

/** Every term run of `text`, trailing `.`, `:`, `/` and `-` stripped, in order, case kept. */
export function termRuns(text: string): string[] {
  return Array.from(text.matchAll(TERM_RUN), (m) => m[0].replace(TRAILING, ''))
}

/** An exact term: at least 4 characters and holds a digit, `_`, `/` or `.` (`9281`, `v2.1.304`,
 *  `err_conn`, `src/main/index.ts`). */
export function isExactTerm(term: string): boolean {
  return [...term].length >= 4 && EXACT_MARK.test(term)
}
