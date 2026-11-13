// Saving memory from a session (memory phase 2): the limits of one extraction job, the shape
// claude must answer in, and claude's own result line. The model's output and every text here
// are SENSITIVE like memory text: NEVER log them, issue path + code only.
import { z } from 'zod'
import { MEMORY_LIMITS } from './memory'

export const EXTRACT_LIMITS = {
  /** One operator or claude text: the first `textHeadChars` and the last `textTailChars`. */
  textChars: 4000,
  textHeadChars: 3000,
  textTailChars: 1000,
  toolArgsChars: 800,
  /** One tool result: the first `resultHeadChars` and the last `resultTailChars`. */
  resultChars: 1500,
  resultHeadChars: 1000,
  resultTailChars: 500,
  chunkChars: 100_000,
  chunksPerJob: 12,
  candidates: 12,
  outputStringChars: 4000,
  evidenceMin: 4,
  /** The stored source quote is the evidence: one owner, so a longer quote never fails `ItemRow`. */
  evidenceMax: MEMORY_LIMITS.sourceQuote,
  note: 500,
  notesKept: 20,
  scopeItems: 150,
  scopeTasks: 50,
  minPrompts: 2,
  timeoutMs: 120_000,
  killGraceMs: 5_000,
  stdoutBytes: 1_048_576,
  readBytesPerJob: 33_554_432,
  readStepBytes: 4_194_304,
  budgetUsd: 1,
  /** Failed calls in a row that give a chunk up. */
  attempts: 3,
  /** How long the extractor keeps a "claude too old" answer before it asks again (R31). */
  versionRecheckMs: 600_000,
  queue: 50,
  commandsPerWorkspace: 2000,
  tasksInIndex: 20,
  episodesInIndex: 5
} as const

/** Marks a text cut at its end. */
export const CUT_END = '… [cut]'
/** Marks a text cut in its middle (head and tail kept). */
export const CUT_MIDDLE = '\n… [cut] …\n'
/** Stands where a secret was taken out of a text. */
export const SECRET_MARK = '[secret removed]'
/** Stands for a tool result the cleaner does not keep. */
export const RESULT_NOT_KEPT = '(result not kept)'

export type ExtractCandidate = {
  type: 'specific' | 'fact' | 'task' | 'episode'
  action: 'add' | 'update' | 'none'
  id: string | null
  head: string
  body: string | null
  check: string | null
  leftWith: 'operator' | 'session' | null
  evidence: string
}
export type ExtractOutput = { candidates: ExtractCandidate[]; note: string }

const OutputString = z.string().max(EXTRACT_LIMITS.outputStringChars)

const CandidateSchema = z
  .object({
    type: z.enum(['specific', 'fact', 'task', 'episode']),
    action: z.enum(['add', 'update', 'none']),
    id: OutputString.nullable(),
    head: OutputString,
    body: OutputString.nullable(),
    check: OutputString.nullable(),
    leftWith: z.enum(['operator', 'session']).nullable(),
    evidence: OutputString
  })
  .strict()

/** Main's own boundary for the model's answer, stricter than what `EXTRACT_JSON_SCHEMA` tells
 *  claude: `.strict()` at both levels; candidates ≤ 12; every string ≤ 4,000; note trimmed and
 *  cut to 500. A failure drops the whole output. */
export const ExtractOutputSchema: z.ZodType<ExtractOutput> = z
  .object({
    candidates: z.array(CandidateSchema).max(EXTRACT_LIMITS.candidates),
    note: OutputString.transform((v) => v.trim().slice(0, EXTRACT_LIMITS.note))
  })
  .strict()

/** The JSON schema handed to claude (`--json-schema`), exact. Its candidate keys match
 *  `ExtractOutputSchema` (pinned by `memoryExtract.test.ts`). */
export const EXTRACT_JSON_SCHEMA =
  '{"type":"object","additionalProperties":false,"required":["candidates","note"],"properties":{"note":{"type":"string"},"candidates":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["type","action","id","head","body","check","leftWith","evidence"],"properties":{"type":{"type":"string","enum":["specific","fact","task","episode"]},"action":{"type":"string","enum":["add","update","none"]},"id":{"type":["string","null"]},"head":{"type":"string"},"body":{"type":["string","null"]},"check":{"type":["string","null"]},"leftWith":{"type":["string","null"],"enum":["operator","session",null]},"evidence":{"type":"string"}}}}}}'

/** claude's own result line (`--output-format json`): only the two keys main reads; claude's
 *  other keys pass. */
export const ClaudeResultSchema = z
  .object({
    is_error: z.boolean(),
    structured_output: z.unknown().optional()
  })
  .passthrough()
