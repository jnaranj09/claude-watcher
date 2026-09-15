import type { TagsFile } from '../../shared/schemas/tag'
import { createElectronBlobStore } from './electronBlobStore'
import type { TagsBlobStore } from './tags'

/** `claude-watcher-tags.json` under userData — its own file, never the settings blob. */
export function createElectronTagsBlobStore(): TagsBlobStore {
  return createElectronBlobStore<TagsFile>({
    name: 'claude-watcher-tags',
    key: 'tags'
  })
}
