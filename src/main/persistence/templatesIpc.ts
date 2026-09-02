// The templates IPC handler BODIES, kept out of index.ts so they are unit-testable in node.
// Every arg is UNTRUSTED cross-process input → Schema.parse(raw) throws typed on bad input
// (zod-boundaries.md IPC-arg row). index.ts only binds them to CH.* channels.
import {
  TemplateDeleteSchema,
  TemplateSaveSchema,
  type Template
} from '../../shared/schemas/template'
import type { TemplatesSaveResult } from '../../shared/ipc/contract'
import type { TemplatesStore } from './templates'

export interface TemplatesIpcHandlers {
  list(): Template[]
  save(raw: unknown): TemplatesSaveResult
  remove(raw: unknown): Template[]
}

export function createTemplatesIpcHandlers(store: TemplatesStore): TemplatesIpcHandlers {
  return {
    list: () => store.list(),
    save: (raw) => store.save(TemplateSaveSchema.parse(raw)),
    remove: (raw) => store.remove(TemplateDeleteSchema.parse(raw).id)
  }
}
