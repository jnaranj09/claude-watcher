// The start's two mod installs (memory phase 3), out of index.ts so they are tested: the bridge mod
// and the memory mod each install into <userData>/mods/<name>. Each install is on its own:
// `installMod` never rejects, and a failed one answers null, reports and logs its own code, so a
// memory mod that cannot be installed costs recall only, never the bridge mod, a launch or the
// start.
import { BRIDGE_MOD_NAME, MEMORY_MOD_NAME, installMod, type ModName } from './modInstall'

export async function installAppMods(
  deps: Omit<Parameters<typeof installMod>[0], 'name' | 'sourceDir'> & {
    sourceDirOf: (name: ModName) => string
  }
): Promise<{ bridge: string | null; memory: string | null }> {
  const { sourceDirOf, ...rest } = deps
  const bridge = await installMod({
    ...rest,
    name: BRIDGE_MOD_NAME,
    sourceDir: sourceDirOf(BRIDGE_MOD_NAME)
  })
  const memory = await installMod({
    ...rest,
    name: MEMORY_MOD_NAME,
    sourceDir: sourceDirOf(MEMORY_MOD_NAME)
  })
  return { bridge, memory }
}
