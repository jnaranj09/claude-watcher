import type { RulesFile } from '../../shared/schemas/rule'
import { createElectronBlobStore } from './electronBlobStore'
import type { RulesBlobStore } from './rules'

/** `claude-watcher-rules.json` under userData — its own file, never the settings blob. */
export function createElectronRulesBlobStore(): RulesBlobStore {
  return createElectronBlobStore<RulesFile>({
    name: 'claude-watcher-rules',
    key: 'rules'
  })
}
