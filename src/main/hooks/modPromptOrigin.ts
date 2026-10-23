// Who sent a prompt, as the bridge mod reports it at `/mod/prompt`. Kept out of watchFeed.ts so a
// test can reach it (the renameLaunched.ts precedent). Never logs the id or the origin.
import type { Reducer, SessionDelta } from '../c9watch/reducer'
import type { ModPrompt } from '../../shared/schemas/modPrompt'

export interface ModPromptOriginDeps {
  /** A card in any window shows this id now (index.ts `isSessionLive`, as `sessionSetup.accept`
   *  checks it). */
  isLive: (sessionId: string) => boolean
  promptOrigin: Reducer['promptOrigin']
  onDelta: (delta: SessionDelta) => void
  log: (line: string) => void
}

/** Hand a live session's prompt origin to the reducer; false (answered 409) for any other id,
 *  which is dropped: never synthesize truth for a session no board shows. */
export function applyModPrompt(deps: ModPromptOriginDeps, prompt: ModPrompt): boolean {
  if (!deps.isLive(prompt.sessionId)) {
    deps.log('[claude-watcher][mods] code=mod_prompt_unknown_session')
    return false
  }
  for (const delta of deps.promptOrigin(prompt.sessionId, prompt.origin)) deps.onDelta(delta)
  return true
}
