// The shortcuts IPC handler BODIES, kept out of index.ts so they are unit-testable in node.
// Every arg is UNTRUSTED cross-process input → Schema.parse(raw) throws typed on bad input
// (zod-boundaries.md IPC-arg row). ipc/registerStoreIpc.ts only binds them to CH.* channels.
import {
  ShortcutDeleteSchema,
  ShortcutSaveSchema,
  ShortcutSetFavoriteSchema,
  type Shortcut
} from '../../shared/schemas/shortcut'
import type { ShortcutsSaveResult } from '../../shared/ipc/contract'
import type { ShortcutsStore } from './shortcuts'

export interface ShortcutsIpcHandlers {
  list(): Shortcut[]
  save(raw: unknown): ShortcutsSaveResult
  remove(raw: unknown): Shortcut[]
  setFavorite(raw: unknown): Shortcut[]
}

export function createShortcutsIpcHandlers(store: ShortcutsStore): ShortcutsIpcHandlers {
  return {
    list: () => store.list(),
    save: (raw) => store.save(ShortcutSaveSchema.parse(raw)),
    remove: (raw) => store.remove(ShortcutDeleteSchema.parse(raw).id),
    setFavorite: (raw) => {
      const req = ShortcutSetFavoriteSchema.parse(raw)
      return store.setFavorite(req.id, req.favorite)
    }
  }
}
