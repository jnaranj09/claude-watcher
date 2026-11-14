// The two installed mod folders, as main reads them at each spawn (memory phase 3): null until the
// start's install (`installAppMods`, startMods.ts) answered, and null for a mod whose install
// failed. One object, set from the install's own result, so index.ts never pairs a getter with
// the other mod's folder.

export interface InstalledModDirs {
  bridge: string | null
  memory: string | null
}

export interface ModDirs {
  /** The start's install answered (`installAppMods`). */
  set(dirs: InstalledModDirs): void
  /** The `watcher-bridge` folder, or null. */
  bridge(): string | null
  /** The `watcher-memory` folder, or null. */
  memory(): string | null
}

export function createModDirs(): ModDirs {
  let dirs: InstalledModDirs = { bridge: null, memory: null }
  return {
    set(next) {
      dirs = { bridge: next.bridge, memory: next.memory }
    },
    bridge: () => dirs.bridge,
    memory: () => dirs.memory
  }
}
