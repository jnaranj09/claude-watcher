// The Bash commands that worked in a slice (addendum "Commands"), read from the raw lines with no
// model: a `Bash` call whose result is not an error and was not interrupted. A command that only
// started (`run_in_background`), spans lines, is empty, is over MEMORY_LIMITS.commandText or holds
// a secret is left out. The keys are `unknown` in the shared schema (D40) and narrowed here.
// SENSITIVE: command text is never logged; nothing here logs.
import { MEMORY_LIMITS } from '../../../shared/schemas/memory'
import { hasSecret } from './secretScan'
import type { ReadLine } from './transcriptReader'

type Call = { command: string; background: boolean }

/** The `input` of a Bash call, narrowed: its `command` string and whether it only started. */
function bashCall(input: unknown): Call | null {
  if (typeof input !== 'object' || input === null || !('command' in input)) return null
  if (typeof input.command !== 'string') return null
  const background = 'run_in_background' in input && input.run_in_background === true
  return { command: input.command, background }
}

/** `toolUseResult` is an object for a Bash that ran (`interrupted` in it), a string when it failed. */
function wasInterrupted(toolUseResult: unknown): boolean {
  return (
    typeof toolUseResult === 'object' &&
    toolUseResult !== null &&
    'interrupted' in toolUseResult &&
    toolUseResult.interrupted === true
  )
}

function keeps(call: Call): boolean {
  const text = call.command.trim()
  return (
    !call.background &&
    text !== '' &&
    !/[\r\n]/.test(text) &&
    text.length <= MEMORY_LIMITS.commandText &&
    !hasSecret(text)
  )
}

/** The Bash commands that worked, in order, repeats included (addendum "Commands"). `lineEnd` is the
 *  `end` of the RESULT's line, so a job can tell which chunk a command belongs to. */
export function captureCommands(lines: readonly ReadLine[]): { text: string; lineEnd: number }[] {
  const calls = new Map<string, Call>()
  const out: { text: string; lineEnd: number }[] = []
  for (const { entry, end } of lines) {
    const content = entry.message?.content
    if (entry.isSidechain === true || content === undefined || typeof content === 'string') continue
    for (const part of content) {
      if (entry.type === 'assistant' && part.type === 'tool_use' && part.name === 'Bash') {
        const call = bashCall(part.input)
        if (typeof part.id === 'string' && call !== null) calls.set(part.id, call)
      } else if (
        entry.type === 'user' &&
        part.type === 'tool_result' &&
        typeof part.tool_use_id === 'string'
      ) {
        const call = calls.get(part.tool_use_id)
        if (call === undefined || !keeps(call)) continue
        // a failed call, or an `is_error` of another type: not proven to have worked
        if (part.is_error !== undefined && part.is_error !== false) continue
        if (wasInterrupted(entry.toolUseResult)) continue
        out.push({ text: call.command.trim(), lineEnd: end })
      }
    }
  }
  return out
}
