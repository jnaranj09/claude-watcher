// Who sent a prompt, as the bridge mod reports it: `prompt.submit`'s `origin.kind`, never the
// prompt's text. Main parses it with `ModPromptSchema` (src/shared/schemas/modPrompt.ts) at
// `MOD_PROMPT_PATH` (src/main/hooks/hookContract.ts). The mod cannot import main, so it holds its
// own copy of both paths; tests/main/modPromptContract.test.ts pins them and the body to main.

/** Main's `MOD_REPORT_PATH`: what `CLAUDE_WATCHER_MOD_URL` ends in. */
export const REPORT_PATH = '/mod/report'
/** Main's `MOD_PROMPT_PATH`. */
export const PROMPT_PATH = '/mod/prompt'

export interface ModPrompt {
  version: 1
  sessionId: string
  origin: string
}

/** The prompt URL on the same listener as the report URL; undefined when the report URL does not
 *  end in the report path (then the mod sends no origin). */
export function promptUrl(reportUrl: string): string | undefined {
  if (!reportUrl.endsWith(REPORT_PATH)) return undefined
  return reportUrl.slice(0, -REPORT_PATH.length) + PROMPT_PATH
}

/**
 * The body for a prompt's origin, or undefined when the event carries none (or an empty kind):
 * then the mod sends nothing. An older claude without `origin` must not mark the session as
 * origin-reporting in the app, which would stop `UserPromptSubmit` clearing an ask while no
 * operator origin ever arrives; sending nothing keeps that fallback.
 */
export function buildPrompt(
  sessionId: string,
  origin: { kind: string } | undefined
): ModPrompt | undefined {
  const kind: unknown = origin?.kind
  if (typeof kind !== 'string' || kind === '') return undefined
  return { version: 1, sessionId, origin: kind }
}
