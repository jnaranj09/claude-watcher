// Workspaces — the workspace shape and its IPC/file boundaries. OUR shape (fail-closed, NO
// passthrough, mirrors template.ts / settings.ts). NEVER log a workspace value: `name` is
// operator text and `defaultCwd` leaks the filesystem layout — log issue path + code only.
import { z } from 'zod'
import { SESSION_NAME_MAX_LENGTH, SessionNameSchema } from './launch'

/**
 * The built-in workspace every install starts with, and the fallback a session falls back to
 * when its stored workspace is gone.
 *
 * A FIXED string, not a minted uuid, for two reasons: the fresh-file seed is then deterministic
 * and testable without injecting an id generator, and `Session.workspaceId` has a valid constant
 * to fall back to before any file has been read.
 */
export const DEFAULT_WORKSPACE_ID = 'default'
export const DEFAULT_WORKSPACE_NAME = 'Default'

/** The workspace tint (and, through TAG_COLORS, the tag hue). Enum-locked: these are OUR tokens,
 *  not external input, so an unknown color is a corrupt file, not a forward-compatible addition.
 *  Ordered by hue (slate first, the default) so a picker reads as a colour wheel. A new entry owes
 *  its tokens in tokens.ts / tokens.css, a class in TagChip / TagIndicator / WorkspaceTint, and
 *  values in the Paper and Liquid Glass themes; the tests iterate this list. Only ADD — a removed
 *  name fails every file that stored it closed. */
export const WORKSPACE_COLORS = [
  'slate',
  'red',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink',
  'rose'
] as const
export type WorkspaceColor = (typeof WORKSPACE_COLORS)[number]

export const WORKSPACE_NAME_MAX_LENGTH = SESSION_NAME_MAX_LENGTH

/** Same rules as a session name: trimmed, 1..60, no control characters. */
export const WorkspaceNameSchema = SessionNameSchema

/** Not `.uuid()` — existence is the store's call (`workspace_not_found`), the same reasoning as
 *  TemplateIdSchema. `DEFAULT_WORKSPACE_ID` is not a uuid either. */
export const WorkspaceIdSchema = z.string().min(1)

export const WorkspaceSchema = z.object({
  id: WorkspaceIdSchema,
  name: WorkspaceNameSchema,
  color: z.enum(WORKSPACE_COLORS),
  // `.default(null)` is BACKWARD COMPATIBILITY, not sugar — the same reasoning as
  // `Template.effort`: a file written before this field existed has no key, and without the
  // default that row (and therefore the whole file) fails closed, so loadPersistedOrReset backs
  // it up and starts from the seed. Every saved workspace would be lost.
  // null ⇒ the folder picker opens wherever the OS defaults.
  defaultCwd: z.string().min(1).nullable().default(null)
})
export type Workspace = z.infer<typeof WorkspaceSchema>

/** `workspaces:save` arg — no id ⇒ create; id ⇒ update. */
export const WorkspaceSaveSchema = WorkspaceSchema.omit({ id: true }).extend({
  id: WorkspaceIdSchema.optional()
})
export type WorkspaceSaveRequest = z.infer<typeof WorkspaceSaveSchema>

/** `workspaces:delete` arg. */
export const WorkspaceDeleteSchema = z.object({ id: WorkspaceIdSchema })
export type WorkspaceDeleteRequest = z.infer<typeof WorkspaceDeleteSchema>

/** `workspaces:set-active` arg. */
export const WorkspaceSetActiveSchema = z.object({ id: WorkspaceIdSchema })
export type WorkspaceSetActiveRequest = z.infer<typeof WorkspaceSetActiveSchema>

export const WORKSPACES_FILE_VERSION = 1 as const

/** `.min(1)`: Default always exists and cannot be deleted, so an empty list is a corrupt file,
 *  never a legal state. Without this the app could boot into "no workspace to be in". */
export const WorkspacesFileSchema = z.object({
  version: z.literal(WORKSPACES_FILE_VERSION),
  activeId: WorkspaceIdSchema,
  workspaces: z.array(WorkspaceSchema).min(1)
})
export type WorkspacesFile = z.infer<typeof WorkspacesFileSchema>

/** The fresh-start constant. NOT empty (unlike EMPTY_TEMPLATES_FILE) — it is the seeded file,
 *  used on first install AND on a corrupt-read reset. */
export const DEFAULT_WORKSPACES_FILE: WorkspacesFile = {
  version: WORKSPACES_FILE_VERSION,
  activeId: DEFAULT_WORKSPACE_ID,
  workspaces: [
    { id: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME, color: 'slate', defaultCwd: null }
  ]
}
