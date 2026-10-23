// The bridge mod cannot import main (layers.guard), so it holds its own copy of the two wire paths
// and builds its own `/mod/prompt` body. This pins both sides (maintainability rule 2): the paths
// equal main's `hookContract.ts`, the prompt URL the mod derives from `CLAUDE_WATCHER_MOD_URL` (as
// `mods/bridgeModSpawn.ts` builds it) is the route `hookServer.ts` serves, and the body it builds
// passes main's `ModPromptSchema`.
import { describe, it, expect } from 'vitest'
import { MOD_PROMPT_PATH, MOD_REPORT_PATH } from '../../src/main/hooks/hookContract'
import { ModPromptSchema } from '../../src/shared/schemas/modPrompt'
import {
  PROMPT_PATH,
  REPORT_PATH,
  buildPrompt,
  promptUrl
} from '../../src/mod/watcher-bridge/hooks/prompt'

const SID = 'aaaaaaaa-0000-4000-8000-0000000000aa'

describe('the bridge mod prompt contract', () => {
  it('the mod holds main’s report path', () => {
    expect(REPORT_PATH).toBe(MOD_REPORT_PATH)
  })

  it('the mod holds main’s prompt path', () => {
    expect(PROMPT_PATH).toBe(MOD_PROMPT_PATH)
  })

  it('the prompt URL is the report URL with main’s prompt path', () => {
    expect(promptUrl(`http://127.0.0.1:19279${MOD_REPORT_PATH}`)).toBe(
      `http://127.0.0.1:19279${MOD_PROMPT_PATH}`
    )
  })

  it('a URL that does not end in the report path gives no prompt URL', () => {
    expect(promptUrl('http://127.0.0.1:19279/elsewhere')).toBeUndefined()
  })

  it('a body built from an origin passes main’s schema', () => {
    expect(ModPromptSchema.safeParse(buildPrompt(SID, { kind: 'composer' })).success).toBe(true)
  })

  it('no origin builds no body (the app keeps its UserPromptSubmit fallback)', () => {
    expect(buildPrompt(SID, undefined)).toBeUndefined()
  })

  it('an empty origin kind builds no body', () => {
    expect(buildPrompt(SID, { kind: '' })).toBeUndefined()
  })
})
