import type { TemplatesFile } from '../../shared/schemas/template'
import { createElectronBlobStore } from './electronBlobStore'
import type { TemplatesBlobStore } from './templates'

/** `claude-watcher-templates.json` under userData — its own file, never the settings blob. */
export function createElectronTemplatesBlobStore(): TemplatesBlobStore {
  return createElectronBlobStore<TemplatesFile>({
    name: 'claude-watcher-templates',
    key: 'templates'
  })
}
