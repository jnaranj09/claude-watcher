import type { ShortcutsFile } from '../../shared/schemas/shortcut'
import { createElectronBlobStore } from './electronBlobStore'
import type { ShortcutsBlobStore } from './shortcuts'

/** `claude-watcher-shortcuts.json` under userData — its own file, never the settings or
 *  templates blob. */
export function createElectronShortcutsBlobStore(): ShortcutsBlobStore {
  return createElectronBlobStore<ShortcutsFile>({
    name: 'claude-watcher-shortcuts',
    key: 'shortcuts'
  })
}
