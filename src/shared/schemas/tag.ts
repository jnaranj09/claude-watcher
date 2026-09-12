// Tags — the tag shape and its IPC/file boundaries (spec 2026-09-11 §1.1). OUR shape: fail-closed,
// NO passthrough (mirrors template.ts / workspace.ts). NEVER log a tag value — `name` is operator
// text; log issue path + code only.
import { z } from 'zod'
import { SESSION_NAME_MAX_LENGTH, SessionNameSchema } from './launch'
import { WORKSPACE_COLORS, WorkspaceIdSchema } from './workspace'

/** The same six names as the workspace dot. A chip draws them with its OWN `--tag-*` tokens
 *  (tokens.css), never the dot's colours — a tag must not read as a workspace (spec T-7). */
export const TAG_COLORS = WORKSPACE_COLORS
export type TagColor = (typeof TAG_COLORS)[number]

export const TAG_NAME_MAX_LENGTH = SESSION_NAME_MAX_LENGTH

/** Trimmed, 3..60 (longer minimum than sessions), no control characters. */
export const TagNameSchema = SessionNameSchema.min(3)

/** Not `.uuid()` — existence is the store's call (`tag_not_found`), same reasoning as
 *  TemplateIdSchema. */
export const TagIdSchema = z.string().min(1)

export const TagSchema = z.object({
  id: TagIdSchema,
  name: TagNameSchema,
  color: z.enum(TAG_COLORS),
  // null ⇒ GLOBAL (visible in every workspace); an id ⇒ that workspace only (spec T-8).
  // `.default(null)` is BACKWARD COMPATIBILITY exactly as on Template.workspaceId: a row without the
  // key must still load, or the whole file fails closed and every saved tag is lost. Do not remove
  // the default; do NOT bump TAGS_FILE_VERSION instead.
  workspaceId: WorkspaceIdSchema.nullable().default(null)
})
export type Tag = z.infer<typeof TagSchema>

/** `tags:save` arg — no id ⇒ create; id ⇒ update. */
export const TagSaveSchema = TagSchema.omit({ id: true }).extend({ id: TagIdSchema.optional() })
export type TagSaveRequest = z.infer<typeof TagSaveSchema>

/** `tags:delete` arg. */
export const TagDeleteSchema = z.object({ id: TagIdSchema })
export type TagDeleteRequest = z.infer<typeof TagDeleteSchema>

/** `session:set-tags` arg (spec §2.4). Duplicates collapse, first occurrence wins, so a double
 *  click can never store one tag twice. Existence and scope are checked in main (tagsIpc.ts). */
export const SessionSetTagsSchema = z.object({
  sessionId: z.string().min(1),
  tagIds: z.array(TagIdSchema).transform((ids) => [...new Set(ids)])
})
export type SessionSetTagsRequest = z.infer<typeof SessionSetTagsSchema>

export const TAGS_FILE_VERSION = 1 as const
export const TagsFileSchema = z.object({
  version: z.literal(TAGS_FILE_VERSION),
  tags: z.array(TagSchema)
})
export type TagsFile = z.infer<typeof TagsFileSchema>

export const EMPTY_TAGS_FILE: TagsFile = { version: TAGS_FILE_VERSION, tags: [] }
