// Session templates — the main-owned store (single source of truth; the renderer holds a
// projection). Own file so a corrupt templates blob can never reset the operator's settings.
// NEVER log a template value (cwd, name, model) — codes only.
import { randomUUID } from 'node:crypto'
import {
  EMPTY_TEMPLATES_FILE,
  TEMPLATES_FILE_VERSION,
  TemplatesFileSchema,
  type Template,
  type TemplateSaveRequest,
  type TemplatesFile
} from '../../shared/schemas/template'
import type { TemplatesSaveResult } from '../../shared/ipc/contract'
import { inRuleScope } from '../../shared/rules/ruleRefs'
import {
  createInMemoryBlobStore,
  loadPersistedOrReset,
  type PersistedBlobStore
} from './persistedBlob'

export type TemplatesBlobStore = PersistedBlobStore<TemplatesFile>

/** Error messages thrown across the IPC seam; the renderer maps them back to copy. */
export const TEMPLATE_ERROR = {
  nameTaken: 'template_name_taken',
  notFound: 'template_not_found',
  inUse: 'template_in_use'
} as const

/** One rule that references a template. Only its scope matters to the integrity check. */
export interface TemplateRuleRef {
  ruleWorkspaceId: string | null
}

export interface TemplatesStoreOptions {
  blobStore?: TemplatesBlobStore
  log?: (message: string) => void
  newId?: () => string
  /** How many rules use a template (spec T-17). index.ts wires it to the rules store; the default
   *  says none, so this store works without rules. */
  ruleRefCount?: (templateId: string) => number
  /** The rules that reference a template (spec §1.4) — `save` refuses a scope change that would
   *  hide it from one of them. index.ts wires it to the rules store; the default says none. */
  ruleRefs?: (templateId: string) => TemplateRuleRef[]
}

export interface TemplatesStore {
  /** Sorted by name, case-insensitive. */
  list(): Template[]
  get(id: string): Template | null
  /** No id ⇒ create; id ⇒ update. Throws TEMPLATE_ERROR.notFound / nameTaken / inUse. Trusts its
   *  typed input — the IPC handler (templatesIpc.ts) is the parse boundary. */
  save(input: TemplateSaveRequest): TemplatesSaveResult
  /** Unknown id is a no-op (idempotent). Throws TEMPLATE_ERROR.inUse while a rule uses it. */
  remove(id: string): Template[]
  /** Workspaces — delete every template scoped to `workspaceId`. Returns how many were removed.
   *  Called ONLY by the workspaces store's cascade, after a delete was allowed. Global rows
   *  (`workspaceId === null`) are never touched. */
  removeByWorkspace(workspaceId: string): number
}

const LOG_PREFIX = '[claude-watcher][templates]'

export function createTemplatesStore(options: TemplatesStoreOptions = {}): TemplatesStore {
  const blobStore = options.blobStore ?? createInMemoryBlobStore<TemplatesFile>()
  const log = options.log ?? ((message: string): void => console.warn(message))
  const newId = options.newId ?? randomUUID
  const ruleRefCount = options.ruleRefCount ?? ((): number => 0)
  const ruleRefs = options.ruleRefs ?? ((): TemplateRuleRef[] => [])
  const byId = new Map<string, Template>()

  const loaded = loadPersistedOrReset<TemplatesFile>({
    blobStore,
    parse: (raw) => TemplatesFileSchema.parse(raw),
    fallback: () => EMPTY_TEMPLATES_FILE,
    onProblem: (code) => log(`${LOG_PREFIX} code=templates_${code}`)
  })
  for (const template of loaded.templates) byId.set(template.id, template)
  persist()

  function persist(): void {
    try {
      blobStore.write({ version: TEMPLATES_FILE_VERSION, templates: list() })
    } catch {
      log(`${LOG_PREFIX} code=templates_write_failed`)
    }
  }

  function list(): Template[] {
    return [...byId.values()].sort(byName)
  }

  function get(id: string): Template | null {
    return byId.get(id) ?? null
  }

  function save(input: TemplateSaveRequest): TemplatesSaveResult {
    if (input.id !== undefined && !byId.has(input.id)) throw new Error(TEMPLATE_ERROR.notFound)
    const id = input.id ?? newId()
    if (isNameTaken(input.name, id)) throw new Error(TEMPLATE_ERROR.nameTaken)
    // §1.4 — a scope change must never hide the template from a rule that uses it (T-11, T-17).
    if (ruleRefs(id).some((ref) => !inRuleScope(ref.ruleWorkspaceId, input.workspaceId))) {
      throw new Error(TEMPLATE_ERROR.inUse)
    }
    const saved: Template = {
      id,
      name: input.name,
      cwd: input.cwd,
      model: input.model,
      permissionMode: input.permissionMode,
      effort: input.effort,
      workspaceId: input.workspaceId,
      initialPrompt: input.initialPrompt,
      params: input.params
    }
    byId.set(id, saved)
    persist()
    return { saved, templates: list() }
  }

  function remove(id: string): Template[] {
    if (!byId.has(id)) return list()
    // T-17 — a rule never silently loses the template it points at.
    if (ruleRefCount(id) > 0) throw new Error(TEMPLATE_ERROR.inUse)
    byId.delete(id)
    persist()
    return list()
  }

  function removeByWorkspace(workspaceId: string): number {
    let removed = 0
    for (const [id, template] of byId) {
      if (template.workspaceId === workspaceId) {
        byId.delete(id)
        removed += 1
      }
    }
    if (removed > 0) persist()
    return removed
  }

  function isNameTaken(name: string, ownId: string): boolean {
    const key = nameKey(name)
    for (const other of byId.values()) {
      if (other.id !== ownId && nameKey(other.name) === key) return true
    }
    return false
  }

  return { list, get, save, remove, removeByWorkspace }
}

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function byName(a: Template, b: Template): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}
