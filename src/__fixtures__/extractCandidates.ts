// Synthetic candidates and cleaned entries for the candidate check's tests (two test files share
// them). Never shipped.
import type { ExtractCandidate } from '../shared/schemas/memoryExtract'
import { checkCandidates, type Basis, type Checked } from '../main/memory/extract/checkCandidates'
import type { CleanEntry } from '../main/memory/extract/sliceCleaner'

export const entry = (
  n: number,
  kind: CleanEntry['kind'],
  text: string,
  over: Partial<CleanEntry> = {}
): CleanEntry => ({
  n,
  kind,
  tool: kind === 'tool' || kind === 'result' ? 'Bash' : null,
  status: kind === 'result' ? 'ok' : null,
  text,
  entryId: `e-${n}`,
  lineEnd: n * 10,
  evidence: true,
  ...over
})

export const ENTRIES: CleanEntry[] = [
  entry(1, 'operator', 'Which port does the API use?'),
  entry(2, 'tool', '{"command":"ss -ltn"}'),
  entry(3, 'result', 'api listening on http://127.0.0.1:9281')
]

export const cand = (over: Partial<ExtractCandidate>): ExtractCandidate => ({
  type: 'specific',
  action: 'add',
  id: null,
  head: 'API port',
  body: '9281',
  check: null,
  leftWith: null,
  evidence: 'api listening on http://127.0.0.1:9281',
  ...over
})
export const specific = (head: string, value: string, evidence: string): ExtractCandidate =>
  cand({ head, body: value, evidence })
export const fact = (head: string, body: string, evidence: string): ExtractCandidate =>
  cand({ type: 'fact', head, body, evidence })
export const task = (
  head: string,
  evidence: string,
  over: Partial<ExtractCandidate> = {}
): ExtractCandidate =>
  cand({ type: 'task', head, body: null, leftWith: 'operator', evidence, ...over })
export const episode = (head: string, body: string, evidence: string): ExtractCandidate =>
  cand({ type: 'episode', head, body, evidence })

type Ctx = Parameters<typeof checkCandidates>[1]
export const check = (
  candidates: ExtractCandidate[],
  ctx: Partial<Ctx> = {}
): ReturnType<typeof checkCandidates> =>
  checkCandidates(
    { candidates, note: '' },
    {
      entries: ENTRIES,
      notes: [],
      final: false,
      tasksOn: true,
      items: [],
      tasks: [],
      operatorWrote: () => false,
      ...ctx
    }
  )

export const NOTE = 'Moved the API to port 9281 and updated the docs.'
export const RESULT_QUOTE = { entryId: 'e-3', quote: 'api listening on http://127.0.0.1:9281' }
export const portItem = (basis: Basis): Extract<Checked, { kind: 'item' }> => ({
  kind: 'item',
  action: 'add',
  id: null,
  text: { kind: 'specific', key: 'API port', value: '9281' },
  check: null,
  basis,
  source: RESULT_QUOTE
})
