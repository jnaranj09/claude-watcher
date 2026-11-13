// The terms recall looks for in a prompt (phase 3 addendum §6). A term run and an exact term come
// from `exactTerms.ts`, the one owner the candidate check shares; recall adds lower case, a
// length floor and stop words. Pure: a prompt's text and its terms are sensitive, nothing here
// logs.
import { MEMORY_LIMITS } from '../../shared/schemas/memory'
import { isExactTerm, termRuns } from './exactTerms'

export interface RecallTerm {
  term: string
  exact: boolean
}

/** A term shorter than this says too little to recall by. */
const TERM_MIN = 3
const STOP_WORDS: ReadonlySet<string> = new Set(
  (
    'and are but can did does for from had has have how into its not our out that the their them ' +
    'then there these they this was were what when where which who why will with you your'
  ).split(' ')
)

/** The distinct lower-cased terms of `text`, exact ones first, then in order of first
 *  appearance; at most `max`. */
export function recallTerms(text: string, max: number = MEMORY_LIMITS.recallTerms): RecallTerm[] {
  const seen = new Set<string>()
  const terms: RecallTerm[] = []
  for (const run of termRuns(text)) {
    const term = run.toLowerCase()
    if ([...term].length < TERM_MIN || STOP_WORDS.has(term) || seen.has(term)) continue
    seen.add(term)
    terms.push({ term, exact: isExactTerm(term) })
  }
  return [...terms.filter((t) => t.exact), ...terms.filter((t) => !t.exact)].slice(0, max)
}
