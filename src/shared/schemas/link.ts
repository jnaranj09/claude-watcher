// External links — the cross-process IPC arg schema for `CH.linkOpenExternal` (renderer→main).
// Parse-and-throw at the boundary (.claude/rules/zod-boundaries.md, IPC-arg row). Only the SHAPE
// is checked here; which schemes may open is main's call (`src/main/links/externalLinks.ts`).
//
// NEVER-LOG-THE-VALUE: a ZodError stringifies its input, and a URL can carry a token.

import { z } from 'zod'

/** Well past any real link, short enough that a runaway string is refused before it is parsed. */
export const LINK_URL_MAX_LENGTH = 8192

export const LinkOpenExternalSchema = z
  .object({ url: z.string().min(1).max(LINK_URL_MAX_LENGTH) })
  .strict()
