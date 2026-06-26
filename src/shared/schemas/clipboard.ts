// Terminal clipboard feature — the cross-process IPC arg schema for
// `CH.clipboardWriteText` (renderer→main). [Source: spec-terminal-clipboard.md;
// .claude/rules/zod-boundaries.md (IPC-arg row: renderer→main = parse-and-throw-typed)]
//
// This is OUR shape (not c9watch's), so it does NOT use `.passthrough()`. A
// malformed arg FAILS CLOSED and the invoke is rejected.
//
// NEVER-LOG-THE-VALUE (Critical Guardrail #6): a ZodError stringifies its INPUT.
// The clipboard text is user content. Callers that catch a parse failure log the
// error PATH + CODE only, NEVER the value. The main handler follows this rule.

import { z } from 'zod'

/**
 * `clipboard:write-text` invoke arg schema — the text the renderer asks main to write
 * to the OS clipboard (Electron `clipboard.writeText`). Fail-closed: any non-string
 * or missing `text` field rejects the invoke. We do NOT further constrain the value:
 * empty string is valid (writing an empty selection is a valid no-op in the terminal).
 * NEVER log the text value on a parse failure — log path+code only (Guardrail #6).
 */
export const ClipboardWriteTextSchema = z.object({ text: z.string() })
