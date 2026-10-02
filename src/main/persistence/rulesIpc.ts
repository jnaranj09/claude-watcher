// The rules IPC handler BODIES, kept out of index.ts so they are unit-testable in node. Every arg is
// UNTRUSTED cross-process input → Schema.parse(raw) throws typed on bad input (zod-boundaries.md
// IPC-arg row). ipc/registerStoreIpc.ts binds them to CH.* channels and tells each window's engine
// what changed.
import { RuleDeleteSchema, RuleMoveSchema, RuleSaveSchema } from '../../shared/schemas/rule'
import type { RulesListResult, RulesSaveResult } from '../../shared/ipc/contract'
import type { RulesStore } from './rules'

export interface RulesIpcHandlers {
  list(): RulesListResult
  save(raw: unknown): RulesSaveResult
  remove(raw: unknown): RulesListResult
  move(raw: unknown): RulesListResult
}

export function createRulesIpcHandlers(store: RulesStore): RulesIpcHandlers {
  return {
    list: () => store.view(),
    save: (raw) => store.save(RuleSaveSchema.parse(raw)),
    remove: (raw) => store.remove(RuleDeleteSchema.parse(raw).id),
    move: (raw) => {
      const { id, toIndex } = RuleMoveSchema.parse(raw)
      return store.move(id, toIndex)
    }
  }
}
