// Action feedback (spec 2026-09-29 §2.6) — the six startup loads and ONE error toast naming every
// store that failed ("Could not load templates, tags and rules."): six sticky toasts would pass the
// cap of 3. Each Manage dialog also says `Could not load <x>.` in place of its empty sentence (the
// stores' `loadFailed`). StorageNotice is unchanged: it reports FILE problems main found; this is
// the IPC failing.
import { loadSettings } from '../stores/settingsStore'
import { loadTemplates } from '../stores/templatesStore'
import { loadShortcuts } from '../stores/shortcutsStore'
import { loadWorkspaces } from '../stores/workspacesStore'
import { loadTags } from '../stores/tagsStore'
import { loadRules } from '../stores/rulesStore'
import { toast } from '../stores/toastStore'

const STARTUP_LOADS: readonly { name: string; load: () => Promise<boolean> }[] = [
  { name: 'settings', load: loadSettings },
  { name: 'templates', load: loadTemplates },
  { name: 'shortcuts', load: loadShortcuts },
  { name: 'workspaces', load: loadWorkspaces },
  { name: 'tags', load: loadTags },
  { name: 'rules', load: loadRules }
]

/** `templates, tags and rules` — one, two or many, in plain English. */
export function startupLoadFailedCopy(names: readonly string[]): string {
  const last = names.at(-1) ?? ''
  const list = names.length <= 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`
  return `Could not load ${list}. Reopen the app to try again.`
}

/** Run every load in parallel; never rejects (each loader logs its own code). */
export async function runStartupLoads(): Promise<void> {
  const results = await Promise.all(STARTUP_LOADS.map((l) => l.load()))
  const failed = STARTUP_LOADS.filter((_, i) => results[i] === false).map((l) => l.name)
  if (failed.length > 0) toast.error(startupLoadFailedCopy(failed))
}
