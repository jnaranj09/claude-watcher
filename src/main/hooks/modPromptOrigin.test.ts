import { describe, it, expect, vi } from 'vitest'
import { applyModPrompt, type ModPromptOriginDeps } from './modPromptOrigin'
import type { SessionDelta } from '../c9watch/reducer'
import type { ModPrompt } from '../../shared/schemas/modPrompt'

const SID = 'aaaaaaaa-0000-4000-8000-0000000000aa'
const PROMPT: ModPrompt = { version: 1, sessionId: SID, origin: 'composer' }
const DELTA: SessionDelta = {
  epoch: 1,
  event: { type: 'session.removed', id: SID, sessionName: 'n', projectPath: '/p' }
}

function deps(live: boolean): {
  d: ModPromptOriginDeps
  promptOrigin: ReturnType<typeof vi.fn<ModPromptOriginDeps['promptOrigin']>>
  onDelta: ReturnType<typeof vi.fn<ModPromptOriginDeps['onDelta']>>
  log: ReturnType<typeof vi.fn<ModPromptOriginDeps['log']>>
} {
  const promptOrigin = vi.fn<ModPromptOriginDeps['promptOrigin']>(() => [DELTA])
  const onDelta = vi.fn<ModPromptOriginDeps['onDelta']>()
  const log = vi.fn<ModPromptOriginDeps['log']>()
  return { d: { isLive: () => live, promptOrigin, onDelta, log }, promptOrigin, onDelta, log }
}

describe('applyModPrompt', () => {
  it('a live session’s origin goes to the reducer and its deltas to the sink', () => {
    const { d, promptOrigin, onDelta, log } = deps(true)
    expect(applyModPrompt(d, PROMPT)).toBe(true)
    expect(promptOrigin).toHaveBeenCalledWith(SID, 'composer')
    expect(onDelta).toHaveBeenCalledWith(DELTA)
    expect(log).not.toHaveBeenCalled()
  })

  it('a session no board shows is dropped with its code and never reaches the reducer', () => {
    const { d, promptOrigin, onDelta, log } = deps(false)
    expect(applyModPrompt(d, PROMPT)).toBe(false)
    expect(promptOrigin).not.toHaveBeenCalled()
    expect(onDelta).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('[claude-watcher][mods] code=mod_prompt_unknown_session')
  })

  it('the log never carries the id or the origin', () => {
    const { d, log } = deps(false)
    applyModPrompt(d, PROMPT)
    expect(JSON.stringify(log.mock.calls)).not.toContain(SID)
    expect(JSON.stringify(log.mock.calls)).not.toContain('composer')
  })
})
