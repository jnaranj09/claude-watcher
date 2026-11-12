import { CH } from '../../shared/ipc/contract'
import { MemoryChangedSchema } from '../../shared/schemas/memory'

// The one `memory:changed` payload: empty, parsed once by its schema (main→renderer, validated at
// source; zod-boundaries.md). It carries no memory text, which is sensitive: the renderer lists
// again through `memory:list`.
const PAYLOAD = MemoryChangedSchema.parse({})

// Tell a window that memory changed (any write, whoever made it).
export function sendMemoryChanged(wc: Electron.WebContents): void {
  if (!wc.isDestroyed()) wc.send(CH.memoryChanged, PAYLOAD)
}
